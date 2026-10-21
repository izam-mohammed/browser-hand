use std::time::Duration;

use browser_hand::config::{self, Settings};
use browser_hand::native_host::{self, HostOptions};
use browser_hand::wire::{self, Content, Frame, Reassembler};
use serde_json::json;
use tokio::io::{DuplexStream, ReadHalf, WriteHalf};
use tokio::net::{UnixListener, UnixStream};
use tokio::time::timeout;

const T: Duration = Duration::from_secs(5);

struct Chrome {
    read: ReadHalf<DuplexStream>,
    write: WriteHalf<DuplexStream>,
}

impl Chrome {
    async fn send(&mut self, f: Frame) {
        wire::write_frame(&mut self.write, &f).await.unwrap();
    }
    /// The next frame that is not `settings` (the host sends those on
    /// every hello; the settings tests read them with `recv_any`).
    async fn recv(&mut self) -> Frame {
        loop {
            match self.recv_any().await {
                Frame::Settings { .. } => continue,
                f => return f,
            }
        }
    }
    async fn recv_any(&mut self) -> Frame {
        timeout(T, wire::read_frame(&mut self.read))
            .await
            .unwrap()
            .unwrap()
            .unwrap()
    }
}

/// The host's settings file inside `dir`, polled every 100 ms.
fn options(dir: &std::path::Path) -> HostOptions {
    HostOptions {
        config: dir.join("conf").join("config.toml"),
        chrome_dir: dir.join("chrome"),
        poll: Duration::from_millis(100),
    }
}

/// Starts a host on a temp socket with an in-memory "Chrome" end. Its
/// settings file is `options(dir).config`.
async fn start() -> (
    Chrome,
    std::path::PathBuf,
    tempfile::TempDir,
    tokio::task::JoinHandle<()>,
) {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().to_owned();
    let path = dir.path().join("h.sock");
    let listener = UnixListener::bind(&path).unwrap();
    let (chrome_end, host_end) = tokio::io::duplex(1 << 22);
    let (host_read, host_write) = tokio::io::split(host_end);
    let task = tokio::spawn(async move {
        native_host::run(
            host_read,
            host_write,
            listener,
            "inst-1".into(),
            options(&config),
        )
        .await
        .unwrap();
    });
    let (read, write) = tokio::io::split(chrome_end);
    (Chrome { read, write }, path, dir, task)
}

async fn client(path: &std::path::Path) -> UnixStream {
    UnixStream::connect(path).await.unwrap()
}

async fn recv(s: &mut UnixStream) -> Frame {
    timeout(T, wire::read_frame(s))
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}

/// Reads hellos until one names `dir`.
async fn hello_for(s: &mut UnixStream, dir: &str) {
    loop {
        if let Frame::Hello {
            profile_dir: Some(d),
            instance,
            ..
        } = recv(s).await
        {
            if d == dir {
                assert_eq!(instance, "inst-1");
                return;
            }
        }
    }
}

fn call(id: u64, session: &str, tool: &str) -> Frame {
    Frame::Call {
        id,
        session: session.into(),
        tool: tool.into(),
        args: json!({}),
    }
}

#[tokio::test]
async fn a_client_gets_hello_at_once_even_before_the_extension_speaks() {
    let (_chrome, path, _dir, _task) = start().await;
    let mut a = client(&path).await;
    match recv(&mut a).await {
        Frame::Hello {
            protocol: 1,
            profile_dir: None,
            instance,
            ..
        } => assert_eq!(instance, "inst-1"),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn results_go_back_to_the_client_that_called_under_its_own_id() {
    let (mut chrome, path, _dir, _task) = start().await;
    chrome
        .send(Frame::Hello {
            protocol: 1,
            profile_dir: Some("Profile 3".into()),
            extension_version: "0.1.0".into(),
            instance: String::new(),
        })
        .await;
    let mut a = client(&path).await;
    let mut b = client(&path).await;
    hello_for(&mut a, "Profile 3").await;
    hello_for(&mut b, "Profile 3").await;

    wire::write_frame(&mut a, &call(1, "sa", "tabs_create"))
        .await
        .unwrap();
    wire::write_frame(&mut b, &call(1, "sb", "tabs_close"))
        .await
        .unwrap();

    let mut seen = vec![];
    for _ in 0..2 {
        let Frame::Call { id, tool, .. } = chrome.recv().await else {
            panic!()
        };
        seen.push((id, tool));
    }
    assert_ne!(seen[0].0, seen[1].0, "host ids must differ");
    // Answer in reverse order.
    for (id, tool) in seen.into_iter().rev() {
        chrome
            .send(Frame::ok(id, vec![Content::Text { text: tool }]))
            .await;
    }

    let want = |tool: &str| Frame::ok(1, vec![Content::Text { text: tool.into() }]);
    assert_eq!(recv(&mut a).await, want("tabs_create"));
    assert_eq!(recv(&mut b).await, want("tabs_close"));
}

#[tokio::test]
async fn a_claim_reaches_clients_and_updates_hello() {
    let (mut chrome, path, _dir, _task) = start().await;
    let mut a = client(&path).await;
    assert!(matches!(
        recv(&mut a).await,
        Frame::Hello {
            profile_dir: None,
            ..
        }
    ));
    chrome
        .send(Frame::Claimed {
            profile_dir: "Default".into(),
            nonce: "n1".into(),
        })
        .await;
    assert_eq!(
        recv(&mut a).await,
        Frame::Claimed {
            profile_dir: "Default".into(),
            nonce: "n1".into()
        }
    );
    hello_for(&mut a, "Default").await;
}

#[tokio::test]
async fn a_client_leaving_ends_its_sessions_in_the_extension() {
    let (mut chrome, path, _dir, _task) = start().await;
    let mut a = client(&path).await;
    recv(&mut a).await;
    wire::write_frame(&mut a, &call(5, "sa", "tabs_context"))
        .await
        .unwrap();
    assert!(matches!(chrome.recv().await, Frame::Call { .. }));
    drop(a);
    assert_eq!(
        chrome.recv().await,
        Frame::End {
            session: "sa".into()
        }
    );
}

#[tokio::test]
async fn a_large_call_reaches_chrome_in_chunks() {
    let (mut chrome, path, _dir, _task) = start().await;
    let mut a = client(&path).await;
    recv(&mut a).await;
    let big = Frame::Call {
        id: 9,
        session: "s".into(),
        tool: "upload_image".into(),
        args: json!({ "data": "y".repeat(2_000_000) }),
    };
    wire::write_frame(&mut a, &big).await.unwrap();
    let mut r = Reassembler::default();
    let joined = loop {
        let f = chrome.recv().await;
        assert!(matches!(f, Frame::Chunk { .. }));
        if let Some(f) = r.push(f).unwrap() {
            break f;
        }
    };
    let Frame::Call { tool, args, .. } = joined else {
        panic!()
    };
    assert_eq!(tool, "upload_image");
    assert_eq!(args["data"].as_str().unwrap().len(), 2_000_000);
}

#[tokio::test]
async fn the_host_stops_when_chrome_closes_the_port() {
    let (chrome, _path, _dir, task) = start().await;
    drop(chrome);
    timeout(T, task).await.unwrap().unwrap();
}

#[tokio::test]
async fn the_extensions_protocol_reaches_clients_in_hello() {
    let (mut chrome, path, _dir, _task) = start().await;
    let mut a = client(&path).await;
    recv(&mut a).await;
    let other = wire::PROTOCOL + 1;
    chrome
        .send(Frame::Hello {
            protocol: other,
            profile_dir: Some("Default".into()),
            extension_version: "9".into(),
            instance: String::new(),
        })
        .await;
    loop {
        if let Frame::Hello {
            protocol,
            profile_dir: Some(_),
            ..
        } = recv(&mut a).await
        {
            assert_eq!(protocol, other);
            return;
        }
    }
}

#[tokio::test]
async fn a_session_in_use_by_one_client_is_refused_to_another() {
    let (mut chrome, path, _dir, _task) = start().await;
    let mut a = client(&path).await;
    let mut b = client(&path).await;
    recv(&mut a).await;
    recv(&mut b).await;
    wire::write_frame(&mut a, &call(1, "sa", "tabs_context"))
        .await
        .unwrap();
    assert!(matches!(chrome.recv().await, Frame::Call { .. }));
    wire::write_frame(&mut b, &call(7, "sa", "tabs_close"))
        .await
        .unwrap();
    match recv(&mut b).await {
        Frame::Result {
            id: 7,
            ok: false,
            error: Some(e),
            ..
        } => assert!(e.message.contains("in use")),
        other => panic!("expected a refusal, got {other:?}"),
    }
    // b leaving does not end a's session.
    drop(b);
    wire::write_frame(&mut a, &call(2, "sa", "tabs_context"))
        .await
        .unwrap();
    assert!(matches!(chrome.recv().await, Frame::Call { .. }));
}

// Settings (plans/06-settings.md).

fn hello(dir: Option<&str>) -> Frame {
    Frame::Hello {
        protocol: 1,
        profile_dir: dir.map(String::from),
        extension_version: "0.1.0".into(),
        instance: String::new(),
    }
}

/// The next `settings` frame Chrome gets.
async fn settings_frame(chrome: &mut Chrome) -> (Settings, String, Vec<String>) {
    loop {
        if let Frame::Settings {
            settings,
            revision,
            warnings,
            ..
        } = chrome.recv_any().await
        {
            return (settings, revision, warnings);
        }
    }
}

fn set(id: u64, s: &Settings, revision: &str) -> Frame {
    Frame::SettingsSet {
        id,
        settings: serde_json::to_value(s).unwrap(),
        revision: revision.into(),
    }
}

#[tokio::test]
async fn the_extensions_hello_gets_the_settings_with_no_file_the_defaults() {
    let (mut chrome, _path, dir, _task) = start().await;
    chrome.send(hello(None)).await;
    let Frame::Settings {
        settings,
        revision,
        path,
        warnings,
        ..
    } = chrome.recv_any().await
    else {
        panic!()
    };
    assert_eq!(settings, Settings::default());
    assert_eq!(revision, "0");
    assert_eq!(path, options(dir.path()).config.display().to_string());
    assert!(warnings.is_empty());
}

#[tokio::test]
async fn settings_set_from_chrome_saves_answers_and_sends_the_new_file() {
    let (mut chrome, _path, dir, _task) = start().await;
    chrome.send(hello(None)).await;
    let (mut s, rev, _) = settings_frame(&mut chrome).await;
    s.input.pace = "fast".into();
    s.sites.blocked = vec!["*.bank.com/*".into()];
    chrome.send(set(4, &s, &rev)).await;
    match chrome.recv_any().await {
        Frame::SettingsSaved {
            id: 4,
            ok: true,
            path: Some(p),
            error: None,
        } => assert!(p.ends_with("config.toml")),
        other => panic!("{other:?}"),
    }
    let (now, new_rev, _) = settings_frame(&mut chrome).await;
    assert_eq!(now, s);
    assert_ne!(new_rev, rev);
    assert_eq!(config::current(&options(dir.path()).config), s);
}

#[tokio::test]
async fn a_bad_value_is_refused_naming_its_key_and_nothing_is_written() {
    let (mut chrome, _path, dir, _task) = start().await;
    chrome.send(hello(None)).await;
    let (mut s, rev, _) = settings_frame(&mut chrome).await;
    s.sites.read_only = vec!["https//docs.google".into()];
    chrome.send(set(5, &s, &rev)).await;
    match chrome.recv_any().await {
        Frame::SettingsSaved {
            id: 5,
            ok: false,
            error: Some(e),
            ..
        } => {
            assert_eq!(e.field.as_deref(), Some("sites.read_only"));
            assert!(e.message.contains(config::NOT_A_PATTERN), "{}", e.message);
        }
        other => panic!("{other:?}"),
    }
    assert!(!options(dir.path()).config.exists());
}

#[tokio::test]
async fn a_stale_revision_is_refused_as_changed_in_another_profile() {
    let (mut chrome, _path, dir, _task) = start().await;
    chrome.send(hello(None)).await;
    let (s, rev, _) = settings_frame(&mut chrome).await;
    // Another profile's host saves first.
    let mut other = s.clone();
    other.input.mouse_speed = 2.0;
    config::save(&options(dir.path()).config, &other).unwrap();
    chrome.send(set(6, &s, &rev)).await;
    loop {
        match chrome.recv_any().await {
            Frame::SettingsSaved {
                id: 6, ok, error, ..
            } => {
                assert!(!ok);
                assert!(error
                    .unwrap()
                    .message
                    .contains("changed in another profile"));
                break;
            }
            Frame::Settings { .. } => continue, // the poll may see the change first
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(config::current(&options(dir.path()).config), other);
}

#[tokio::test]
async fn a_socket_client_cannot_change_the_settings() {
    let (mut chrome, path, dir, _task) = start().await;
    chrome.send(hello(None)).await;
    let (mut s, rev, _) = settings_frame(&mut chrome).await;
    let mut a = client(&path).await;
    recv(&mut a).await;
    s.sites.blocked.clear();
    s.input.pace = "fast".into();
    wire::write_frame(&mut a, &set(1, &s, &rev)).await.unwrap();
    // The client's frame goes nowhere: the next thing Chrome sees is the
    // client's call, and the file was never written.
    wire::write_frame(&mut a, &call(2, "sa", "tabs_context"))
        .await
        .unwrap();
    assert!(matches!(chrome.recv().await, Frame::Call { .. }));
    assert!(!options(dir.path()).config.exists());
}

#[tokio::test]
async fn a_change_on_disk_reaches_the_extension_within_the_poll() {
    let (mut chrome, _path, dir, _task) = start().await;
    chrome.send(hello(None)).await;
    settings_frame(&mut chrome).await;
    let mut other = Settings::default();
    other.sites.blocked = vec!["hr.example.com/*".into()];
    config::save(&options(dir.path()).config, &other).unwrap();
    let (now, _, _) = settings_frame(&mut chrome).await;
    assert_eq!(now, other);
}

#[tokio::test]
async fn a_broken_hand_edit_keeps_the_last_good_settings_and_warns() {
    let (mut chrome, _path, dir, _task) = start().await;
    let file = options(dir.path()).config;
    let mut good = Settings::default();
    good.sites.blocked = vec!["*.bank.com/*".into()];
    config::save(&file, &good).unwrap();
    chrome.send(hello(None)).await;
    assert_eq!(settings_frame(&mut chrome).await.0, good);
    std::fs::write(&file, "[sites\nblocked = [").unwrap();
    let (now, _, warnings) = settings_frame(&mut chrome).await;
    assert_eq!(now, good, "a broken file must not drop the blocked sites");
    assert!(
        warnings[0].starts_with("config.toml: TOML parse error"),
        "{warnings:?}"
    );
}

#[tokio::test]
async fn reload_reaches_the_extension_of_every_connected_profile() {
    let (mut chrome, _path, dir, _task) = start().await;
    chrome
        .send(Frame::Hello {
            protocol: 1,
            profile_dir: Some("Profile 3".into()),
            extension_version: "0.1.0".into(),
            instance: String::new(),
        })
        .await;
    let (asked, back) =
        browser_hand::reload::reload_all(dir.path(), Duration::from_millis(300)).await;
    assert_eq!(asked, vec!["Profile 3".to_string()]);
    // Nothing restarts this host, so the profile never comes back.
    assert!(back.is_empty());
    assert_eq!(chrome.recv().await, Frame::Reload {});
}

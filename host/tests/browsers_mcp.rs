// list_profiles and select_profile over two browsers (plans/14, decision 2).

use std::path::Path;
use std::sync::{Arc, Mutex};

use browser_hand::mcp::{Launcher, Server, ServerOptions};
use browser_hand::profiles::Root;
use rmcp::model::CallToolResult;
use serde_json::{json, Value};

fn write_state(dir: &Path, profiles: &[(&str, &str)]) {
    std::fs::create_dir_all(dir).unwrap();
    let cache: serde_json::Map<String, Value> = profiles
        .iter()
        .map(|(d, n)| ((*d).to_owned(), json!({ "name": n })))
        .collect();
    let state = json!({ "profile": { "last_used": "Default", "info_cache": cache } });
    std::fs::write(dir.join("Local State"), state.to_string()).unwrap();
}

fn text(r: &CallToolResult) -> String {
    serde_json::to_value(r).unwrap()["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_owned()
}

struct Setup {
    _tmp: tempfile::TempDir,
    server: Server,
    sockets: std::path::PathBuf,
    launched: Arc<Mutex<Vec<String>>>,
}

fn two_browsers() -> Setup {
    let tmp = tempfile::tempdir().unwrap();
    let chrome = tmp.path().join("chrome");
    let brave = tmp.path().join("brave");
    write_state(&chrome, &[("Default", "Me")]);
    write_state(&brave, &[("Default", "Brave me"), ("Profile 1", "Other")]);
    let launched = Arc::new(Mutex::new(Vec::new()));
    let log = launched.clone();
    let launch: Launcher = Arc::new(move |id: &str, _: &str| {
        log.lock().unwrap().push(id.to_owned());
        Ok(false)
    });
    let sockets = tmp.path().join("s");
    std::fs::create_dir_all(&sockets).unwrap();
    let opts = ServerOptions {
        store_id: None,
        pace: None,
        config: tmp.path().join("config.toml"),
    };
    let server = Server::with_roots(
        vec![
            Root {
                browser: "chrome",
                dir: chrome,
            },
            Root {
                browser: "brave",
                dir: brave,
            },
        ],
        sockets.clone(),
        launch,
        opts,
    );
    Setup {
        _tmp: tmp,
        sockets,
        server,
        launched,
    }
}

#[tokio::test]
async fn list_profiles_prefixes_ids_with_the_browser_when_there_are_two() {
    let s = two_browsers();
    let v: Value = serde_json::from_str(&text(&s.server.list_profiles().await.unwrap())).unwrap();
    let got: Vec<(&str, &str)> = v["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["dir"].as_str().unwrap(), p["browser"].as_str().unwrap()))
        .collect();
    assert_eq!(
        got,
        [
            ("chrome:Default", "chrome"),
            ("brave:Default", "brave"),
            ("brave:Profile 1", "brave")
        ]
    );
}

#[tokio::test]
async fn a_bare_dir_two_browsers_share_is_refused_naming_both() {
    let s = two_browsers();
    let args = serde_json::from_value(json!({ "profile": "Default" })).unwrap();
    let r = s
        .server
        .select_profile(rmcp::handler::server::wrapper::Parameters(args))
        .await
        .unwrap();
    let msg = text(&r);
    assert!(
        msg.contains("chrome:Default") && msg.contains("brave:Default"),
        "{msg}"
    );
    assert!(s.launched.lock().unwrap().is_empty());
}

// Two hosts that both answer `Default`: the browser each states keeps them
// apart (plans/15, decision 2).

/// A host on `<sockets>/<n>.sock` that says hello as `dir`, stamped with
/// `browser` (none: an older host or an unknown binary).
fn host_in(sockets: &Path, n: u32, browser: Option<&str>, dir: &str) {
    let listener = tokio::net::UnixListener::bind(sockets.join(format!("{n}.sock"))).unwrap();
    let (chrome, host) = tokio::io::duplex(1 << 20);
    let (hr, hw) = tokio::io::split(host);
    let opts = browser_hand::native_host::HostOptions {
        config: sockets.join("no-config.toml"),
        chrome_dir: sockets.join("no-chrome"),
        poll: std::time::Duration::from_secs(3600),
        browser: browser.map(String::from),
    };
    tokio::spawn(browser_hand::native_host::run(
        hr,
        hw,
        listener,
        format!("inst-{n}"),
        opts,
    ));
    let dir = dir.to_owned();
    tokio::spawn(async move {
        let (mut r, mut w) = tokio::io::split(chrome);
        let hello = browser_hand::wire::Frame::Hello {
            protocol: 1,
            profile_dir: Some(dir),
            extension_version: "0.1.0".into(),
            instance: String::new(),
            browser: None,
        };
        browser_hand::wire::write_frame(&mut w, &hello)
            .await
            .unwrap();
        // Keep the "Chrome" end open and drain what the host sends.
        while let Ok(Some(_)) = browser_hand::wire::read_frame(&mut r).await {}
    });
}

async fn profile(s: &Setup, id: &str) -> Value {
    let v: Value = serde_json::from_str(&text(&s.server.list_profiles().await.unwrap())).unwrap();
    v["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["dir"] == id)
        .unwrap_or_else(|| panic!("no {id} in {v}"))
        .clone()
}

#[tokio::test]
async fn two_hosts_that_answer_default_each_count_for_their_own_browser() {
    let s = two_browsers();
    host_in(&s.sockets, 1, Some("chrome"), "Default");
    host_in(&s.sockets, 2, Some("brave"), "Default");
    for id in ["chrome:Default", "brave:Default"] {
        let p = profile(&s, id).await;
        assert_eq!(p["connected"], true, "{p}");
        assert!(p.get("warning").is_none(), "{p}");
    }
    assert_eq!(profile(&s, "brave:Profile 1").await["connected"], false);
}

#[tokio::test]
async fn a_host_of_one_browser_does_not_connect_the_other_browsers_profile() {
    let s = two_browsers();
    host_in(&s.sockets, 1, Some("chrome"), "Default");
    assert_eq!(profile(&s, "chrome:Default").await["connected"], true);
    assert_eq!(profile(&s, "brave:Default").await["connected"], false);
}

#[tokio::test]
async fn a_host_that_states_no_browser_still_matches_by_dir() {
    let s = two_browsers();
    host_in(&s.sockets, 1, None, "Default");
    assert_eq!(profile(&s, "chrome:Default").await["connected"], true);
    assert_eq!(profile(&s, "brave:Default").await["connected"], true);
}

#[tokio::test]
async fn select_profile_opens_the_browser_asked_for_not_the_one_already_up() {
    let s = two_browsers();
    host_in(&s.sockets, 1, Some("chrome"), "Default");
    let args = serde_json::from_value(json!({ "profile": "brave:Default" })).unwrap();
    let _ = s
        .server
        .select_profile(rmcp::handler::server::wrapper::Parameters(args))
        .await
        .unwrap();
    assert_eq!(
        s.launched.lock().unwrap().first().map(String::as_str),
        Some("brave:Default")
    );
}

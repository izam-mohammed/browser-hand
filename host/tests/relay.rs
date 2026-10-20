use std::time::Duration;

use browser_hand::native_host;
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
    async fn recv(&mut self) -> Frame {
        timeout(T, wire::read_frame(&mut self.read))
            .await
            .unwrap()
            .unwrap()
            .unwrap()
    }
}

/// Starts a host on a temp socket with an in-memory "Chrome" end.
async fn start() -> (
    Chrome,
    std::path::PathBuf,
    tempfile::TempDir,
    tokio::task::JoinHandle<()>,
) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("h.sock");
    let listener = UnixListener::bind(&path).unwrap();
    let (chrome_end, host_end) = tokio::io::duplex(1 << 22);
    let (host_read, host_write) = tokio::io::split(host_end);
    let task = tokio::spawn(async move {
        native_host::run(host_read, host_write, listener, "inst-1".into())
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

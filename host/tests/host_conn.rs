#![cfg(unix)]
// The client end of a host socket, against hand-made listeners that say
// what a real host would, or something it never should.

use std::path::Path;
use std::time::Duration;

use browser_hand::host_conn::{call_error_frame, probe, CallError, HostConn};
use browser_hand::wire::{self, Frame};
use serde_json::json;
use tokio::net::{UnixListener, UnixStream};

const WAIT: Duration = Duration::from_millis(300);

fn hello(protocol: u32, instance: &str) -> Frame {
    Frame::Hello {
        protocol,
        profile_dir: Some("Default".into()),
        extension_version: "0.1.0".into(),
        instance: instance.into(),
        browser: None,
    }
}

/// A listener that sends `first` to whoever connects, then hands the stream
/// to `then`.
fn serve<F, Fut>(path: &Path, first: Option<Frame>, then: F)
where
    F: FnOnce(UnixStream) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    let listener = UnixListener::bind(path).unwrap();
    tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        if let Some(f) = first {
            wire::write_frame(&mut s, &f).await.unwrap();
        }
        then(s).await;
    });
}

#[tokio::test]
async fn probe_reads_the_hello_and_names_what_went_wrong_otherwise() {
    let dir = tempfile::tempdir().unwrap();

    let ok = dir.path().join("ok.sock");
    serve(&ok, Some(hello(1, "a")), |_| async {});
    let info = probe(&ok, WAIT).await.unwrap();
    assert_eq!(info.instance, "a");
    assert_eq!(info.profile_dir.as_deref(), Some("Default"));

    let silent = dir.path().join("silent.sock");
    serve(&silent, None, |s| async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        drop(s);
    });
    let e = probe(&silent, Duration::from_millis(100))
        .await
        .unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::TimedOut);

    let closed = dir.path().join("closed.sock");
    serve(&closed, None, |_| async {});
    let e = probe(&closed, WAIT).await.unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::UnexpectedEof);

    let wrong = dir.path().join("wrong.sock");
    serve(&wrong, Some(Frame::Reload {}), |_| async {});
    let e = probe(&wrong, WAIT).await.unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::InvalidData);
}

#[tokio::test]
async fn a_host_speaking_another_protocol_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old.sock");
    serve(&path, Some(hello(99, "a")), |_| async {});
    let e = HostConn::connect(&path).await.err().unwrap();
    assert_eq!(e.kind(), std::io::ErrorKind::InvalidData);
    assert!(e.to_string().contains("protocol 99"));
}

#[tokio::test]
async fn a_call_gets_its_result_and_a_new_hello_updates_the_info() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("h.sock");
    serve(&path, Some(hello(1, "first")), |mut s| async move {
        // Another hello, a frame the client ignores, then answer the call.
        wire::write_frame(&mut s, &hello(1, "second"))
            .await
            .unwrap();
        wire::write_frame(&mut s, &Frame::Reload {}).await.unwrap();
        if let Ok(Some(Frame::Call { id, tool, .. })) = wire::read_frame(&mut s).await {
            wire::write_frame(
                &mut s,
                &Frame::ok(id, vec![wire::Content::Text { text: tool }]),
            )
            .await
            .unwrap();
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    });

    let conn = HostConn::connect(&path).await.unwrap();
    assert!(conn.is_alive());
    let reply = conn
        .call("s", "find", json!({}), Duration::from_secs(2))
        .await;
    assert!(matches!(reply, Ok(Frame::Result { .. })));
    assert_eq!(conn.hello().instance, "second");
}

#[tokio::test]
async fn a_silent_host_times_out_and_a_host_that_hangs_up_cuts_the_call_off() {
    let dir = tempfile::tempdir().unwrap();

    let slow = dir.path().join("slow.sock");
    serve(&slow, Some(hello(1, "a")), |s| async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        drop(s);
    });
    let conn = HostConn::connect(&slow).await.unwrap();
    let r = conn
        .call("s", "find", json!({}), Duration::from_millis(100))
        .await;
    assert!(matches!(r, Err(CallError::TimedOut)));

    let gone = dir.path().join("gone.sock");
    serve(&gone, Some(hello(1, "b")), |mut s| async move {
        // Read the call, then hang up without answering.
        let _ = wire::read_frame(&mut s).await;
    });
    let conn = HostConn::connect(&gone).await.unwrap();
    let r = conn
        .call("s", "find", json!({}), Duration::from_secs(2))
        .await;
    assert!(matches!(r, Err(CallError::CutOff)));
    // Once the reader has seen the close, the connection reports itself dead.
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!conn.is_alive());
}

#[test]
fn the_error_frames_name_the_cause() {
    match call_error_frame(CallError::Disconnected, "find", WAIT) {
        Frame::Result { .. } => {}
        f => panic!("{f:?}"),
    }
    let json = serde_json::to_string(&call_error_frame(CallError::TimedOut, "find", WAIT)).unwrap();
    assert!(json.contains("find did not answer within 0 s"), "{json}");
    let json =
        serde_json::to_string(&call_error_frame(CallError::Disconnected, "find", WAIT)).unwrap();
    assert!(json.contains("not_connected"), "{json}");
}

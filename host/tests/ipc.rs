#![cfg(unix)]
// The Unix side of `ipc`: what the native host and the MCP server now go
// through (`plans/16-windows.md`, decision 1). The pipe side is
// `tests/pipe_windows.rs`.

use std::os::unix::fs::PermissionsExt;

use browser_hand::ipc::{self, Accept};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn a_bound_socket_is_private_replaces_a_leftover_and_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("7.sock");
    std::fs::write(&path, "leftover").unwrap();
    let mut listener = ipc::bind(&path).unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );

    let server = tokio::spawn(async move {
        let mut conn = Accept::accept(&mut listener).await.unwrap();
        let mut buf = [0u8; 4];
        conn.read_exact(&mut buf).await.unwrap();
        conn.write_all(&buf).await.unwrap();
    });
    let mut c = ipc::connect(&path).await.unwrap();
    c.write_all(b"ping").await.unwrap();
    let mut back = [0u8; 4];
    c.read_exact(&mut back).await.unwrap();
    assert_eq!(&back, b"ping");
    server.await.unwrap();
}

#[test]
fn list_takes_sock_files_only_and_forget_removes_a_refused_one() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("1.sock"), "").unwrap();
    std::fs::write(dir.path().join("notes.txt"), "").unwrap();
    assert_eq!(ipc::list(dir.path()), [dir.path().join("1.sock")]);
    assert!(ipc::list(&dir.path().join("missing")).is_empty());

    let other = std::io::Error::from(std::io::ErrorKind::TimedOut);
    ipc::forget_stale(&dir.path().join("1.sock"), &other);
    assert!(dir.path().join("1.sock").exists());
    let refused = std::io::Error::from(std::io::ErrorKind::ConnectionRefused);
    ipc::forget_stale(&dir.path().join("1.sock"), &refused);
    assert!(!dir.path().join("1.sock").exists());
}

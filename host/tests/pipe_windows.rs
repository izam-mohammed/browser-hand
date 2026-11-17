#![cfg(windows)]
// Windows only: the named pipe round trip, the owner-only descriptor and the
// listing. Not run by the builder (no Windows machine): `docs/testing.md`
// lists it for the first Windows walk (`plans/16-windows.md`, phase 3).

use browser_hand::ipc::{self, Accept};
use browser_hand::{paths, winos, winsys};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn a_pipe_round_trips_lists_and_belongs_to_this_user() {
    let dir = std::env::temp_dir().join(format!("bh-pipe-{}", std::process::id()));
    std::env::set_var("BROWSER_HAND_SOCKET_DIR", &dir);
    let path = paths::socket_path(std::process::id());
    assert!(path.to_string_lossy().starts_with(winos::PIPE_ROOT));

    let mut listener = ipc::bind(&path).unwrap();
    // A second server on the same name is refused (first instance only).
    assert!(ipc::bind(&path).is_err());
    // It is listed under this scope, and only there.
    assert_eq!(ipc::list(&paths::socket_dir()), std::slice::from_ref(&path));

    let server = tokio::spawn(async move {
        let mut conn = listener.accept().await.unwrap();
        let mut buf = [0u8; 4];
        conn.read_exact(&mut buf).await.unwrap();
        conn.write_all(&buf).await.unwrap();
        conn
    });
    // `connect` also checks the server runs as this user.
    let mut c = ipc::connect(&path).await.unwrap();
    c.write_all(b"ping").await.unwrap();
    let mut back = [0u8; 4];
    c.read_exact(&mut back).await.unwrap();
    assert_eq!(&back, b"ping");
    let _keep = server.await.unwrap();

    // The descriptor names the current user's SID and nothing else.
    let sid = winsys::current_user_sid().unwrap();
    assert!(sid.starts_with("S-1-5-"), "{sid}");
    assert_eq!(
        winos::pipe_sddl(&sid).unwrap(),
        format!("D:P(A;;GA;;;{sid})")
    );
}

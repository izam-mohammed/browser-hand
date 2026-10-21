// A native host told to stop has to exit, even while Chrome still holds
// its stdin open; otherwise the extension never sees the port close.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[test]
fn native_host_exits_on_sigterm_with_stdin_open() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_browser-hand"))
        .arg("chrome-extension://ednpkicgdjiiihmophoifehfeeoabjdc/")
        .env("BROWSER_HAND_SOCKET_DIR", dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let sock = dir.path().join(format!("{}.sock", child.id()));

    let start = Instant::now();
    while !sock.exists() {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "the host never bound its socket"
        );
        std::thread::sleep(Duration::from_millis(20));
    }

    unsafe { libc::kill(child.id() as i32, libc::SIGTERM) };
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().unwrap() {
            break s;
        }
        if start.elapsed() > Duration::from_secs(3) {
            let _ = child.kill();
            panic!("the host was still running 3 s after SIGTERM");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    assert!(status.success(), "exit status {status}");
    assert!(!sock.exists(), "the socket file was left behind");
}

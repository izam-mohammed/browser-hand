// The binary's own entry points, run as Chrome and Claude Code run them,
// against a temporary Chrome directory and socket directory.

use std::process::{Command, Output, Stdio};

use browser_hand::install::HOST_NAME;

fn run(args: &[&str], chrome: &std::path::Path, sockets: &std::path::Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_browser-hand"))
        .args(args)
        .env("BROWSER_HAND_CHROME_DIR", chrome)
        .env("BROWSER_HAND_SOCKET_DIR", sockets)
        .stdin(Stdio::null())
        .output()
        .unwrap()
}

fn out(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}

fn err(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

#[test]
fn no_subcommand_prints_usage_and_exits_2() {
    let dir = tempfile::tempdir().unwrap();
    let o = run(&[], dir.path(), dir.path());
    assert_eq!(o.status.code(), Some(2));
    assert!(err(&o).contains("usage: browser-hand"));

    let o = run(&["nonsense"], dir.path(), dir.path());
    assert_eq!(o.status.code(), Some(2));
}

#[test]
fn install_writes_the_manifest_and_uninstall_removes_it() {
    let chrome = tempfile::tempdir().unwrap();
    let sockets = tempfile::tempdir().unwrap();
    let manifest = chrome
        .path()
        .join("NativeMessagingHosts")
        .join(format!("{HOST_NAME}.json"));

    let o = run(&["install"], chrome.path(), sockets.path());
    assert!(o.status.success(), "{}", err(&o));
    assert!(out(&o).contains("Installed"));
    assert!(out(&o).contains("Extension ID:"));
    assert!(manifest.is_file());

    let o = run(&["install", "--uninstall"], chrome.path(), sockets.path());
    assert!(o.status.success());
    assert!(out(&o).contains("Removed"));
    assert!(!manifest.exists());

    let o = run(&["install", "--uninstall"], chrome.path(), sockets.path());
    assert!(o.status.success());
    assert!(out(&o).contains("Nothing to remove"));
}

#[test]
fn install_into_a_chrome_dir_that_is_a_file_fails_with_a_message() {
    let dir = tempfile::tempdir().unwrap();
    let not_a_dir = dir.path().join("chrome");
    std::fs::write(&not_a_dir, "x").unwrap();
    let o = run(&["install"], &not_a_dir, dir.path());
    assert_eq!(o.status.code(), Some(1));
    assert!(err(&o).contains("browser-hand:"));
}

#[test]
fn uninstall_that_cannot_remove_the_manifest_fails_with_its_path() {
    let chrome = tempfile::tempdir().unwrap();
    // A directory where the manifest should be: removing it as a file fails
    // with something other than "not found".
    let manifest = chrome
        .path()
        .join("NativeMessagingHosts")
        .join(format!("{HOST_NAME}.json"));
    std::fs::create_dir_all(&manifest).unwrap();
    let o = run(&["install", "--uninstall"], chrome.path(), chrome.path());
    assert_eq!(o.status.code(), Some(1));
    assert!(err(&o).contains("removing"));
}

#[test]
fn reload_with_no_connected_profile_says_there_is_nothing_to_reload() {
    let dir = tempfile::tempdir().unwrap();
    let o = run(&["reload"], dir.path(), dir.path());
    assert!(o.status.success());
    assert!(out(&o).contains("nothing to reload"));
}

#[test]
fn the_native_host_mode_is_chosen_by_chromes_origin_argument_and_stops_with_its_pipe() {
    let dir = tempfile::tempdir().unwrap();
    // stdin is already closed, as when Chrome goes away: the host ends.
    let o = run(
        &["chrome-extension://ednpkicgdjiiihmophoifehfeeoabjdc/"],
        dir.path(),
        dir.path(),
    );
    assert!(o.status.success(), "{}", err(&o));
}

#[test]
fn the_mcp_server_ends_when_claude_closes_its_stdin() {
    let dir = tempfile::tempdir().unwrap();
    let o = run(&["mcp"], dir.path(), dir.path());
    // The exit status depends on how rmcp reports a closed transport; what
    // matters is that it ends and does not print a usage error.
    assert!(!err(&o).contains("usage:"));
}

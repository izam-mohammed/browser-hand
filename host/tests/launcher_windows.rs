#![cfg(unix)]
// The Windows launcher, run on Linux with a stand-in exe: it finds the
// browser in the install folders only, passes the profile flag and URL as
// separate arguments, and never searches `PATH` (`plans/16-windows.md`,
// decision 5). One test: it sets the environment for the whole process.

use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

use browser_hand::mcp::{launcher_for, lockfile_held};
use browser_hand::profiles::Os;

#[test]
fn windows_launch_uses_install_folders_and_never_path() {
    let root = tempfile::tempdir().unwrap();
    let bin_dir = tempfile::tempdir().unwrap();
    // A stand-in on PATH must not be run.
    let decoy = bin_dir.path().join("chrome.exe");
    std::fs::write(&decoy, "#!/bin/sh\nexit 0\n").unwrap();
    std::env::set_var("PATH", bin_dir.path());
    std::env::set_var("ProgramFiles", root.path().join("pf"));
    std::env::set_var("ProgramFiles(x86)", root.path().join("pf86"));
    std::env::set_var("LOCALAPPDATA", root.path().join("local"));
    std::env::remove_var("BROWSER_HAND_CHROME_DIR");
    std::env::remove_var("BROWSER_HAND_BROWSER_BIN");

    let launch = launcher_for(Os::Windows);
    let e = launch("Default", "https://example.com/")
        .unwrap_err()
        .to_string();
    assert!(e.contains("Google Chrome"), "{e}");
    assert!(e.contains("chrome.exe"), "{e}");
    assert!(e.contains("BROWSER_HAND_BROWSER_BIN"), "{e}");
    assert!(e.contains("pf86"), "{e}");

    // Found in %LOCALAPPDATA%: run directly with the flag and the URL as
    // separate arguments. No lockfile held: the browser was started.
    let log = root.path().join("args.log");
    let exe = root
        .path()
        .join("local/Google/Chrome/Application/chrome.exe");
    std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
    std::fs::write(
        &exe,
        format!(
            "#!/bin/sh\nfor a in \"$@\"; do echo \"[$a]\"; done > {}\n",
            log.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(launch("Profile 3", "https://example.com/?a=1&b=2").unwrap());
    let end = Instant::now() + Duration::from_secs(5);
    let args = loop {
        if let Ok(s) = std::fs::read_to_string(&log) {
            if !s.is_empty() {
                break s;
            }
        }
        assert!(Instant::now() < end, "no log");
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(
        args,
        "[--profile-directory=Profile 3]\n[https://example.com/?a=1&b=2]\n"
    );
}

#[test]
fn a_missing_lockfile_is_not_a_running_browser() {
    let dir = tempfile::tempdir().unwrap();
    assert!(!lockfile_held(dir.path()));
    std::fs::write(dir.path().join("lockfile"), "").unwrap();
    // Held means a sharing violation (Windows error 32); a plain file is free.
    assert!(!lockfile_held(dir.path()));
}

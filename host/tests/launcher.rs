#![cfg(unix)]
// The launchers run `pgrep` and `open` (macOS) or a browser binary (Linux);
// stand-ins on PATH show what they pass and how they read exit status. One
// test, because it sets PATH, HOME and BROWSER_HAND_* for the whole process.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{Duration, Instant};

use browser_hand::mcp::launcher_for;
use browser_hand::profiles::Os;

fn script(dir: &Path, name: &str, body: &str) {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// The log once the stand-in has written it (it runs detached).
fn read_log(log: &Path) -> String {
    let end = Instant::now() + Duration::from_secs(5);
    while Instant::now() < end {
        if let Ok(s) = std::fs::read_to_string(log) {
            if !s.is_empty() {
                return s;
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("no log at {}", log.display());
}

#[test]
fn launchers_per_os() {
    let dir = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    std::env::set_var("PATH", dir.path());
    std::env::set_var("HOME", home.path());
    std::env::remove_var("BROWSER_HAND_CHROME_DIR");
    std::env::remove_var("BROWSER_HAND_BROWSER_BIN");

    // macOS: `open -na`.
    let log = dir.path().join("open.log");
    script(
        dir.path(),
        "open",
        &format!(
            "echo \"$@\" > {}\n[ -f {}/fail ] && exit 3\nexit 0",
            log.display(),
            dir.path().display()
        ),
    );
    let launch = launcher_for(Os::Mac);

    // pgrep finding nothing means Chrome is not running: it is started.
    script(dir.path(), "pgrep", "exit 1");
    assert!(launch("Profile 3", "https://example.com/claim").unwrap());
    let args = std::fs::read_to_string(&log).unwrap();
    assert!(args.contains("-na Google Chrome --args"), "{args}");
    assert!(args.contains("--profile-directory=Profile 3"), "{args}");
    assert!(args.contains("https://example.com/claim"), "{args}");

    // Another browser's id picks its app.
    script(dir.path(), "pgrep", "exit 0");
    assert!(!launch("brave:Default", "https://example.com/").unwrap());
    let args = std::fs::read_to_string(&log).unwrap();
    assert!(args.contains("-na Brave Browser --args"), "{args}");
    assert!(args.contains("--profile-directory=Default"), "{args}");

    // `open` failing is an error naming its status.
    std::fs::write(dir.path().join("fail"), "").unwrap();
    let e = launch("Default", "https://example.com/").unwrap_err();
    assert!(e.to_string().contains("open exited with"), "{e}");

    // Linux: no browser binary on PATH names what was tried.
    let launch = launcher_for(Os::Linux);
    let e = launch("Default", "https://example.com/").unwrap_err();
    let msg = e.to_string();
    assert!(msg.contains("google-chrome-stable"), "{msg}");
    assert!(msg.contains("BROWSER_HAND_BROWSER_BIN"), "{msg}");

    // Linux: the first binary in the table order wins, the profile flag and
    // URL reach it, and a closed browser (no SingletonLock) is "started".
    let blog = dir.path().join("bin.log");
    let body = format!("echo \"$0 $@\" > {}", blog.display());
    script(dir.path(), "chromium", &body);
    script(dir.path(), "google-chrome", &body);
    assert!(launch("Profile 3", "https://example.com/claim").unwrap());
    let args = read_log(&blog);
    assert!(
        args.contains("/google-chrome --profile-directory=Profile 3 https://example.com/claim"),
        "{args}"
    );
    assert!(!args.contains("--user-data-dir"), "{args}");

    // A running browser (SingletonLock in its data dir) is not started.
    let chrome = home.path().join(".config/google-chrome");
    std::fs::create_dir_all(&chrome).unwrap();
    std::os::unix::fs::symlink("host-1234", chrome.join("SingletonLock")).unwrap();
    std::fs::remove_file(&blog).unwrap();
    assert!(!launch("Default", "https://example.com/").unwrap());
    read_log(&blog);

    // Another browser's id picks its own binaries and data dir.
    std::fs::remove_file(&blog).unwrap();
    script(dir.path(), "brave-browser", &body);
    assert!(launch("brave:Default", "https://example.com/").unwrap());
    let args = read_log(&blog);
    assert!(
        args.contains("/brave-browser --profile-directory=Default"),
        "{args}"
    );

    // The override beats the table; BROWSER_HAND_CHROME_DIR adds the data dir.
    std::fs::remove_file(&blog).unwrap();
    script(dir.path(), "mine", &body);
    std::env::set_var("BROWSER_HAND_BROWSER_BIN", dir.path().join("mine"));
    std::env::set_var("BROWSER_HAND_CHROME_DIR", "/tmp/bh-udd");
    launch("Default", "https://example.com/").unwrap();
    let args = read_log(&blog);
    assert!(
        args.contains("/mine --user-data-dir=/tmp/bh-udd --profile-directory=Default"),
        "{args}"
    );
    std::env::remove_var("BROWSER_HAND_BROWSER_BIN");
    std::env::remove_var("BROWSER_HAND_CHROME_DIR");
}

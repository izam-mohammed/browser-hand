// `open_in_chrome` runs `pgrep` and `open`; stand-ins on PATH show what it
// passes them and how it reads their exit status. One test, because it
// sets PATH for the whole process.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use browser_hand::mcp::open_in_chrome;

fn script(dir: &Path, name: &str, body: &str) {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn opens_the_profile_with_open_and_reports_whether_chrome_had_to_start() {
    let dir = tempfile::tempdir().unwrap();
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
    std::env::set_var("PATH", dir.path());
    let launch = open_in_chrome();

    // pgrep finding nothing means Chrome is not running: it is started.
    script(dir.path(), "pgrep", "exit 1");
    assert!(launch("Profile 3", "https://example.com/claim").unwrap());
    let args = std::fs::read_to_string(&log).unwrap();
    assert!(args.contains("-na Google Chrome --args"), "{args}");
    assert!(args.contains("--profile-directory=Profile 3"), "{args}");
    assert!(args.contains("https://example.com/claim"), "{args}");

    // Chrome already running: not started.
    script(dir.path(), "pgrep", "exit 0");
    assert!(!launch("Default", "https://example.com/").unwrap());

    // `open` failing is an error naming its status.
    std::fs::write(dir.path().join("fail"), "").unwrap();
    let e = launch("Default", "https://example.com/").unwrap_err();
    assert!(e.to_string().contains("open exited with"), "{e}");
}

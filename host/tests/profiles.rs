use std::time::Duration;

use browser_hand::profiles::{self, Profile};

fn fixture_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::copy(
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/local-state.json"
        ),
        dir.path().join("Local State"),
    )
    .unwrap();
    dir
}

fn p(root: &std::path::Path, dir: &str, name: &str, last_used: bool) -> Profile {
    Profile {
        dir: dir.into(),
        id: dir.into(),
        browser: "chrome".into(),
        root: root.to_owned(),
        name: name.into(),
        last_used,
    }
}

#[test]
fn reads_profiles_in_chromes_order_without_ephemeral_ones() {
    let dir = fixture_dir();
    let got = profiles::read_profiles(dir.path()).unwrap();
    assert_eq!(
        got,
        vec![
            p(dir.path(), "Default", "Personal", false),
            p(dir.path(), "Profile 3", "Work", true),
            p(dir.path(), "Profile 4", "Testing", false)
        ]
    );
}

#[test]
fn never_reads_out_email_addresses() {
    let dir = fixture_dir();
    let json = serde_json::to_string(&profiles::read_profiles(dir.path()).unwrap()).unwrap();
    assert!(!json.contains('@'));
}

#[test]
fn a_missing_local_state_is_an_error_naming_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let e = profiles::read_profiles(dir.path()).unwrap_err();
    assert!(format!("{e:#}").contains("Local State"));
}

#[test]
fn resolves_by_dir_then_name_in_any_case() {
    let dir = fixture_dir();
    let all = profiles::read_profiles(dir.path()).unwrap();
    assert_eq!(profiles::resolve(&all, "Profile 3").unwrap().name, "Work");
    assert_eq!(profiles::resolve(&all, "work").unwrap().dir, "Profile 3");
    assert_eq!(
        profiles::resolve(&all, " profile 4 ").unwrap().name,
        "Testing"
    );
    assert!(profiles::resolve(&all, "nope").is_none());
}

#[tokio::test]
async fn discovery_removes_stale_sockets_and_ignores_other_files() {
    let dir = tempfile::tempdir().unwrap();
    // A socket file with no listener: bind, then drop the listener.
    let stale = dir.path().join("1.sock");
    drop(std::os::unix::net::UnixListener::bind(&stale).unwrap());
    std::fs::write(dir.path().join("notes.txt"), "x").unwrap();

    let live = profiles::discover(dir.path(), Duration::from_millis(200)).await;
    assert!(live.is_empty());
    assert!(!stale.exists(), "stale socket should be removed");
    assert!(dir.path().join("notes.txt").exists());
}

#[tokio::test]
async fn discovery_of_a_missing_dir_is_empty() {
    let live = profiles::discover(
        std::path::Path::new("/nonexistent/bh"),
        Duration::from_millis(100),
    )
    .await;
    assert!(live.is_empty());
}

// Browser table and the merged list (plans/14, decisions 1 and 2).

use browser_hand::profiles::{Os, Root};
use std::path::Path;

fn write_state(dir: &Path, profiles: &[(&str, &str)]) {
    std::fs::create_dir_all(dir).unwrap();
    let cache: serde_json::Map<String, serde_json::Value> = profiles
        .iter()
        .map(|(d, n)| ((*d).to_owned(), serde_json::json!({ "name": n })))
        .collect();
    let state = serde_json::json!({ "profile": { "last_used": "Default", "info_cache": cache } });
    std::fs::write(dir.join("Local State"), state.to_string()).unwrap();
}

#[test]
fn the_browser_table_gives_each_browsers_dir_per_os() {
    let home = Path::new("/home/u");
    let linux: Vec<_> = profiles::BROWSERS
        .iter()
        .map(|b| profiles::data_dir(Os::Linux, home, b))
        .collect();
    assert_eq!(
        linux,
        [
            "/home/u/.config/google-chrome",
            "/home/u/.config/chromium",
            "/home/u/.config/microsoft-edge",
            "/home/u/.config/BraveSoftware/Brave-Browser",
            "/home/u/.config/vivaldi",
        ]
        .map(Path::new)
    );
    let mac: Vec<_> = profiles::BROWSERS
        .iter()
        .map(|b| profiles::data_dir(Os::Mac, home, b))
        .collect();
    assert_eq!(
        mac[0],
        Path::new("/home/u/Library/Application Support/Google/Chrome")
    );
    assert_eq!(
        mac[3],
        Path::new("/home/u/Library/Application Support/BraveSoftware/Brave-Browser")
    );
}

#[test]
fn only_browsers_whose_dir_exists_are_installed() {
    let home = tempfile::tempdir().unwrap();
    assert!(profiles::installed_roots(Os::Linux, home.path()).is_empty());
    std::fs::create_dir_all(home.path().join(".config/BraveSoftware/Brave-Browser")).unwrap();
    std::fs::create_dir_all(home.path().join(".config/google-chrome")).unwrap();
    let keys: Vec<_> = profiles::installed_roots(Os::Linux, home.path())
        .iter()
        .map(|r| r.browser)
        .collect();
    assert_eq!(keys, ["chrome", "brave"]);
}

#[test]
fn one_browser_keeps_bare_ids_and_two_get_prefixed_ids() {
    let home = tempfile::tempdir().unwrap();
    let chrome = home.path().join("c");
    let brave = home.path().join("b");
    write_state(&chrome, &[("Default", "Me"), ("Profile 3", "Work")]);
    write_state(&brave, &[("Default", "Brave me")]);
    let root = |browser, dir: &Path| Root {
        browser,
        dir: dir.to_owned(),
    };

    let one = profiles::read_all(&[root("chrome", &chrome)]).unwrap();
    let ids: Vec<_> = one.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["Default", "Profile 3"]);

    let two = profiles::read_all(&[root("chrome", &chrome), root("brave", &brave)]).unwrap();
    let ids: Vec<_> = two.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["chrome:Default", "chrome:Profile 3", "brave:Default"]);
    assert_eq!(two[2].browser, "brave");
    assert_eq!(two[2].dir, "Default");
    assert_eq!(two[2].root, brave);

    // The id picks the browser; the bare shared dir is refused; a unique
    // bare dir and a name still work.
    assert_eq!(
        profiles::resolve(&two, "brave:Default").unwrap().name,
        "Brave me"
    );
    assert!(profiles::resolve(&two, "Default").is_none());
    assert_eq!(profiles::ambiguous(&two, "Default").len(), 2);
    assert_eq!(
        profiles::resolve(&two, "Profile 3").unwrap().id,
        "chrome:Profile 3"
    );
    assert_eq!(
        profiles::resolve(&two, "brave me").unwrap().id,
        "brave:Default"
    );
}

#[test]
fn an_unreadable_browser_is_skipped_while_another_reads() {
    let home = tempfile::tempdir().unwrap();
    let chrome = home.path().join("c");
    write_state(&chrome, &[("Default", "Me")]);
    let bad = Root {
        browser: "edge",
        dir: home.path().join("nope"),
    };
    let good = Root {
        browser: "chrome",
        dir: chrome,
    };
    assert_eq!(profiles::read_all(&[bad.clone(), good]).unwrap().len(), 1);
    assert!(profiles::read_all(&[bad]).is_err());
}

// Which browser a host runs in (plans/15, decision 1).

fn roots_of(pairs: &[(&'static str, &str)]) -> Vec<Root> {
    pairs
        .iter()
        .map(|(browser, dir)| Root {
            browser,
            dir: dir.into(),
        })
        .collect()
}

#[test]
fn the_user_data_dir_decides_before_the_binary() {
    let roots = roots_of(&[("edge", "/h/.config/edge"), ("brave", "/h/.config/brave")]);
    // One binary, two data dirs: the dir tells them apart.
    let exe = Some(Path::new("/opt/cft/chrome"));
    assert_eq!(
        profiles::identify(exe, Some(Path::new("/h/.config/brave")), &roots),
        Some("brave")
    );
    assert_eq!(
        profiles::identify(exe, Some(Path::new("/h/.config/edge/")), &roots),
        Some("edge")
    );
}

#[test]
fn the_binary_name_decides_when_the_dir_is_none_or_unknown() {
    let roots = roots_of(&[("chrome", "/h/c")]);
    for (exe, want) in [
        ("/opt/google/chrome/chrome", "chrome"),
        ("/opt/brave.com/brave/brave", "brave"),
        ("/opt/vivaldi/vivaldi-bin", "vivaldi"),
        ("/opt/microsoft/msedge/msedge", "edge"),
        ("/usr/lib/chromium/chromium", "chromium"),
        (
            "/snap/chromium/9/usr/lib/chromium-browser/chrome",
            "chromium",
        ),
        ("/tmp/cft/chrome-linux64/chrome", "chrome"),
        (
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "brave",
        ),
        (
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "edge",
        ),
        (
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "chrome",
        ),
    ] {
        assert_eq!(
            profiles::identify(Some(Path::new(exe)), None, &roots),
            Some(want),
            "{exe}"
        );
        assert_eq!(
            profiles::identify(Some(Path::new(exe)), Some(Path::new("/elsewhere")), &roots),
            Some(want),
            "{exe} with an unknown dir"
        );
    }
}

#[test]
fn nothing_known_says_nothing() {
    let roots = roots_of(&[("chrome", "/h/c")]);
    assert_eq!(profiles::identify(None, None, &roots), None);
    assert_eq!(
        profiles::identify(Some(Path::new("/usr/bin/env")), None, &roots),
        None
    );
}

#[test]
fn a_hostile_path_cannot_name_a_browser() {
    let roots = roots_of(&[("chrome", "/h/c")]);
    // Only the file name, its folder and `.app` parts count, never a home
    // folder or an argument that happens to say brave.
    for exe in [
        "/home/brave/bin/runner",
        "/tmp/x brave/run",
        "/tmp/vivaldi/x/y/z",
    ] {
        assert_eq!(
            profiles::identify(Some(Path::new(exe)), None, &roots),
            None,
            "{exe}"
        );
    }
}

#[test]
fn the_user_data_dir_flag_is_found_in_a_command_line() {
    let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(
        profiles::user_data_dir_arg(&args(&["chrome", "--user-data-dir=/a b", "x"])),
        Some("/a b".into())
    );
    assert_eq!(
        profiles::user_data_dir_arg(&args(&["chrome", "--user-data-dir", "/c", "x"])),
        Some("/c".into())
    );
    assert_eq!(
        profiles::user_data_dir_arg(&args(&["chrome", "https://u"])),
        None
    );
}

#[test]
fn a_parent_that_is_gone_gives_no_identity() {
    assert_eq!(profiles::parent_identity(u32::MAX, &[]), None);
}

#[test]
fn the_parent_of_this_process_is_read_without_error() {
    // The test runner's parent (cargo or a shell) is no browser.
    let ppid = std::os::unix::process::parent_id();
    assert_eq!(profiles::parent_identity(ppid, &[]), None);
}

#[test]
fn browser_dirs_come_from_home_never_from_a_profile_name() {
    let home = Path::new("/home/u");
    for b in profiles::BROWSERS {
        for os in [Os::Linux, Os::Mac] {
            assert!(profiles::data_dir(os, home, b).starts_with(home));
        }
    }
}

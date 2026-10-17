use std::time::Duration;

use browser_hand::profiles::{self, Profile};

fn fixture_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::copy(
        concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/local-state.json"),
        dir.path().join("Local State"),
    )
    .unwrap();
    dir
}

fn p(dir: &str, name: &str, last_used: bool) -> Profile {
    Profile { dir: dir.into(), name: name.into(), last_used }
}

#[test]
fn reads_profiles_in_chromes_order_without_ephemeral_ones() {
    let dir = fixture_dir();
    let got = profiles::read_profiles(dir.path()).unwrap();
    assert_eq!(
        got,
        vec![p("Default", "Personal", false), p("Profile 3", "Work", true), p("Profile 4", "Testing", false)]
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
    assert_eq!(profiles::resolve(&all, " profile 4 ").unwrap().name, "Testing");
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
    let live = profiles::discover(std::path::Path::new("/nonexistent/bh"), Duration::from_millis(100)).await;
    assert!(live.is_empty());
}

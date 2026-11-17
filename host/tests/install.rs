use browser_hand::install::{self, Options, HOST_NAME};
use browser_hand::mcp::EXTENSION_ID;
use serde_json::Value;

#[test]
fn the_manifest_names_this_host_the_binary_and_only_our_extension() {
    let dir = tempfile::tempdir().unwrap();
    let exe = std::path::Path::new("/opt/browser-hand/bin/browser-hand");
    let path = install::write_manifest(dir.path(), exe, None).unwrap();
    assert_eq!(
        path,
        dir.path()
            .join("NativeMessagingHosts")
            .join(format!("{HOST_NAME}.json"))
    );

    let m: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(m["name"], HOST_NAME);
    assert_eq!(m["type"], "stdio");
    assert_eq!(m["path"], "/opt/browser-hand/bin/browser-hand");
    assert_eq!(
        m["allowed_origins"],
        serde_json::json!([format!("chrome-extension://{EXTENSION_ID}/")])
    );
}

#[test]
fn the_host_name_is_one_chrome_accepts_and_not_anthropics() {
    // Lowercase alphanumerics, underscores and dots; no leading, trailing or
    // doubled dots (docs/external/chrome-native-messaging.md § Host manifest).
    assert!(HOST_NAME
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.'));
    assert!(!HOST_NAME.starts_with('.') && !HOST_NAME.ends_with('.') && !HOST_NAME.contains(".."));
    assert!(!HOST_NAME.contains("anthropic"));
}

const STORE_ID: &str = "abcdefghijklmnopabcdefghijklmnop";

#[test]
fn the_manifest_allows_the_store_id_beside_ours_when_they_differ() {
    let dir = tempfile::tempdir().unwrap();
    let exe = std::path::Path::new("/opt/bh");
    let path = install::write_manifest(dir.path(), exe, Some(STORE_ID)).unwrap();
    let m: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(
        m["allowed_origins"],
        serde_json::json!([
            format!("chrome-extension://{EXTENSION_ID}/"),
            format!("chrome-extension://{STORE_ID}/")
        ])
    );
    // The same ID twice is listed once.
    let path = install::write_manifest(dir.path(), exe, Some(EXTENSION_ID)).unwrap();
    let m: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(m["allowed_origins"].as_array().unwrap().len(), 1);
}

#[test]
fn the_external_extensions_file_has_this_path_and_exactly_this_body() {
    let dir = tempfile::tempdir().unwrap();
    let path = install::write_external_extension(dir.path(), STORE_ID).unwrap();
    assert_eq!(
        path,
        dir.path()
            .join("External Extensions")
            .join(format!("{STORE_ID}.json"))
    );
    let v: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(
        v,
        serde_json::json!({"external_update_url": "https://clients2.google.com/service/update2/crx"})
    );
}

#[test]
fn the_external_extensions_file_name_is_the_id_in_lowercase() {
    let dir = tempfile::tempdir().unwrap();
    let path =
        install::write_external_extension(dir.path(), "ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP").unwrap();
    assert_eq!(
        path.file_name().unwrap().to_str().unwrap(),
        format!("{STORE_ID}.json")
    );
}

fn opts() -> Options {
    Options::default()
}

fn run(dir: &std::path::Path, o: &Options, store: Option<&str>) -> (anyhow::Result<()>, String) {
    let mut out = Vec::new();
    let r = install::run(dir, std::path::Path::new("/opt/bh"), o, store, &mut out);
    (r, String::from_utf8(out).unwrap())
}

fn ext_file(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("External Extensions")
        .join(format!("{STORE_ID}.json"))
}

#[test]
fn install_writes_both_files_and_says_to_restart_chrome() {
    let dir = tempfile::tempdir().unwrap();
    let (r, out) = run(dir.path(), &opts(), Some(STORE_ID));
    r.unwrap();
    assert!(install::manifest_path(dir.path()).is_file());
    assert!(ext_file(dir.path()).is_file());
    assert!(
        out.contains("quit and reopen Chrome, then click Enable in each profile"),
        "{out}"
    );
}

#[test]
fn no_store_writes_only_the_host_manifest() {
    let dir = tempfile::tempdir().unwrap();
    let o = Options {
        no_store: true,
        ..opts()
    };
    let (r, out) = run(dir.path(), &o, Some(STORE_ID));
    r.unwrap();
    assert!(install::manifest_path(dir.path()).is_file());
    assert!(!ext_file(dir.path()).exists());
    assert!(out.contains("Load unpacked"), "{out}");
}

#[test]
fn with_no_store_id_built_in_install_writes_no_file_and_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let (r, out) = run(dir.path(), &opts(), None);
    r.unwrap();
    assert!(install::manifest_path(dir.path()).is_file());
    assert!(!dir.path().join("External Extensions").exists());
    assert!(out.contains("no Chrome Web Store ID"), "{out}");
    assert!(out.contains("Load unpacked"), "{out}");
}

#[test]
fn uninstall_removes_both_and_says_nothing_to_remove_when_absent() {
    let dir = tempfile::tempdir().unwrap();
    run(dir.path(), &opts(), Some(STORE_ID)).0.unwrap();
    let un = Options {
        uninstall: true,
        ..opts()
    };
    let (r, out) = run(dir.path(), &un, Some(STORE_ID));
    r.unwrap();
    assert!(!install::manifest_path(dir.path()).exists());
    assert!(!ext_file(dir.path()).exists());
    assert!(out.contains("Removed"), "{out}");

    let (r, out) = run(dir.path(), &un, Some(STORE_ID));
    r.unwrap();
    assert!(out.contains("Nothing to remove"), "{out}");
}

#[test]
fn options_parse_the_flags_and_refuse_unknown_ones() {
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let o = Options::parse(&a(&["install", "--uninstall", "--no-store"])).unwrap();
    assert!(o.uninstall && o.no_store && o.mobileconfig.is_none());
    let o = Options::parse(&a(&["install", "--mobileconfig", "/tmp/x.mobileconfig"])).unwrap();
    assert_eq!(
        o.mobileconfig.as_deref(),
        Some(std::path::Path::new("/tmp/x.mobileconfig"))
    );
    assert!(Options::parse(&a(&["install", "--mobileconfig"])).is_err());
    assert!(Options::parse(&a(&["install", "--frobnicate"])).is_err());
}

fn uuids(s: &str) -> Vec<String> {
    s.split("<key>PayloadUUID</key>")
        .skip(1)
        .map(|rest| {
            let a = rest.find("<string>").unwrap() + 8;
            let b = rest.find("</string>").unwrap();
            rest[a..b].to_owned()
        })
        .collect()
}

#[test]
fn the_mobileconfig_forces_the_store_extension_with_fresh_uuids() {
    let a = install::mobileconfig(STORE_ID);
    let b = install::mobileconfig(STORE_ID);
    assert!(a.starts_with("<?xml"));
    assert!(a.contains("<string>com.google.Chrome</string>"));
    assert!(a.contains("<key>ExtensionInstallForcelist</key>"));
    assert!(a.contains(&format!(
        "<string>{STORE_ID};https://clients2.google.com/service/update2/crx</string>"
    )));
    let ids = uuids(&a);
    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
    assert_ne!(ids, uuids(&b), "fresh each time");
    // Balanced tags: a cheap well-formedness check where plutil is absent.
    for tag in ["dict", "array"] {
        assert_eq!(
            a.matches(&format!("<{tag}>")).count(),
            a.matches(&format!("</{tag}>")).count(),
            "{tag}"
        );
    }
}

#[test]
fn the_mobileconfig_passes_plutil_lint_where_plutil_exists() {
    let Ok(_) = std::process::Command::new("plutil").arg("-help").output() else {
        eprintln!("plutil not found: skipped (macOS only)");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.mobileconfig");
    install::write_mobileconfig(&p, STORE_ID).unwrap();
    let s = std::process::Command::new("plutil")
        .arg("-lint")
        .arg(&p)
        .status()
        .unwrap();
    assert!(s.success());
}

#[test]
fn the_flag_writes_the_profile_only_where_named_and_never_installs_it() {
    let dir = tempfile::tempdir().unwrap();
    let chrome = dir.path().join("chrome");
    let target = dir.path().join("out").join("bh.mobileconfig");
    let o = Options {
        mobileconfig: Some(target.clone()),
        ..opts()
    };
    let (r, out) = run(&chrome, &o, Some(STORE_ID));
    r.unwrap();
    assert!(target.is_file());
    assert!(out.contains("System Settings"), "{out}");
    assert!(out.contains("administrator"), "{out}");
    assert!(!out.contains("sudo"), "{out}");
}

#[test]
fn the_flag_with_no_store_id_is_an_error_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("bh.mobileconfig");
    let o = Options {
        mobileconfig: Some(target.clone()),
        ..opts()
    };
    let (r, _) = run(&dir.path().join("chrome"), &o, None);
    assert!(r.is_err());
    assert!(!target.exists());
}

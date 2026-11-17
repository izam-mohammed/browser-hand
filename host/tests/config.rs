use browser_hand::config::{self, Settings, MAX_PATTERNS, NOT_A_PATTERN};
use serde_json::json;

/// The Contract's file (plans/06-settings.md), comments and all.
const CONTRACT: &str = r#"# Written by the browser-hand settings page. Edits here apply too.
version = 1
[input]
pace = "human"          # or "fast"
typing_speed = 1.0      # 0.25 to 3.0, multiplies the gap between keys
mouse_speed = 1.0       # 0.25 to 3.0, multiplies the cursor's travel time
[sessions]
default_profile = ""    # a Chrome profile dir; "" asks
new_window = true
close_tabs_on_end = false
[sites]
blocked = []            # each list: 200 patterns, 100 characters each
read_only = []
[capture]
screenshot_size = "1280x800"   # or "1024x640", "1568x980"
screenshot_quality = 80        # 30 to 100
gif_folder = "~/Downloads/browser-hand"
gif_frame_delay_ms = 700       # 100 to 5000
[debugger]
detach_after_idle_s = 30       # 5 to 600
"#;

#[test]
fn the_contracts_file_is_the_defaults_and_an_empty_one_is_too() {
    let (s, warnings) = config::parse(CONTRACT).unwrap();
    assert_eq!(s, Settings::default());
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(config::parse("").unwrap(), (Settings::default(), vec![]));
}

#[test]
fn the_defaults_are_the_constants_from_before() {
    let d = Settings::default();
    assert_eq!(
        (
            d.input.pace.as_str(),
            d.input.typing_speed,
            d.input.mouse_speed
        ),
        ("human", 1.0, 1.0)
    );
    assert!(
        d.sessions.new_window
            && !d.sessions.close_tabs_on_end
            && d.sessions.default_profile.is_empty()
    );
    assert_eq!(d.capture.screenshot_size, "1280x800");
    assert_eq!(
        (
            d.capture.screenshot_quality,
            d.capture.gif_frame_delay_ms,
            d.debugger.detach_after_idle_s
        ),
        (80, 700, 30)
    );
    assert_eq!(d.capture.gif_folder, "~/Downloads/browser-hand");
}

#[test]
fn a_saved_file_reads_back_the_same() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("deep/er/config.toml");
    let mut s = Settings::default();
    s.input.pace = "fast".into();
    s.input.typing_speed = 0.5;
    s.sessions.default_profile = "Profile 3".into();
    s.sites.blocked = vec!["*.bank.com/*".into(), "hr.example.com/*".into()];
    s.sites.read_only = vec!["mail.google.com/*".into()];
    s.capture.screenshot_size = "1568x980".into();
    config::save(&path, &s).unwrap();
    let loaded = config::load(&path).unwrap();
    assert_eq!(loaded.settings, s);
    assert!(loaded.warnings.is_empty());
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .starts_with("# Written by the browser-hand settings page."));
}

#[cfg(unix)]
#[test]
fn the_file_is_written_mode_0600_and_leaves_no_temporary_file() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    std::fs::write(&path, "version = 1\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    config::save(&path, &Settings::default()).unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names, ["config.toml"]);
}

#[test]
fn a_revision_is_zero_with_no_file_and_changes_with_each_save() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    assert_eq!(config::revision(&path), "0");
    let a = config::save(&path, &Settings::default()).unwrap();
    assert_eq!(a, config::revision(&path));
    std::thread::sleep(std::time::Duration::from_millis(5));
    let b = config::save(&path, &Settings::default()).unwrap();
    assert_ne!(a, b);
}

#[test]
fn an_unknown_key_is_dropped_and_a_missing_one_is_its_default() {
    let (s, warnings) =
        config::parse("[input]\npace = \"fast\"\ncolour = \"blue\"\n[extra]\nx = 1\n").unwrap();
    assert_eq!(s.input.pace, "fast");
    assert_eq!(s.capture, Settings::default().capture);
    assert!(warnings.is_empty(), "{warnings:?}");
    assert!(!config::to_text(&s).contains("colour"));
}

#[test]
fn a_bad_hand_edit_falls_back_per_key_with_a_warning() {
    let text = "[input]\ntyping_speed = \"fast\"\nmouse_speed = 9.0\npace = \"slow\"\n[capture]\nscreenshot_quality = 90\n";
    let (s, warnings) = config::parse(text).unwrap();
    assert_eq!(s.input, Settings::default().input);
    assert_eq!(s.capture.screenshot_quality, 90, "good keys stay");
    let keys: Vec<&str> = warnings
        .iter()
        .map(|w| w.split(':').next().unwrap())
        .collect();
    assert_eq!(
        keys,
        ["input.typing_speed", "input.pace", "input.mouse_speed"]
    );
}

#[test]
fn a_file_that_is_not_toml_is_an_error_with_its_line() {
    let e = config::parse("[sites\nblocked = [").unwrap_err();
    assert!(e.contains("line 1"), "{e}");
}

#[test]
fn bad_patterns_in_the_file_are_dropped_and_good_ones_kept() {
    let (s, warnings) = config::parse(
        "[sites]\nblocked = [\"*.bank.com/*\", \"https//docs.google\", \"hr.example.com/*\"]\n",
    )
    .unwrap();
    assert_eq!(s.sites.blocked, ["*.bank.com/*", "hr.example.com/*"]);
    assert!(warnings[0].starts_with("sites.blocked:"), "{warnings:?}");
}

#[test]
fn the_pattern_grammar() {
    for good in [
        "*.bank.com/*",
        "hr.example.com/*",
        "mail.google.com/*",
        "example.com/",
        "localhost/app/*",
        "*/*",
        "127.0.0.1/*",
        "a-b.example.co.uk/x/*/y",
        "Docs.Google.com/*",
    ] {
        assert!(config::is_pattern(good), "{good} should be a pattern");
    }
    for bad in [
        "https//docs.google",
        "https://docs.google.com/*",
        "docs.google.com",
        "example.com:8080/*",
        "example.com/?q=1",
        "example.com/#top",
        "/path",
        "exa mple.com/*",
        " example.com/*",
        "example..com/*",
        ".example.com/*",
        "",
        "intranet/*",
    ] {
        assert!(!config::is_pattern(bad), "{bad:?} should not be a pattern");
    }
}

#[test]
fn ranges_and_caps_are_enforced_when_saving_from_the_page() {
    let ok = serde_json::to_value(Settings::default()).unwrap();
    assert!(config::from_page(&ok).is_ok());
    let cases = [
        ("input", "typing_speed", json!(0.2), "input.typing_speed"),
        ("input", "mouse_speed", json!(3.5), "input.mouse_speed"),
        ("input", "pace", json!("slow"), "input.pace"),
        (
            "capture",
            "screenshot_quality",
            json!(29),
            "capture.screenshot_quality",
        ),
        (
            "capture",
            "screenshot_size",
            json!("800x600"),
            "capture.screenshot_size",
        ),
        (
            "capture",
            "gif_frame_delay_ms",
            json!(5001),
            "capture.gif_frame_delay_ms",
        ),
        (
            "debugger",
            "detach_after_idle_s",
            json!(4),
            "debugger.detach_after_idle_s",
        ),
        (
            "sessions",
            "default_profile",
            json!("../Default"),
            "sessions.default_profile",
        ),
        (
            "sites",
            "read_only",
            json!(["https//docs.google"]),
            "sites.read_only",
        ),
        (
            "sites",
            "blocked",
            json!(vec!["a.com/*"; MAX_PATTERNS + 1]),
            "sites.blocked",
        ),
        (
            "sites",
            "blocked",
            json!([format!("a.com/{}", "x".repeat(100))]),
            "sites.blocked",
        ),
    ];
    for (section, key, value, field) in cases {
        let mut v = ok.clone();
        v[section][key] = value.clone();
        let (got, message) = config::from_page(&v).unwrap_err();
        assert_eq!(got, Some(field), "{section}.{key} = {value}: {message}");
    }
    let (_, message) =
        config::from_page(&json!({ "sites": { "read_only": ["https//docs.google"] } }))
            .unwrap_err();
    assert!(message.contains(NOT_A_PATTERN), "{message}");
    let (field, _) =
        config::from_page(&json!({ "input": { "typing_speed": "fast" } })).unwrap_err();
    assert_eq!(field, None, "a wrong type names no key");
}

#[test]
fn the_gif_folder_is_absolute_after_tilde_and_never_climbs() {
    let with = |folder: &str| {
        let mut s = Settings::default();
        s.capture.gif_folder = folder.into();
        config::from_page(&serde_json::to_value(s).unwrap())
    };
    for good in ["~/Downloads/browser-hand", "~", "/tmp/gifs", "~/My GIFs"] {
        assert!(with(good).is_ok(), "{good}");
    }
    for bad in [
        "",
        "Downloads",
        "./gifs",
        "~/../../etc",
        "/tmp/../etc",
        "~user/x",
    ] {
        assert_eq!(
            with(bad).unwrap_err().0,
            Some("capture.gif_folder"),
            "{bad:?}"
        );
    }
    let home = std::path::PathBuf::from(std::env::var_os("HOME").unwrap());
    assert_eq!(
        config::expand("~/Downloads/browser-hand"),
        home.join("Downloads/browser-hand")
    );
    assert_eq!(config::expand("~"), home);
    assert_eq!(
        config::expand("/tmp/gifs"),
        std::path::PathBuf::from("/tmp/gifs")
    );
}

#[test]
fn the_config_path_honours_xdg_config_home() {
    // The only test in this binary that touches the environment.
    std::env::set_var("XDG_CONFIG_HOME", "/somewhere/conf");
    assert_eq!(
        browser_hand::paths::config_path(),
        std::path::PathBuf::from("/somewhere/conf/browser-hand/config.toml")
    );
    std::env::set_var("XDG_CONFIG_HOME", "relative");
    assert!(browser_hand::paths::config_path().ends_with(".config/browser-hand/config.toml"));
    std::env::remove_var("XDG_CONFIG_HOME");
    assert!(browser_hand::paths::config_path().ends_with(".config/browser-hand/config.toml"));
}

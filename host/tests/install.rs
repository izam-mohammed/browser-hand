use browser_hand::install::{self, HOST_NAME};
use browser_hand::mcp::EXTENSION_ID;
use serde_json::Value;

#[test]
fn the_manifest_names_this_host_the_binary_and_only_our_extension() {
    let dir = tempfile::tempdir().unwrap();
    let exe = std::path::Path::new("/opt/browser-hand/bin/browser-hand");
    let path = install::write_manifest(dir.path(), exe).unwrap();
    assert_eq!(path, dir.path().join("NativeMessagingHosts").join(format!("{HOST_NAME}.json")));

    let m: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(m["name"], HOST_NAME);
    assert_eq!(m["type"], "stdio");
    assert_eq!(m["path"], "/opt/browser-hand/bin/browser-hand");
    assert_eq!(m["allowed_origins"], serde_json::json!([format!("chrome-extension://{EXTENSION_ID}/")]));
}

#[test]
fn the_host_name_is_one_chrome_accepts_and_not_anthropics() {
    // Lowercase alphanumerics, underscores and dots; no leading, trailing or
    // doubled dots (docs/external/chrome-native-messaging.md § Host manifest).
    assert!(HOST_NAME.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.'));
    assert!(!HOST_NAME.starts_with('.') && !HOST_NAME.ends_with('.') && !HOST_NAME.contains(".."));
    assert!(!HOST_NAME.contains("anthropic"));
}

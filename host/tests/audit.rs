//! The audit log's line and file (`plans/17-hands-free-and-guarded.md`,
//! Phase 2). What it must never hold is the point of most of these.

use browser_hand::audit::{append, host_of, line, path};
use browser_hand::config::AuditSettings;
use serde_json::{json, Value};

fn parsed(s: &str) -> Value {
    serde_json::from_str(s).unwrap()
}

#[test]
fn a_line_has_the_tool_action_tab_result_and_time_and_nothing_else() {
    let args =
        json!({ "action": "left_click", "tabId": 7, "coordinate": [10, 20], "text": "hunter2" });
    let v = parsed(&line(1_700_000_000_123, "computer", &args, Ok(()), 412));
    assert_eq!(
        v,
        json!({ "t": 1_700_000_000_123u64, "tool": "computer", "action": "left_click",
                "tab": 7, "ok": true, "ms": 412 })
    );
    let bad = parsed(&line(
        5,
        "computer",
        &args,
        Err("blocked: bank.com is blocked"),
        3,
    ));
    assert_eq!(bad["ok"], false);
    assert_eq!(bad["err"], "blocked");
    assert!(!bad.to_string().contains("bank.com"), "{bad}");
}

#[test]
fn typed_text_values_queries_and_page_text_never_reach_a_line() {
    let secret = "s3cr3t-token";
    let cases = [
        (
            "computer",
            json!({ "action": "type", "text": secret, "tabId": 1 }),
        ),
        (
            "form_input",
            json!({ "ref": "r", "value": secret, "tabId": 1 }),
        ),
        (
            "javascript_tool",
            json!({ "text": format!("fetch('/x?{secret}')"), "tabId": 1 }),
        ),
        ("find", json!({ "query": secret, "tabId": 1 })),
        ("wait_for", json!({ "text": secret, "tabId": 1 })),
        (
            "file_upload",
            json!({ "paths": [format!("/home/me/{secret}.pdf")], "ref": "r", "tabId": 1 }),
        ),
        (
            "read_network_requests",
            json!({ "urlPattern": secret, "tabId": 1 }),
        ),
    ];
    for (tool, args) in cases {
        let l = line(1, tool, &args, Err(&format!("page_error: saw {secret}")), 1);
        assert!(!l.contains(secret), "{tool}: {l}");
    }
}

#[test]
fn a_navigate_line_has_the_host_only() {
    let url = "https://user:pw@Example.COM:8443/path/to?token=abc123#frag";
    let l = line(1, "navigate", &json!({ "url": url, "tabId": 2 }), Ok(()), 9);
    let v = parsed(&l);
    assert_eq!(v["host"], "example.com");
    for leak in ["abc123", "pw", "path", "8443", "frag", "https"] {
        assert!(!l.contains(leak), "{leak} in {l}");
    }
    assert_eq!(host_of("example.com/x?y=1").as_deref(), Some("example.com"));
    assert_eq!(host_of("https://a b/").as_deref(), None);
    assert_eq!(host_of("http://[::1]:80/").as_deref(), None);
}

#[test]
fn an_odd_tool_or_action_word_is_not_copied() {
    let v = parsed(&line(
        1,
        "Evil\nTool",
        &json!({ "action": "x\"y" }),
        Ok(()),
        1,
    ));
    assert_eq!(v["tool"], "unknown");
    assert!(v.get("action").is_none());
    let v = parsed(&line(1, "find", &json!({}), Err("no colon here"), 1));
    assert_eq!(v["err"], "error");
}

#[test]
fn the_default_file_sits_beside_the_config_and_a_setting_wins() {
    let cfg = std::path::Path::new("/home/x/.config/browser-hand/config.toml");
    let s = AuditSettings::default();
    assert_eq!(
        path(&s, cfg),
        std::path::PathBuf::from("/home/x/.config/browser-hand/audit.jsonl")
    );
    let s = AuditSettings {
        enabled: true,
        file: "/var/log/bh.jsonl".into(),
    };
    assert_eq!(path(&s, cfg), std::path::PathBuf::from("/var/log/bh.jsonl"));
}

#[cfg(unix)]
#[test]
fn the_file_is_0600_and_its_new_folder_0700_and_lines_append() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("logs").join("audit.jsonl");
    append(&file, "{\"a\":1}").unwrap();
    append(&file, "{\"a\":2}").unwrap();
    let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&file), 0o600);
    assert_eq!(mode(file.parent().unwrap()), 0o700);
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        "{\"a\":1}\n{\"a\":2}\n"
    );
}

#[test]
fn an_unwritable_place_is_an_error_the_caller_can_swallow() {
    let dir = tempfile::tempdir().unwrap();
    // A file where the folder should be.
    let blocker = dir.path().join("blocker");
    std::fs::write(&blocker, "x").unwrap();
    assert!(append(&blocker.join("audit.jsonl"), "{}").is_err());
}

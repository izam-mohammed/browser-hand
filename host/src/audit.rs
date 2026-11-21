//! The audit log (`plans/17-hands-free-and-guarded.md`, Decision 3): one JSON
//! object per line for every call the host sends the extension, appended to a
//! file the person turns on in the settings (`audit.enabled`). A line holds
//! the tool, its action word, the tab, the host of a `navigate`, whether it
//! worked, an error code and how long it took. It never holds a path, a
//! query, typed text, a value or anything read from a page.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::config::AuditSettings;

/// The file the log goes to: the setting, or `audit.jsonl` beside `config.toml`.
pub fn path(settings: &AuditSettings, config_path: &Path) -> PathBuf {
    if settings.file.is_empty() {
        config_path
            .parent()
            .unwrap_or(Path::new("."))
            .join("audit.jsonl")
    } else {
        crate::config::expand(&settings.file)
    }
}

/// A word from a closed list (an action name, an error code): lower-case
/// letters and `_`, at most 24, else nothing.
fn word(s: &str) -> Option<&str> {
    let ok =
        !s.is_empty() && s.len() <= 24 && s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
    ok.then_some(s)
}

/// The host of a URL and nothing else: no scheme, userinfo, port, path,
/// query or fragment. `None` when it does not look like a host name.
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?;
    let host = host.rsplit_once(':').map_or(host, |(h, port)| {
        if port.bytes().all(|b| b.is_ascii_digit()) {
            h
        } else {
            host
        }
    });
    let host = host.to_ascii_lowercase();
    let ok = !host.is_empty()
        && host.len() <= 253
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    ok.then_some(host)
}

/// The error code at the front of a tool's error text (`blocked: ...`), or
/// `error` when the text does not start with one.
fn code_of(err: &str) -> &str {
    err.split_once(':')
        .and_then(|(c, _)| word(c))
        .unwrap_or("error")
}

/// One audit line (without the newline) for a call of `tool` with `args`.
pub fn line(
    now_ms: u128,
    tool: &str,
    args: &Value,
    outcome: Result<(), &str>,
    took_ms: u128,
) -> String {
    let mut o = json!({ "t": now_ms as u64, "tool": word(tool).unwrap_or("unknown") });
    if let Some(a) = args["action"].as_str().and_then(word) {
        o["action"] = json!(a);
    }
    if let Some(tab) = args["tabId"].as_i64() {
        o["tab"] = json!(tab);
    }
    if tool == "navigate" {
        if let Some(h) = args["url"].as_str().and_then(host_of) {
            o["host"] = json!(h);
        }
    }
    o["ok"] = json!(outcome.is_ok());
    if let Err(e) = outcome {
        o["err"] = json!(code_of(e));
    }
    o["ms"] = json!(took_ms as u64);
    o.to_string()
}

/// Appends `line` and a newline to `path` in one write, creating the file
/// `0600` and its folder `0700`.
pub fn append(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        if !dir.exists() {
            std::fs::create_dir_all(dir)?;
            #[cfg(unix)]
            std::fs::set_permissions(dir, std::os::unix::fs::PermissionsExt::from_mode(0o700))?;
        }
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
    let mut f = opts.open(path)?;
    f.write_all(format!("{line}\n").as_bytes())
}

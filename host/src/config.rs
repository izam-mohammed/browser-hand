//! `config.toml`, the settings every Chrome profile shares
//! (plans/06-settings.md § Contract). The settings page asks the native host
//! to write it; the native host polls it and pushes changes to its
//! extension; the MCP server reads it when it needs a value. A missing file
//! or key is the default, an unknown key is dropped, and a bad hand-edited
//! value falls back to its default with a warning the page shows.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rmcp::schemars::{self, JsonSchema};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub const VERSION: u32 = 1;
/// Patterns per site list, and characters per pattern.
pub const MAX_PATTERNS: usize = 200;
pub const MAX_PATTERN_CHARS: usize = 100;
pub const SCREENSHOT_SIZES: [&str; 3] = ["1024x640", "1280x800", "1568x980"];
/// How often each native host looks at the file (Decision 4).
pub const POLL: Duration = Duration::from_secs(2);
/// The page's words for a pattern it cannot read (`design/settings--editing.png`).
pub const NOT_A_PATTERN: &str = "Not a pattern. Use host/path, for example docs.google.com/*";
const HEADER: &str = "# Written by the browser-hand settings page. Edits here apply too.\n";

#[derive(Serialize, Deserialize, TS, JsonSchema, Debug, Clone, PartialEq)]
#[serde(default)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct Settings {
    /// The file's format version.
    pub version: u32,
    pub input: InputSettings,
    pub sessions: SessionSettings,
    pub sites: SiteSettings,
    pub capture: CaptureSettings,
    pub debugger: DebuggerSettings,
}

#[derive(Serialize, Deserialize, TS, JsonSchema, Debug, Clone, PartialEq)]
#[serde(default)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct InputSettings {
    /// `human` or `fast`. Fast keeps the same events without travel time.
    pub pace: String,
    /// 0.25 to 3.0, multiplies the gap between keys.
    pub typing_speed: f64,
    /// 0.25 to 3.0, multiplies the cursor's travel time.
    pub mouse_speed: f64,
}

#[derive(Serialize, Deserialize, TS, JsonSchema, Debug, Clone, PartialEq, Default)]
#[serde(default)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct SessionSettings {
    /// A Chrome profile dir; empty asks.
    pub default_profile: String,
    /// Whether a session opens its tab group in a new window.
    pub new_window: bool,
    /// Whether Claude's tabs close when the session ends.
    pub close_tabs_on_end: bool,
}

#[derive(Serialize, Deserialize, TS, JsonSchema, Debug, Clone, PartialEq, Default)]
#[serde(default)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct SiteSettings {
    /// Sites Claude never opens or acts on, as `host/path` patterns.
    pub blocked: Vec<String>,
    /// Sites Claude may read and screenshot but not click, type in or script.
    pub read_only: Vec<String>,
}

#[derive(Serialize, Deserialize, TS, JsonSchema, Debug, Clone, PartialEq)]
#[serde(default)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct CaptureSettings {
    /// `1024x640`, `1280x800` or `1568x980`.
    pub screenshot_size: String,
    /// JPEG quality, 30 to 100.
    pub screenshot_quality: u32,
    /// `~/...` or an absolute path.
    pub gif_folder: String,
    /// 100 to 5000.
    pub gif_frame_delay_ms: u32,
}

#[derive(Serialize, Deserialize, TS, JsonSchema, Debug, Clone, PartialEq)]
#[serde(default)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct DebuggerSettings {
    /// 5 to 600.
    pub detach_after_idle_s: u32,
}

// The defaults are the constants the code used before this file existed.

impl Default for Settings {
    fn default() -> Self {
        Settings {
            version: VERSION,
            input: Default::default(),
            sessions: Default::default(),
            sites: Default::default(),
            capture: Default::default(),
            debugger: Default::default(),
        }
    }
}

impl Default for InputSettings {
    fn default() -> Self {
        InputSettings {
            pace: "human".into(),
            typing_speed: 1.0,
            mouse_speed: 1.0,
        }
    }
}

impl Default for CaptureSettings {
    fn default() -> Self {
        CaptureSettings {
            screenshot_size: "1280x800".into(),
            screenshot_quality: 80,
            gif_folder: "~/Downloads/browser-hand".into(),
            gif_frame_delay_ms: 700,
        }
    }
}

impl Default for DebuggerSettings {
    fn default() -> Self {
        DebuggerSettings {
            detach_after_idle_s: 30,
        }
    }
}

/// A value the settings refuse: the key (`input.pace`) and why.
#[derive(Debug, Clone, PartialEq)]
pub struct Problem {
    pub field: &'static str,
    pub message: String,
}

fn problem(field: &'static str, message: impl Into<String>) -> Problem {
    Problem {
        field,
        message: message.into(),
    }
}

/// Whether `p` follows the pattern grammar: `host/path`, `*` for any run of
/// characters, no scheme, port, query or fragment; the host has a dot, or
/// is `localhost` or `*`. `extension/src/sites.ts` holds the same rules.
pub fn is_pattern(p: &str) -> bool {
    if p.is_empty() || p.trim() != p {
        return false;
    }
    if p.chars()
        .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '?' | '#' | '\\'))
    {
        return false;
    }
    let Some((host, _path)) = p.split_once('/') else {
        return false;
    };
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '*'))
    {
        return false;
    }
    if host == "*" || host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.contains('.') && host.split('.').all(|label| !label.is_empty())
}

/// Why a site list is refused, if it is.
fn list_problem(field: &'static str, list: &[String]) -> Option<Problem> {
    if list.len() > MAX_PATTERNS {
        return Some(problem(field, format!("at most {MAX_PATTERNS} patterns")));
    }
    for p in list {
        if p.chars().count() > MAX_PATTERN_CHARS {
            return Some(problem(
                field,
                format!(
                    "\"{}...\" is over {MAX_PATTERN_CHARS} characters",
                    p.chars().take(20).collect::<String>()
                ),
            ));
        }
        if !is_pattern(p) {
            return Some(problem(field, format!("\"{p}\": {NOT_A_PATTERN}")));
        }
    }
    None
}

/// Why a GIF folder is refused, if it is: it must be absolute once `~` is
/// expanded, and may not climb out with `..`.
fn folder_problem(folder: &str) -> Option<String> {
    folder_problem_in(folder, cfg!(windows))
}

/// `folder_problem` for a system: on Windows `~\`, `C:\` and `C:/` start a
/// folder too, and `\` separates parts.
pub fn folder_problem_in(folder: &str, windows: bool) -> Option<String> {
    let b = folder.as_bytes();
    let drive = windows && b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':';
    let drive = drive && (b[2] == b'/' || b[2] == b'\\');
    let rooted = folder == "~"
        || folder.starts_with("~/")
        || folder.starts_with('/')
        || (windows && (folder.starts_with("~\\") || folder.starts_with("\\\\")))
        || drive;
    if folder.is_empty() {
        return Some("needs a folder".into());
    }
    if folder.chars().count() > 1024 || folder.chars().any(char::is_control) {
        return Some("is not a usable path".into());
    }
    if !rooted {
        return Some(if windows {
            "must start with ~/, / or a drive like C:\\".into()
        } else {
            "must start with ~/ or /".into()
        });
    }
    if folder
        .split(|c| c == '/' || (windows && c == '\\'))
        .any(|part| part == "..")
    {
        return Some("may not contain ..".into());
    }
    None
}

/// Every value the settings refuse, in file order.
pub fn problems(s: &Settings) -> Vec<Problem> {
    let mut out = vec![];
    if s.version != VERSION {
        out.push(problem("version", format!("must be {VERSION}")));
    }
    if !matches!(s.input.pace.as_str(), "human" | "fast") {
        out.push(problem("input.pace", "must be \"human\" or \"fast\""));
    }
    if !(0.25..=3.0).contains(&s.input.typing_speed) {
        out.push(problem("input.typing_speed", "must be 0.25 to 3.0"));
    }
    if !(0.25..=3.0).contains(&s.input.mouse_speed) {
        out.push(problem("input.mouse_speed", "must be 0.25 to 3.0"));
    }
    let profile = &s.sessions.default_profile;
    if profile.chars().count() > 255 || profile.chars().any(|c| c.is_control() || c == '/') {
        out.push(problem(
            "sessions.default_profile",
            "is not a Chrome profile dir",
        ));
    }
    out.extend(list_problem("sites.blocked", &s.sites.blocked));
    out.extend(list_problem("sites.read_only", &s.sites.read_only));
    if !SCREENSHOT_SIZES.contains(&s.capture.screenshot_size.as_str()) {
        out.push(problem(
            "capture.screenshot_size",
            format!("must be one of {}", SCREENSHOT_SIZES.join(", ")),
        ));
    }
    if !(30..=100).contains(&s.capture.screenshot_quality) {
        out.push(problem("capture.screenshot_quality", "must be 30 to 100"));
    }
    if let Some(why) = folder_problem(&s.capture.gif_folder) {
        out.push(problem("capture.gif_folder", why));
    }
    if !(100..=5000).contains(&s.capture.gif_frame_delay_ms) {
        out.push(problem("capture.gif_frame_delay_ms", "must be 100 to 5000"));
    }
    if !(5..=600).contains(&s.debugger.detach_after_idle_s) {
        out.push(problem("debugger.detach_after_idle_s", "must be 5 to 600"));
    }
    out
}

/// Puts one refused key back to its default. A site list keeps its good
/// patterns, up to the cap.
fn reset(s: &mut Settings, field: &str) {
    let d = Settings::default();
    let keep = |list: &mut Vec<String>| {
        list.retain(|p| p.chars().count() <= MAX_PATTERN_CHARS && is_pattern(p));
        list.truncate(MAX_PATTERNS);
    };
    match field {
        "version" => s.version = d.version,
        "input.pace" => s.input.pace = d.input.pace,
        "input.typing_speed" => s.input.typing_speed = d.input.typing_speed,
        "input.mouse_speed" => s.input.mouse_speed = d.input.mouse_speed,
        "sessions.default_profile" => s.sessions.default_profile = d.sessions.default_profile,
        "sites.blocked" => keep(&mut s.sites.blocked),
        "sites.read_only" => keep(&mut s.sites.read_only),
        "capture.screenshot_size" => s.capture.screenshot_size = d.capture.screenshot_size,
        "capture.screenshot_quality" => s.capture.screenshot_quality = d.capture.screenshot_quality,
        "capture.gif_folder" => s.capture.gif_folder = d.capture.gif_folder,
        "capture.gif_frame_delay_ms" => s.capture.gif_frame_delay_ms = d.capture.gif_frame_delay_ms,
        "debugger.detach_after_idle_s" => {
            s.debugger.detach_after_idle_s = d.debugger.detach_after_idle_s
        }
        _ => {}
    }
}

/// Reads `[section] key` into `into` when it is there and of the right
/// type; a wrong type leaves the default and says so.
fn take<T: DeserializeOwned>(
    table: &toml::Table,
    section: &str,
    key: &str,
    into: &mut T,
    warnings: &mut Vec<String>,
) {
    let value = if section.is_empty() {
        table.get(key)
    } else {
        table
            .get(section)
            .and_then(|s| s.as_table())
            .and_then(|s| s.get(key))
    };
    let Some(value) = value else { return };
    let name = if section.is_empty() {
        key.to_owned()
    } else {
        format!("{section}.{key}")
    };
    match value.clone().try_into::<T>() {
        Ok(v) => *into = v,
        Err(e) => warnings.push(format!("{name}: {}; using the default", e.message())),
    }
}

/// Settings from the file's text, never failing: a key that is missing,
/// of the wrong type or out of range is its default, with a warning for
/// the last two. `Err` only when the file is not TOML at all.
pub fn parse(text: &str) -> Result<(Settings, Vec<String>), String> {
    let table: toml::Table = toml::from_str(text).map_err(|e| e.to_string())?;
    let mut s = Settings::default();
    let mut w = vec![];
    take(&table, "", "version", &mut s.version, &mut w);
    take(&table, "input", "pace", &mut s.input.pace, &mut w);
    take(
        &table,
        "input",
        "typing_speed",
        &mut s.input.typing_speed,
        &mut w,
    );
    take(
        &table,
        "input",
        "mouse_speed",
        &mut s.input.mouse_speed,
        &mut w,
    );
    take(
        &table,
        "sessions",
        "default_profile",
        &mut s.sessions.default_profile,
        &mut w,
    );
    take(
        &table,
        "sessions",
        "new_window",
        &mut s.sessions.new_window,
        &mut w,
    );
    take(
        &table,
        "sessions",
        "close_tabs_on_end",
        &mut s.sessions.close_tabs_on_end,
        &mut w,
    );
    take(&table, "sites", "blocked", &mut s.sites.blocked, &mut w);
    take(&table, "sites", "read_only", &mut s.sites.read_only, &mut w);
    take(
        &table,
        "capture",
        "screenshot_size",
        &mut s.capture.screenshot_size,
        &mut w,
    );
    take(
        &table,
        "capture",
        "screenshot_quality",
        &mut s.capture.screenshot_quality,
        &mut w,
    );
    take(
        &table,
        "capture",
        "gif_folder",
        &mut s.capture.gif_folder,
        &mut w,
    );
    take(
        &table,
        "capture",
        "gif_frame_delay_ms",
        &mut s.capture.gif_frame_delay_ms,
        &mut w,
    );
    take(
        &table,
        "debugger",
        "detach_after_idle_s",
        &mut s.debugger.detach_after_idle_s,
        &mut w,
    );
    for p in problems(&s) {
        w.push(format!("{}: {}; using the default", p.field, p.message));
        reset(&mut s, p.field);
    }
    Ok((s, w))
}

/// What the settings page asked to save, refused at the first bad value.
pub fn from_page(value: &Value) -> Result<Settings, (Option<&'static str>, String)> {
    let s: Settings =
        serde_json::from_value(value.clone()).map_err(|e| (None, format!("not settings: {e}")))?;
    match problems(&s).into_iter().next() {
        Some(p) => Err((Some(p.field), format!("{}: {}", p.field, p.message))),
        None => Ok(s),
    }
}

/// The file as read now.
#[derive(Debug, Clone, PartialEq)]
pub struct Loaded {
    pub settings: Settings,
    pub warnings: Vec<String>,
    pub revision: String,
}

/// The file's modification time in nanoseconds, or "0" when there is no
/// file. A save from another profile changes it.
pub fn revision(path: &Path) -> String {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|| "0".into())
}

/// Reads the file. `Err` with the parse error when it is not TOML; a
/// missing file is the defaults.
pub fn load(path: &Path) -> Result<Loaded, String> {
    let revision = revision(path);
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("could not read {}: {e}", path.display())),
    };
    let (settings, warnings) = parse(&text)?;
    Ok(Loaded {
        settings,
        warnings,
        revision,
    })
}

/// The settings to act on now: the file's, or the defaults when it cannot
/// be read (the MCP server, which has no page to warn).
pub fn current(path: &Path) -> Settings {
    load(path).map(|l| l.settings).unwrap_or_default()
}

/// The file's text for `s`.
pub fn to_text(s: &Settings) -> String {
    format!(
        "{HEADER}{}",
        toml::to_string_pretty(s).expect("settings always serialise")
    )
}

/// Writes `s` atomically (a temporary file renamed over the old one), mode
/// `0600`, creating the folder. Returns the new revision.
pub fn save(path: &Path, s: &Settings) -> std::io::Result<String> {
    use std::io::Write;
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".config.toml.{}.tmp", std::process::id()));
    let result = (|| {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        // Windows files take the folder's ACL, which under the user's
        // profile is the user's own.
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        let mut f = opts.open(&tmp)?;
        f.write_all(to_text(s).as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result?;
    Ok(revision(path))
}

/// `~` and `~/...` under the home (`$HOME`, on Windows also `%USERPROFILE%`);
/// on Windows `~\...` too. Other paths as they are.
pub fn expand(folder: &str) -> PathBuf {
    expand_in(folder, &crate::paths::home_dir(), cfg!(windows))
}

/// `expand` with the home and the system given.
pub fn expand_in(folder: &str, home: &Path, windows: bool) -> PathBuf {
    let sep = |c: char| c == '/' || (windows && c == '\\');
    match folder.strip_prefix('~') {
        Some("") => home.to_path_buf(),
        Some(rest) if rest.starts_with(sep) => home.join(&rest[1..]),
        _ => PathBuf::from(folder),
    }
}

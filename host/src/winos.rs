//! The Windows rules that need no Windows: registry keys and `reg.exe`
//! command lines, pipe names, install folders, path clean-up
//! (`plans/16-windows.md`, `docs/external/windows.md`). Compiled on every
//! system so Linux tests hold them; the calls that need Windows are in
//! `winsys`.

use std::path::{Path, PathBuf};

use crate::install::HOST_NAME;
use crate::profiles::Browser;

/// `HKCU\Software\<vendor>\NativeMessagingHosts\<host>`, whose default value
/// is the manifest's path (Chrome's native messaging docs).
pub fn host_key(b: &Browser) -> String {
    format!(
        r"HKCU\Software\{}\NativeMessagingHosts\{HOST_NAME}",
        b.win_reg
    )
}

/// Arguments for `reg add`: sets the key's default value. One argument per
/// item, so a path with spaces or `&` is never split or interpreted.
pub fn reg_add_args(key: &str, manifest: &str) -> Vec<String> {
    ["add", key, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"]
        .map(String::from)
        .to_vec()
}

pub fn reg_delete_args(key: &str) -> Vec<String> {
    ["delete", key, "/f"].map(String::from).to_vec()
}

pub fn reg_query_args(key: &str) -> Vec<String> {
    ["query", key].map(String::from).to_vec()
}

/// `reg.exe` by its full path under `%SystemRoot%`, never a `PATH` lookup.
pub fn reg_exe(system_root: Option<PathBuf>) -> PathBuf {
    system_root
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("reg.exe")
}

/// `\\?\C:\x` as `C:\x` and `\\?\UNC\srv\share` as `\\srv\share`: what
/// `canonicalize` returns on Windows is a verbatim path Chrome cannot start.
pub fn strip_verbatim(p: &Path) -> PathBuf {
    let Some(s) = p.to_str() else {
        return p.to_path_buf();
    };
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}

/// Where host pipes live.
pub const PIPE_ROOT: &str = r"\\.\pipe\";

const PIPE_PREFIX: &str = "browser-hand-";

/// The part of a pipe name that keeps one set of hosts apart from another:
/// `bh` for the real pipe root, else a plain, stable form of the directory
/// a test gave (`BROWSER_HAND_SOCKET_DIR`).
pub fn pipe_scope(dir: &Path) -> String {
    let s = dir.to_string_lossy();
    if s.trim_end_matches(['\\', '/']) == PIPE_ROOT.trim_end_matches('\\') {
        return "bh".into();
    }
    // FNV-1a over the whole text, so two long paths with one tail differ.
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h = (h ^ u32::from(b)).wrapping_mul(0x0100_0193);
    }
    let plain: String = s
        .chars()
        .rev()
        .filter(char::is_ascii_alphanumeric)
        .take(24)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("t{plain}_{h:08x}")
}

/// The pipe a host with this pid listens on.
pub fn pipe_name(scope: &str, pid: u32) -> String {
    format!(r"{PIPE_ROOT}{PIPE_PREFIX}{scope}-{pid}")
}

/// Whether a name from a listing of the pipe root is a host pipe of `scope`
/// (`<prefix><scope>-<digits>`).
pub fn is_host_pipe(name: &str, scope: &str) -> bool {
    name.strip_prefix(PIPE_PREFIX)
        .and_then(|r| r.strip_prefix(scope))
        .and_then(|r| r.strip_prefix('-'))
        .is_some_and(|pid| !pid.is_empty() && pid.bytes().all(|b| b.is_ascii_digit()))
}

/// The security descriptor for a host pipe: this user's SID only, no
/// inheritance. The default one lets Everyone read
/// (`docs/external/windows.md`).
pub fn pipe_sddl(sid: &str) -> anyhow::Result<String> {
    let ok = sid.starts_with("S-1-")
        && sid.len() > 4
        && sid
            .bytes()
            .all(|b| b.is_ascii_digit() || b == b'-' || b == b'S');
    anyhow::ensure!(ok, "not a SID: {sid:?}");
    Ok(format!("D:P(A;;GA;;;{sid})"))
}

/// The install roots read from the environment.
#[derive(Debug, Clone, Default)]
pub struct WinEnv {
    pub program_files: Option<PathBuf>,
    pub program_files_x86: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
}

impl WinEnv {
    pub fn from_env() -> WinEnv {
        let var = |k| std::env::var_os(k).map(PathBuf::from);
        WinEnv {
            program_files: var("ProgramFiles"),
            program_files_x86: var("ProgramFiles(x86)"),
            local_app_data: var("LOCALAPPDATA"),
        }
    }
}

/// Where a browser's exe may be, in the order tried. `PATH` is not searched.
pub fn exe_candidates(env: &WinEnv, b: &Browser) -> Vec<PathBuf> {
    [
        &env.program_files,
        &env.program_files_x86,
        &env.local_app_data,
    ]
    .into_iter()
    .flatten()
    .map(|base| b.win_exe.split('\\').fold(base.clone(), |p, c| p.join(c)))
    .collect()
}

/// 100 ns ticks since 1601-01-01 for `ms` since the Unix epoch.
pub fn ms_to_filetime(ms: i64) -> u64 {
    (ms * 10_000 + 116_444_736_000_000_000) as u64
}

/// "YYYY-MM-DD HH:MM".
pub fn local_text(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> String {
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}")
}

/// Whether a Windows path names an NTFS alternate data stream
/// (`secret.pem:x`): a `:` after the drive prefix.
pub fn has_stream(path: &str) -> bool {
    let rest = path.strip_prefix(r"\\?\").unwrap_or(path);
    let b = rest.as_bytes();
    let after_drive = if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        &rest[2..]
    } else {
        rest
    };
    after_drive.contains(':')
}

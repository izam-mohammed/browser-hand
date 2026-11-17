//! Where the host sockets and the settings file live. Chrome and Claude Code may start their
//! children with different environments, so on macOS the per-user temp dir
//! is asked of the OS (`confstr`), not read from `$TMPDIR`. On Windows the
//! host endpoints are named pipes (`ipc`), not files.

use std::path::{Path, PathBuf};

/// The person's home: `$HOME`, and on Windows `%USERPROFILE%` when `HOME` is
/// unset. Empty when neither is.
pub fn home_dir() -> PathBuf {
    let var = |k| std::env::var_os(k).filter(|v| !v.is_empty());
    let home = var("HOME");
    #[cfg(windows)]
    let home = home.or_else(|| var("USERPROFILE"));
    PathBuf::from(home.unwrap_or_default())
}

/// Directory holding one `<pid>.sock` per running native host; on Windows
/// the pipe root, which `ipc` lists. `BROWSER_HAND_SOCKET_DIR` overrides it
/// (tests).
pub fn socket_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("BROWSER_HAND_SOCKET_DIR") {
        return PathBuf::from(dir);
    }
    default_socket_dir()
}

#[cfg(windows)]
fn default_socket_dir() -> PathBuf {
    PathBuf::from(crate::winos::PIPE_ROOT)
}

#[cfg(not(windows))]
fn default_socket_dir() -> PathBuf {
    user_temp_dir().join("bh")
}

#[cfg(target_os = "macos")]
fn user_temp_dir() -> PathBuf {
    use std::ffi::CStr;
    let mut buf = vec![0u8; 1024];
    // SAFETY: buf is valid for buf.len() bytes; confstr NUL-terminates.
    let n = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            buf.as_mut_ptr().cast(),
            buf.len(),
        )
    };
    if n > 0 && n <= buf.len() {
        if let Ok(s) = CStr::from_bytes_until_nul(&buf) {
            return PathBuf::from(s.to_string_lossy().into_owned());
        }
    }
    std::env::temp_dir()
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
fn user_temp_dir() -> PathBuf {
    std::env::temp_dir()
}

/// The socket a host with this pid listens on (on Windows its pipe name).
pub fn socket_path(pid: u32) -> PathBuf {
    #[cfg(windows)]
    {
        let name = crate::winos::pipe_name(&crate::winos::pipe_scope(&socket_dir()), pid);
        PathBuf::from(name)
    }
    #[cfg(not(windows))]
    {
        socket_dir().join(format!("{pid}.sock"))
    }
}

/// Creates the socket dir readable only by this user. Pipes need no dir.
pub fn ensure_socket_dir() -> std::io::Result<PathBuf> {
    let dir = socket_dir();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(&dir)?;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(dir)
}

/// `config.toml`, shared by every profile (plans/06-settings.md):
/// `$XDG_CONFIG_HOME/browser-hand/`, else `~/.config/browser-hand/`; on
/// Windows `%LOCALAPPDATA%\browser-hand\`.
pub fn config_path() -> PathBuf {
    config_path_in(
        cfg!(windows),
        std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from),
        &home_dir(),
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
    )
}

/// `config_path` with its inputs given.
pub fn config_path_in(
    windows: bool,
    xdg: Option<PathBuf>,
    home: &Path,
    local_app_data: Option<PathBuf>,
) -> PathBuf {
    let base = if windows {
        local_app_data.unwrap_or_else(|| home.join("AppData").join("Local"))
    } else {
        match xdg {
            Some(d) if d.is_absolute() => d,
            _ => home.join(".config"),
        }
    };
    base.join("browser-hand").join("config.toml")
}

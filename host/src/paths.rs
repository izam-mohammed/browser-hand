//! Where the host sockets live. Chrome and Claude Code may start their
//! children with different environments, so on macOS the per-user temp dir
//! is asked of the OS (`confstr`), not read from `$TMPDIR`.

use std::path::PathBuf;

/// Directory holding one `<pid>.sock` per running native host.
/// `BROWSER_HAND_SOCKET_DIR` overrides it (tests).
pub fn socket_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("BROWSER_HAND_SOCKET_DIR") {
        return PathBuf::from(dir);
    }
    user_temp_dir().join("bh")
}

#[cfg(target_os = "macos")]
fn user_temp_dir() -> PathBuf {
    use std::ffi::CStr;
    let mut buf = vec![0u8; 1024];
    // SAFETY: buf is valid for buf.len() bytes; confstr NUL-terminates.
    let n = unsafe {
        libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, buf.as_mut_ptr().cast(), buf.len())
    };
    if n > 0 && n <= buf.len() {
        if let Ok(s) = CStr::from_bytes_until_nul(&buf) {
            return PathBuf::from(s.to_string_lossy().into_owned());
        }
    }
    std::env::temp_dir()
}

#[cfg(not(target_os = "macos"))]
fn user_temp_dir() -> PathBuf {
    std::env::temp_dir()
}

/// The socket a host with this pid listens on.
pub fn socket_path(pid: u32) -> PathBuf {
    socket_dir().join(format!("{pid}.sock"))
}

/// Creates the socket dir readable only by this user.
pub fn ensure_socket_dir() -> std::io::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let dir = socket_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(dir)
}

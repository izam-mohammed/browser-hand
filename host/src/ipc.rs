//! The local endpoint between a native host and the MCP servers: a Unix
//! socket where there are Unix sockets, a named pipe on Windows
//! (`plans/16-windows.md`, decisions 1 and 2). Everything else in the crate
//! reads and writes through `AsyncRead` and `AsyncWrite`, so the frames do
//! not know which one is under them.

use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};

use tokio::io::{AsyncRead, AsyncWrite};

/// Something that hands out connections, one at a time.
pub trait Accept: Send {
    type Conn: AsyncRead + AsyncWrite + Unpin + Send + 'static;
    fn accept(&mut self) -> impl Future<Output = io::Result<Self::Conn>> + Send;
}

#[cfg(unix)]
pub use unix::{bind, connect, forget_stale, list, Conn, Listener};

#[cfg(windows)]
pub use windows::{bind, connect, forget_stale, list, Conn, Listener};

#[cfg(unix)]
mod unix {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::{UnixListener, UnixStream};

    pub type Listener = UnixListener;
    pub type Conn = UnixStream;

    impl Accept for UnixListener {
        type Conn = UnixStream;
        async fn accept(&mut self) -> io::Result<UnixStream> {
            UnixListener::accept(self).await.map(|(s, _)| s)
        }
    }

    /// Binds `path` (a leftover file is removed first), readable by this
    /// user only.
    pub fn bind(path: &Path) -> io::Result<Listener> {
        let _ = std::fs::remove_file(path);
        let listener = UnixListener::bind(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        Ok(listener)
    }

    pub async fn connect(path: &Path) -> io::Result<Conn> {
        UnixStream::connect(path).await
    }

    /// The endpoints in `dir`: every `*.sock`.
    pub fn list(dir: &Path) -> Vec<PathBuf> {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return vec![];
        };
        entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "sock"))
            .collect()
    }

    /// Removes an endpoint nobody listens on (a killed host's socket).
    pub fn forget_stale(path: &Path, err: &io::Error) {
        if err.kind() == io::ErrorKind::ConnectionRefused {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use std::time::Duration;
    use tokio::net::windows::named_pipe::{
        ClientOptions, NamedPipeClient, NamedPipeServer, PipeMode, ServerOptions,
    };

    use crate::{winos, winsys};

    pub type Conn = NamedPipeClient;

    /// A named pipe that serves one client per instance: it waits on an
    /// instance, and makes the next one as soon as a client is on it.
    pub struct Listener {
        name: PathBuf,
        next: NamedPipeServer,
    }

    fn instance(name: &Path, first: bool) -> io::Result<NamedPipeServer> {
        let mut security = winsys::PipeSecurity::for_current_user()?;
        let mut opts = ServerOptions::new();
        opts.first_pipe_instance(first)
            .reject_remote_clients(true)
            .pipe_mode(PipeMode::Byte);
        // SAFETY: the pointer is to the descriptor `security` owns, which
        // outlives this call.
        unsafe { opts.create_with_security_attributes_raw(name, security.as_ptr()) }
    }

    impl Accept for Listener {
        type Conn = NamedPipeServer;
        async fn accept(&mut self) -> io::Result<NamedPipeServer> {
            self.next.connect().await?;
            let fresh = instance(&self.name, false)?;
            Ok(std::mem::replace(&mut self.next, fresh))
        }
    }

    /// Creates the pipe at `path` (its name), for this user only.
    pub fn bind(path: &Path) -> io::Result<Listener> {
        Ok(Listener {
            name: path.to_path_buf(),
            next: instance(path, true)?,
        })
    }

    const PIPE_BUSY: i32 = 231;

    /// Opens a host's pipe and checks the host runs as this user.
    pub async fn connect(path: &Path) -> io::Result<Conn> {
        for _ in 0..20 {
            match ClientOptions::new().open(path) {
                Ok(client) => {
                    winsys::check_server_is_me(client.as_raw_handle())?;
                    return Ok(client);
                }
                Err(e) if e.raw_os_error() == Some(PIPE_BUSY) => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(e) => return Err(e),
            }
        }
        Err(io::Error::new(io::ErrorKind::TimedOut, "host pipe is busy"))
    }

    /// The host pipes of `dir`'s scope, from the pipe root's listing.
    pub fn list(dir: &Path) -> Vec<PathBuf> {
        let scope = winos::pipe_scope(dir);
        let Ok(entries) = std::fs::read_dir(winos::PIPE_ROOT) else {
            return vec![];
        };
        entries
            .filter_map(Result::ok)
            .filter(|e| winos::is_host_pipe(&e.file_name().to_string_lossy(), &scope))
            .map(|e| PathBuf::from(winos::PIPE_ROOT).join(e.file_name()))
            .collect()
    }

    /// A pipe goes away with its process: nothing is left to remove.
    pub fn forget_stale(_path: &Path, _err: &io::Error) {}
}

//! `browser-hand` as Chrome's native messaging host: relays frames between
//! the extension's native port (stdin/stdout) and any number of MCP servers
//! on a local socket (`docs/protocol.md` § Flows).

use std::collections::{HashMap, HashSet};
use std::io;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

use crate::wire::{self, ErrorCode, Frame, PROTOCOL};

type Tx = mpsc::UnboundedSender<Frame>;

struct State {
    instance: String,
    /// The extension's protocol once it has said hello, passed on to
    /// clients so one on another protocol refuses it
    /// (`docs/protocol.md` § Compatibility).
    protocol: u32,
    profile_dir: Option<String>,
    extension_version: String,
    clients: HashMap<u64, Tx>,
    /// Host-wide call id -> (client, the client's own id).
    pending: HashMap<u64, (u64, u64)>,
    sessions: HashMap<u64, HashSet<String>>,
    next_id: u64,
    next_client: u64,
}

impl State {
    fn hello(&self) -> Frame {
        Frame::Hello {
            protocol: self.protocol,
            profile_dir: self.profile_dir.clone(),
            extension_version: self.extension_version.clone(),
            instance: self.instance.clone(),
        }
    }

    fn broadcast(&self, frame: &Frame) {
        for tx in self.clients.values() {
            let _ = tx.send(frame.clone());
        }
    }
}

/// Relays until Chrome closes the port (`from_chrome` ends).
pub async fn run<R, W>(
    mut from_chrome: R,
    mut to_chrome: W,
    listener: UnixListener,
    instance: String,
) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let state = Arc::new(Mutex::new(State {
        instance,
        protocol: PROTOCOL,
        profile_dir: None,
        extension_version: String::new(),
        clients: HashMap::new(),
        pending: HashMap::new(),
        sessions: HashMap::new(),
        next_id: 1,
        next_client: 1,
    }));

    let (chrome_tx, mut chrome_rx) = mpsc::unbounded_channel::<Frame>();
    let writer = tokio::spawn(async move {
        while let Some(frame) = chrome_rx.recv().await {
            if let Err(e) = wire::write_frame_for_chrome(&mut to_chrome, &frame).await {
                eprintln!("browser-hand: write to chrome failed: {e}");
                break;
            }
        }
    });

    let accept = tokio::spawn(accept_loop(listener, state.clone(), chrome_tx.clone()));

    loop {
        let frame = match wire::read_frame(&mut from_chrome).await {
            Ok(Some(frame)) => frame,
            Ok(None) => break,
            Err(e) if e.kind() == io::ErrorKind::InvalidData => {
                eprintln!("browser-hand: skipped a frame from chrome: {e}");
                continue;
            }
            Err(e) => {
                eprintln!("browser-hand: read from chrome failed: {e}");
                break;
            }
        };
        let st = &mut *state.lock().unwrap();
        match frame {
            Frame::Hello {
                protocol,
                profile_dir,
                extension_version,
                ..
            } => {
                if protocol != PROTOCOL {
                    eprintln!("browser-hand: the extension speaks protocol {protocol}, this host speaks {PROTOCOL}");
                }
                st.protocol = protocol;
                st.profile_dir = profile_dir;
                st.extension_version = extension_version;
                st.broadcast(&st.hello());
            }
            claimed @ Frame::Claimed { .. } => {
                if let Frame::Claimed { profile_dir, .. } = &claimed {
                    st.profile_dir = Some(profile_dir.clone());
                }
                st.broadcast(&claimed);
                st.broadcast(&st.hello());
            }
            Frame::Result {
                id,
                ok,
                content,
                error,
            } => {
                if let Some((client, own_id)) = st.pending.remove(&id) {
                    if let Some(tx) = st.clients.get(&client) {
                        let _ = tx.send(Frame::Result {
                            id: own_id,
                            ok,
                            content,
                            error,
                        });
                    }
                }
            }
            other => eprintln!("browser-hand: ignored {:?} from chrome", frame_type(&other)),
        }
    }

    accept.abort();
    drop(chrome_tx);
    let _ = writer.await;
    Ok(())
}

fn frame_type(frame: &Frame) -> &'static str {
    match frame {
        Frame::Call { .. } => "call",
        Frame::Result { .. } => "result",
        Frame::Hello { .. } => "hello",
        Frame::Claimed { .. } => "claimed",
        Frame::Chunk { .. } => "chunk",
        Frame::End { .. } => "end",
    }
}

async fn accept_loop(listener: UnixListener, state: Arc<Mutex<State>>, chrome: Tx) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(serve_client(stream, state.clone(), chrome.clone()));
            }
            Err(e) => {
                eprintln!("browser-hand: accept failed: {e}");
                return;
            }
        }
    }
}

async fn serve_client(stream: UnixStream, state: Arc<Mutex<State>>, chrome: Tx) {
    let (mut read, mut write) = stream.into_split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Frame>();
    let client = {
        let st = &mut *state.lock().unwrap();
        let client = st.next_client;
        st.next_client += 1;
        let _ = tx.send(st.hello());
        st.clients.insert(client, tx);
        client
    };

    let writer = tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            if wire::write_frame(&mut write, &frame).await.is_err() {
                break;
            }
        }
    });

    loop {
        match wire::read_frame(&mut read).await {
            Ok(Some(Frame::Call {
                id,
                session,
                tool,
                args,
            })) => {
                let st = &mut *state.lock().unwrap();
                // A session belongs to the client that first used it, so
                // another client cannot act in it or end it by leaving.
                if st
                    .sessions
                    .iter()
                    .any(|(c, s)| *c != client && s.contains(&session))
                {
                    if let Some(tx) = st.clients.get(&client) {
                        let _ = tx.send(Frame::err(
                            id,
                            ErrorCode::BadArgs,
                            "session id is in use by another client",
                        ));
                    }
                    continue;
                }
                let host_id = st.next_id;
                st.next_id += 1;
                st.pending.insert(host_id, (client, id));
                st.sessions
                    .entry(client)
                    .or_default()
                    .insert(session.clone());
                let _ = chrome.send(Frame::Call {
                    id: host_id,
                    session,
                    tool,
                    args,
                });
            }
            Ok(Some(_)) => {}
            Err(e) if e.kind() == io::ErrorKind::InvalidData => {}
            Ok(None) | Err(_) => break,
        }
    }

    let st = &mut *state.lock().unwrap();
    st.clients.remove(&client);
    st.pending.retain(|_, (c, _)| *c != client);
    for session in st.sessions.remove(&client).unwrap_or_default() {
        let _ = chrome.send(Frame::End { session });
    }
    writer.abort();
}

/// Removes the socket file when dropped, so a host that exits normally
/// leaves nothing behind.
pub struct SocketGuard(pub std::path::PathBuf);

impl Drop for SocketGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Binds this process's socket and relays stdin/stdout until Chrome closes
/// the port or the process is told to stop.
pub async fn main() -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    use tokio::signal::unix::{signal, SignalKind};

    crate::paths::ensure_socket_dir()?;
    let path = crate::paths::socket_path(std::process::id());
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    let _guard = SocketGuard(path);

    let instance = uuid::Uuid::new_v4().to_string();
    let mut term = signal(SignalKind::terminate())?;
    let mut int = signal(SignalKind::interrupt())?;
    tokio::select! {
        r = run(tokio::io::stdin(), tokio::io::stdout(), listener, instance) => r?,
        _ = term.recv() => {}
        _ = int.recv() => {}
    }
    Ok(())
}

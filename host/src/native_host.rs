//! `browser-hand` as Chrome's native messaging host: relays frames between
//! the extension's native port (stdin/stdout) and any number of MCP servers
//! on a local socket (`docs/protocol.md` § Flows). It also owns
//! `config.toml` for its extension: sends it on hello, saves what the
//! settings page asks, and pushes the file again when another profile
//! changes it (plans/06-settings.md).

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;

use crate::config::{self, Settings};
use crate::ipc::Accept;
use crate::wire::{self, ErrorCode, Frame, ProfileRef, SettingsError, PROTOCOL};

type Tx = mpsc::UnboundedSender<Frame>;

/// Where the native host finds the settings file and the profiles the
/// settings page may name.
#[derive(Debug, Clone)]
pub struct HostOptions {
    pub config: PathBuf,
    pub roots: Vec<crate::profiles::Root>,
    /// The browser this host runs in, from its parent process.
    pub browser: Option<String>,
    /// How often to look for a change to the file.
    pub poll: Duration,
}

impl HostOptions {
    pub fn from_env() -> Self {
        let roots = crate::profiles::roots();
        let browser = crate::profiles::parent_identity(crate::profiles::parent_pid(), &roots)
            .map(String::from);
        HostOptions {
            config: crate::paths::config_path(),
            roots,
            browser,
            poll: config::POLL,
        }
    }
}

/// The settings side of the host: what it last sent its extension.
struct Conf {
    opts: HostOptions,
    /// The extension has said hello, so settings may go to it.
    hello: bool,
    /// The revision last sent, so the poll sends each change once.
    sent: Option<String>,
    /// The last settings that parsed, kept when a hand edit breaks the file.
    last_good: Option<Settings>,
}

pub const STALE: &str =
    "Settings changed in another profile. The page now shows them; make your change again.";

impl Conf {
    /// A `settings` frame for the file as it is now.
    fn read(&mut self) -> Frame {
        let path = &self.opts.config;
        let (settings, warnings, revision) = match config::load(path) {
            Ok(l) => {
                self.last_good = Some(l.settings.clone());
                (l.settings, l.warnings, l.revision)
            }
            Err(e) => {
                let first = e.lines().next().unwrap_or_default().to_owned();
                let keep = self.last_good.clone().unwrap_or_default();
                (
                    keep,
                    vec![format!(
                        "config.toml: {first}; keeping the last settings that read"
                    )],
                    config::revision(path),
                )
            }
        };
        let profiles = crate::profiles::read_all(&self.opts.roots)
            .unwrap_or_default()
            .into_iter()
            .map(|p| ProfileRef {
                browser: crate::profiles::browser(&p.browser)
                    .map_or(p.browser.clone(), |b| b.name.to_owned()),
                dir: p.dir,
                name: p.name,
                id: p.id,
            })
            .collect();
        self.sent = Some(revision.clone());
        Frame::Settings {
            settings,
            revision,
            path: path.display().to_string(),
            profiles,
            warnings,
        }
    }

    /// Saves what the page sent, unless the file changed since the page
    /// read it or a value is refused.
    fn save(&mut self, id: u64, value: &serde_json::Value, base: &str) -> Frame {
        let path = self.opts.config.clone();
        let refuse = |field: Option<&str>, message: String| Frame::SettingsSaved {
            id,
            ok: false,
            path: None,
            error: Some(SettingsError {
                field: field.map(String::from),
                message,
            }),
        };
        if config::revision(&path) != base {
            return refuse(None, STALE.into());
        }
        let settings = match config::from_page(value) {
            Ok(s) => s,
            Err((field, message)) => return refuse(field, message),
        };
        match config::save(&path, &settings) {
            Ok(_) => Frame::SettingsSaved {
                id,
                ok: true,
                path: Some(path.display().to_string()),
                error: None,
            },
            Err(e) => refuse(None, format!("could not write {}: {e}", path.display())),
        }
    }
}

fn send_settings(conf: &Mutex<Conf>, chrome: &Tx) {
    let frame = conf.lock().unwrap().read();
    let _ = chrome.send(frame);
}

/// Looks at the file every `poll` and sends it again when it changed.
async fn poll_loop(conf: Arc<Mutex<Conf>>, chrome: Tx) {
    let every = conf.lock().unwrap().opts.poll;
    loop {
        tokio::time::sleep(every).await;
        let changed = {
            let c = conf.lock().unwrap();
            c.hello && c.sent.as_deref() != Some(config::revision(&c.opts.config).as_str())
        };
        if changed {
            send_settings(&conf, &chrome);
        }
    }
}

struct State {
    instance: String,
    /// The extension's protocol once it has said hello, passed on to
    /// clients so one on another protocol refuses it
    /// (`docs/protocol.md` § Compatibility).
    protocol: u32,
    profile_dir: Option<String>,
    extension_version: String,
    /// The browser from the host's parent process, stamped on every hello.
    browser: Option<String>,
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
            browser: self.browser.clone(),
        }
    }

    fn broadcast(&self, frame: &Frame) {
        for tx in self.clients.values() {
            let _ = tx.send(frame.clone());
        }
    }
}

/// Relays until Chrome closes the port (`from_chrome` ends).
pub async fn run<R, W, L>(
    mut from_chrome: R,
    mut to_chrome: W,
    listener: L,
    instance: String,
    opts: HostOptions,
) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin + Send + 'static,
    L: Accept + Send + 'static,
{
    let state = Arc::new(Mutex::new(State {
        instance,
        protocol: PROTOCOL,
        profile_dir: None,
        extension_version: String::new(),
        browser: opts.browser.clone(),
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
    let conf = Arc::new(Mutex::new(Conf {
        opts,
        hello: false,
        sent: None,
        last_good: None,
    }));
    let poll = tokio::spawn(poll_loop(conf.clone(), chrome_tx.clone()));

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
        if let Frame::SettingsSet {
            id,
            settings,
            revision,
        } = &frame
        {
            let reply = conf.lock().unwrap().save(*id, settings, revision);
            let _ = chrome_tx.send(reply);
            // Saved or refused, the page shows the file as it is now.
            send_settings(&conf, &chrome_tx);
            continue;
        }
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
                conf.lock().unwrap().hello = true;
                send_settings(&conf, &chrome_tx);
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
    poll.abort();
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
        Frame::Settings { .. } => "settings",
        Frame::SettingsSet { .. } => "settings_set",
        Frame::SettingsSaved { .. } => "settings_saved",
        Frame::Reload {} => "reload",
    }
}

async fn accept_loop<L: Accept + Send + 'static>(
    mut listener: L,
    state: Arc<Mutex<State>>,
    chrome: Tx,
) {
    loop {
        match listener.accept().await {
            Ok(stream) => {
                tokio::spawn(serve_client(stream, state.clone(), chrome.clone()));
            }
            Err(e) => {
                eprintln!("browser-hand: accept failed: {e}");
                return;
            }
        }
    }
}

async fn serve_client<S: AsyncRead + AsyncWrite + Send + Unpin + 'static>(
    stream: S,
    state: Arc<Mutex<State>>,
    chrome: Tx,
) {
    let (mut read, mut write) = tokio::io::split(stream);
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
            Ok(Some(Frame::Reload {})) => {
                let _ = chrome.send(Frame::Reload {});
            }
            // Anything else, `settings_set` included, is not a client's to
            // send: settings change only from the page in Chrome.
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
    // Handlers first: a stop that arrives as the socket appears must not
    // kill the process outright and leave the socket file behind.
    let stop = stop_signal()?;
    crate::paths::ensure_socket_dir()?;
    let path = crate::paths::socket_path(std::process::id());
    let listener = crate::ipc::bind(&path)?;
    let _guard = SocketGuard(path);

    let instance = uuid::Uuid::new_v4().to_string();
    tokio::select! {
        r = run(tokio::io::stdin(), tokio::io::stdout(), listener, instance, HostOptions::from_env()) => r?,
        r = stop => r?,
    }
    Ok(())
}

/// Registers for the stop signals now and returns what waits on them:
/// SIGTERM or SIGINT, on Windows Ctrl-C (Chrome ends a host by closing its
/// stdin, which ends `run`).
#[cfg(unix)]
fn stop_signal() -> io::Result<impl std::future::Future<Output = io::Result<()>>> {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = signal(SignalKind::terminate())?;
    let mut int = signal(SignalKind::interrupt())?;
    Ok(async move {
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
        Ok(())
    })
}

#[cfg(windows)]
fn stop_signal() -> io::Result<impl std::future::Future<Output = io::Result<()>>> {
    Ok(tokio::signal::ctrl_c())
}

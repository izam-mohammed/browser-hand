//! The MCP server's side of a host socket: calls go out, results come back
//! to whoever is waiting on that id.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot, watch};

use crate::wire::{self, ErrorCode, Frame, PROTOCOL};

#[derive(Debug, Clone, PartialEq)]
pub struct HelloInfo {
    pub protocol: u32,
    pub profile_dir: Option<String>,
    pub extension_version: String,
    pub instance: String,
}

fn hello_info(frame: Frame) -> Option<HelloInfo> {
    match frame {
        Frame::Hello { protocol, profile_dir, extension_version, instance } => {
            Some(HelloInfo { protocol, profile_dir, extension_version, instance })
        }
        _ => None,
    }
}

async fn first_hello(stream: &mut UnixStream, wait: Duration) -> io::Result<HelloInfo> {
    let frame = tokio::time::timeout(wait, wire::read_frame(stream))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "no hello from host"))??
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "host closed before hello"))?;
    hello_info(frame).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "first frame was not hello"))
}

/// Connects, reads the host's hello, and hangs up.
pub async fn probe(path: &Path, wait: Duration) -> io::Result<HelloInfo> {
    let mut stream = UnixStream::connect(path).await?;
    first_hello(&mut stream, wait).await
}

/// Why a call produced no result frame.
#[derive(Debug)]
pub enum CallError {
    /// The host went away; the connection is dead.
    Disconnected,
    TimedOut,
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Frame>>>>;

pub struct HostConn {
    pub path: PathBuf,
    tx: mpsc::UnboundedSender<Frame>,
    pending: Pending,
    next_id: AtomicU64,
    hello: watch::Receiver<HelloInfo>,
    reader: tokio::task::JoinHandle<()>,
}

impl HostConn {
    pub async fn connect(path: &Path) -> io::Result<HostConn> {
        let mut stream = UnixStream::connect(path).await?;
        let hello = first_hello(&mut stream, Duration::from_secs(2)).await?;
        if hello.protocol != PROTOCOL {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("host speaks protocol {}, this server speaks {PROTOCOL}", hello.protocol),
            ));
        }
        let (mut read, mut write) = stream.into_split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Frame>();
        tokio::spawn(async move {
            while let Some(frame) = rx.recv().await {
                if wire::write_frame(&mut write, &frame).await.is_err() {
                    break;
                }
            }
        });

        let pending: Pending = Arc::default();
        let (hello_tx, hello_rx) = watch::channel(hello);
        let reader_pending = pending.clone();
        let reader = tokio::spawn(async move {
            loop {
                match wire::read_frame(&mut read).await {
                    Ok(Some(frame @ Frame::Result { .. })) => {
                        let Frame::Result { id, .. } = &frame else { unreachable!() };
                        if let Some(waiter) = reader_pending.lock().unwrap().remove(id) {
                            let _ = waiter.send(frame);
                        }
                    }
                    Ok(Some(frame @ Frame::Hello { .. })) => {
                        let _ = hello_tx.send(hello_info(frame).expect("is hello"));
                    }
                    Ok(Some(_)) => {}
                    Err(e) if e.kind() == io::ErrorKind::InvalidData => {}
                    Ok(None) | Err(_) => break,
                }
            }
            // Dropping the senders wakes every waiter with Disconnected.
            reader_pending.lock().unwrap().clear();
        });

        Ok(HostConn { path: path.to_owned(), tx, pending, next_id: AtomicU64::new(1), hello: hello_rx, reader })
    }

    pub fn hello(&self) -> HelloInfo {
        self.hello.borrow().clone()
    }

    pub fn is_alive(&self) -> bool {
        !self.reader.is_finished() && !self.tx.is_closed()
    }

    /// Sends a call and waits for its result frame.
    pub async fn call(&self, session: &str, tool: &str, args: Value, wait: Duration) -> Result<Frame, CallError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (done, result) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, done);
        let frame = Frame::Call { id, session: session.into(), tool: tool.into(), args };
        if self.tx.send(frame).is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err(CallError::Disconnected);
        }
        match tokio::time::timeout(wait, result).await {
            Ok(Ok(frame)) => Ok(frame),
            Ok(Err(_)) => Err(CallError::Disconnected),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(CallError::TimedOut)
            }
        }
    }
}

impl Drop for HostConn {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

/// The error a dead or silent host turns into for Claude.
pub fn call_error_frame(e: CallError, tool: &str, wait: Duration) -> Frame {
    match e {
        CallError::Disconnected => Frame::err(
            0,
            ErrorCode::NotConnected,
            "The browser connection closed. Chrome or the extension may have restarted; call list_profiles and select_profile again.",
        ),
        CallError::TimedOut => Frame::err(0, ErrorCode::Timeout, format!("{tool} did not answer within {} s", wait.as_secs())),
    }
}

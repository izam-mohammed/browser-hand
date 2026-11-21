//! The wire contract between the MCP server, the native host and the
//! extension (`docs/protocol.md`). One JSON object per frame, prefixed by its
//! length as a little-endian u32, on the local socket and on Chrome's native
//! port alike.

use std::collections::HashMap;
use std::io;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use ts_rs::TS;

use crate::config::Settings;

/// Bumped on any breaking change to the frames below.
pub const PROTOCOL: u32 = 1;

/// Chrome closes the native port on a host message above this many bytes
/// (`docs/external/chrome-native-messaging.md` § Limits).
pub const CHROME_MAX_MESSAGE: usize = 1024 * 1024;

/// Base64 characters carried by one `chunk` frame.
pub const CHUNK_DATA_CHARS: usize = 786_432;

/// Largest frame accepted from anyone: Chrome's limit towards the host.
pub const MAX_FRAME: usize = 64 * 1024 * 1024;

#[cfg(not(target_endian = "little"))]
compile_error!("native messaging uses native byte order; the wire assumes little-endian");

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "wire.gen.ts")]
pub enum Frame {
    Call {
        id: u64,
        session: String,
        tool: String,
        args: Value,
    },
    Result {
        id: u64,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<Vec<Content>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<WireError>,
    },
    Hello {
        protocol: u32,
        profile_dir: Option<String>,
        extension_version: String,
        instance: String,
        /// The browser the host runs in (a key of `BROWSERS`), stamped by
        /// the native host on the hellos it sends its clients; the
        /// extension sends none. Absent from an older host or when the
        /// host could not tell (`plans/15-browser-identity.md`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        browser: Option<String>,
    },
    Claimed {
        profile_dir: String,
        nonce: String,
    },
    Chunk {
        id: u64,
        seq: u32,
        last: bool,
        data: String,
    },
    End {
        session: String,
    },
    /// Host to extension: `config.toml` as read now, on the extension's
    /// hello and whenever the file changes (plans/06-settings.md).
    Settings {
        settings: Box<Settings>,
        /// The file's modification time in ns, "0" with no file.
        revision: String,
        /// Where the file is, absolute.
        path: String,
        profiles: Vec<ProfileRef>,
        /// One line per key the file got wrong.
        warnings: Vec<String>,
    },
    /// Extension to host, from the settings page only: save these. Taken
    /// only from Chrome's port, never from a socket client.
    SettingsSet {
        id: u64,
        #[ts(as = "Settings")]
        settings: Value,
        /// The revision the page edited; a different one on disk is refused.
        revision: String,
    },
    /// Socket client to host to extension: reload the extension from disk
    /// with `chrome.runtime.reload()` (`browser-hand reload`, which
    /// `scripts/build.sh` runs).
    Reload {},
    /// Host to extension: the answer to `settings_set`.
    SettingsSaved {
        id: u64,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<SettingsError>,
    },
}

/// A Chrome profile the settings page can name as the default.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct ProfileRef {
    /// The directory name the browser uses (`Default`).
    pub dir: String,
    pub name: String,
    /// What `sessions.default_profile` holds: `dir`, or `<browser>:<dir>`
    /// when more than one browser is installed.
    pub id: String,
    /// The browser's display name (`Brave`).
    pub browser: String,
}

/// Why a save was refused: the key at fault when there is one.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct SettingsError {
    pub field: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "wire.gen.ts")]
pub enum Content {
    Text {
        text: String,
    },
    Image {
        data: String,
        mime_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        image_id: Option<String>,
    },
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[ts(export, export_to = "wire.gen.ts")]
pub struct WireError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "wire.gen.ts")]
pub enum ErrorCode {
    NotConnected,
    NoTab,
    DebuggerRefused,
    Timeout,
    BadArgs,
    PageError,
    /// A site the person blocked, or made read-only, in the settings.
    Blocked,
}

impl Frame {
    pub fn ok(id: u64, content: Vec<Content>) -> Self {
        Frame::Result {
            id,
            ok: true,
            content: Some(content),
            error: None,
        }
    }

    pub fn err(id: u64, code: ErrorCode, message: impl Into<String>) -> Self {
        Frame::Result {
            id,
            ok: false,
            content: None,
            error: Some(WireError {
                code,
                message: message.into(),
            }),
        }
    }
}

/// The frame's JSON body, without the length prefix.
pub fn to_json(frame: &Frame) -> Vec<u8> {
    serde_json::to_vec(frame).expect("frames always serialise")
}

/// Reads one frame body. `Ok(None)` is a clean end of stream between frames.
pub async fn read_body<R: AsyncRead + Unpin>(r: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len) as usize;
    if len > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("frame of {len} bytes"),
        ));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    Ok(Some(body))
}

/// Reads and parses one frame. A body that is not a known frame is an error
/// of kind `InvalidData`; the stream stays usable after it.
pub async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> io::Result<Option<Frame>> {
    match read_body(r).await? {
        None => Ok(None),
        Some(body) => serde_json::from_slice(&body)
            .map(Some)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e)),
    }
}

pub async fn write_body<W: AsyncWrite + Unpin>(w: &mut W, body: &[u8]) -> io::Result<()> {
    w.write_all(&(body.len() as u32).to_le_bytes()).await?;
    w.write_all(body).await?;
    w.flush().await
}

pub async fn write_frame<W: AsyncWrite + Unpin>(w: &mut W, frame: &Frame) -> io::Result<()> {
    write_body(w, &to_json(frame)).await
}

/// Writes a frame towards Chrome, splitting it into `chunk` frames when its
/// body is over Chrome's 1 MB limit.
pub async fn write_frame_for_chrome<W: AsyncWrite + Unpin>(
    w: &mut W,
    frame: &Frame,
) -> io::Result<()> {
    for part in chunk(frame) {
        write_frame(w, &part).await?;
    }
    Ok(())
}

fn frame_id(frame: &Frame) -> u64 {
    match frame {
        Frame::Call { id, .. }
        | Frame::Result { id, .. }
        | Frame::Chunk { id, .. }
        | Frame::SettingsSet { id, .. }
        | Frame::SettingsSaved { id, .. } => *id,
        _ => 0,
    }
}

/// The frame itself when it fits in one Chrome message, otherwise `chunk`
/// frames carrying the base64 of its JSON body.
pub fn chunk(frame: &Frame) -> Vec<Frame> {
    let body = to_json(frame);
    if body.len() <= CHROME_MAX_MESSAGE {
        return vec![frame.clone()];
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(&body);
    let pieces: Vec<&str> = encoded
        .as_bytes()
        .chunks(CHUNK_DATA_CHARS)
        .map(|c| std::str::from_utf8(c).expect("base64 is ascii"))
        .collect();
    let n = pieces.len();
    pieces
        .into_iter()
        .enumerate()
        .map(|(seq, data)| Frame::Chunk {
            id: frame_id(frame),
            seq: seq as u32,
            last: seq + 1 == n,
            data: data.to_owned(),
        })
        .collect()
}

/// Rejoins `chunk` frames into the frame they carry.
#[derive(Default)]
pub struct Reassembler {
    parts: HashMap<u64, (u32, String)>,
}

impl Reassembler {
    /// Feeds one frame. Non-chunk frames pass straight through; a chunk
    /// returns the whole frame once its last piece arrives.
    pub fn push(&mut self, frame: Frame) -> io::Result<Option<Frame>> {
        let Frame::Chunk {
            id,
            seq,
            last,
            data,
        } = frame
        else {
            return Ok(Some(frame));
        };
        let entry = self.parts.entry(id).or_insert((0, String::new()));
        if entry.0 != seq {
            self.parts.remove(&id);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("chunk {seq} out of order"),
            ));
        }
        entry.0 += 1;
        entry.1.push_str(&data);
        if !last {
            return Ok(None);
        }
        let (_, encoded) = self.parts.remove(&id).expect("entry exists");
        let body = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        serde_json::from_slice(&body)
            .map(Some)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }
}

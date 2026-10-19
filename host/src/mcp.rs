//! `browser-hand mcp`: the stdio MCP server. One process is one session; it
//! binds to one Chrome profile's host and forwards tool calls to it.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::gif::{self, Overlays, Recorded, Recorder};
use crate::host_conn::{self, HostConn};
use crate::profiles::{self, LiveHost, Profile};
use crate::tools::args::*;
use crate::tools::files;
use crate::tools::images::{self, ImageStore};
use crate::wire::{Content, Frame};

/// The extension's ID, fixed by the `key` in `extension/manifest.json`
/// (checked by `host/tests/mcp.rs`).
pub const EXTENSION_ID: &str = "ednpkicgdjiiihmophoifehfeeoabjdc";

/// Sent to Claude Code at connection (cut at 4,096 characters there;
/// `host/tests/instructions.rs` keeps it under).
pub const INSTRUCTIONS: &str = include_str!("instructions.md");

const PROBE_WAIT: Duration = Duration::from_millis(800);
const CLAIM_WAIT: Duration = Duration::from_secs(10);
/// Chrome cold-starting and loading the profile takes longer.
const CLAIM_WAIT_COLD: Duration = Duration::from_secs(30);
const CALL_WAIT: Duration = Duration::from_secs(20);
const NAVIGATE_WAIT: Duration = Duration::from_secs(45);
/// Typing a long text at human speed takes minutes.
const COMPUTER_WAIT: Duration = Duration::from_secs(300);
/// GIF frames are smaller than the screenshots Claude sees.
const GIF_FRAME_SCALE: f64 = 0.6;
const GIF_FRAME_DELAY_MS: u32 = 700;

/// Opens `url` in Chrome's profile `dir`, opening the profile (and starting
/// Chrome) when needed. Returns whether Chrome had to be started.
pub type Launcher = Arc<dyn Fn(&str, &str) -> std::io::Result<bool> + Send + Sync>;

fn chrome_running() -> bool {
    std::process::Command::new("pgrep")
        .args(["-x", "Google Chrome"])
        .stdout(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// `open -na "Google Chrome" --args --profile-directory=<dir> <url>`: a
/// running Chrome routes it to that profile, loading the profile if it is not
/// open; with Chrome closed it starts Chrome in that profile
/// (`docs/external/chrome-profiles-and-launch.md`).
pub fn open_in_chrome() -> Launcher {
    Arc::new(|dir: &str, url: &str| {
        let started = !chrome_running();
        let status = std::process::Command::new("open")
            .args(["-na", "Google Chrome", "--args"])
            .arg(format!("--profile-directory={dir}"))
            .arg(url)
            .status()?;
        if status.success() {
            Ok(started)
        } else {
            Err(std::io::Error::other(format!("open exited with {status}")))
        }
    })
}

/// `human` (default) or `fast`, from `BROWSER_HAND_PACE`.
pub fn pace_from_env() -> String {
    match std::env::var("BROWSER_HAND_PACE").as_deref() {
        Ok("fast") => "fast".into(),
        _ => "human".into(),
    }
}

struct Bound {
    profile: Profile,
    conn: HostConn,
}

pub struct Inner {
    session: String,
    chrome_dir: PathBuf,
    socket_dir: PathBuf,
    launch: Launcher,
    pace: String,
    bound: Mutex<Option<Bound>>,
    images: std::sync::Mutex<ImageStore>,
    recorder: Mutex<Recorder>,
}

#[derive(Clone)]
pub struct Server {
    inner: Arc<Inner>,
}

/// What a tool produced: content for Claude, or an error message.
type Outcome = Result<Vec<Content>, String>;

fn text(t: impl Into<String>) -> Content {
    Content::Text { text: t.into() }
}

fn json_text(v: Value) -> Outcome {
    Ok(vec![text(v.to_string())])
}

/// The outcome as an MCP tool result.
fn respond(outcome: Outcome) -> CallToolResult {
    match outcome {
        Ok(content) => CallToolResult::success(
            content
                .into_iter()
                .map(|c| match c {
                    Content::Text { text } => ContentBlock::text(text),
                    Content::Image { data, mime_type, .. } => ContentBlock::image(data, mime_type),
                })
                .collect(),
        ),
        Err(message) => CallToolResult::error(vec![ContentBlock::text(message)]),
    }
}

fn from_frame(frame: Frame) -> Outcome {
    match frame {
        Frame::Result { ok: true, content, .. } => Ok(content.unwrap_or_default()),
        Frame::Result { error: Some(e), .. } => {
            let code = serde_json::to_value(e.code).unwrap_or_default();
            Err(format!("{}: {}", code.as_str().unwrap_or("error"), e.message))
        }
        other => Err(format!("unexpected reply from the browser: {other:?}")),
    }
}

fn to_args(args: &impl Serialize) -> Value {
    serde_json::to_value(args).unwrap_or_default()
}

/// `dir` percent-encoded for the claim URL's fragment.
fn encode_component(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// A batch item's tool name without any `mcp__<server>__` prefix.
pub fn bare_tool_name(name: &str) -> &str {
    name.rsplit("__").next().unwrap_or(name)
}

impl Server {
    pub fn new(chrome_dir: PathBuf, socket_dir: PathBuf, launch: Launcher) -> Self {
        Self::with_pace(chrome_dir, socket_dir, launch, "human".into())
    }

    pub fn with_pace(chrome_dir: PathBuf, socket_dir: PathBuf, launch: Launcher, pace: String) -> Self {
        Server {
            inner: Arc::new(Inner {
                session: uuid::Uuid::new_v4().to_string(),
                chrome_dir,
                socket_dir,
                launch,
                pace,
                bound: Mutex::new(None),
                images: Default::default(),
                recorder: Default::default(),
            }),
        }
    }

    async fn hosts(&self) -> Vec<LiveHost> {
        profiles::discover(&self.inner.socket_dir, PROBE_WAIT).await
    }

    fn host_for<'a>(hosts: &'a [LiveHost], dir: &str) -> Option<&'a LiveHost> {
        hosts.iter().find(|h| h.hello.profile_dir.as_deref() == Some(dir))
    }

    async fn bind(&self, profile: Profile, host: &LiveHost) -> Result<(), String> {
        let mut bound = self.inner.bound.lock().await;
        // Already bound to this profile's live host: keep the connection.
        // Dropping it would make the host send `end` for this session, and
        // the extension would forget the session's tab group.
        if let Some(b) = bound.as_mut() {
            if b.profile.dir == profile.dir && b.conn.is_alive() && b.conn.path == host.path {
                b.profile = profile;
                return Ok(());
            }
        }
        let conn = HostConn::connect(&host.path).await.map_err(|e| format!("could not connect to {}: {e}", profile.dir))?;
        *bound = Some(Bound { profile, conn });
        Ok(())
    }

    /// Opens `profile` with the claim page in it (starting Chrome if needed)
    /// and waits for its host to say hello with that dir.
    async fn claim(&self, profile: &Profile) -> Result<LiveHost, String> {
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let url = format!(
            "chrome-extension://{EXTENSION_ID}/claim.html#dir={}&nonce={nonce}",
            encode_component(&profile.dir)
        );
        let started = (self.inner.launch)(&profile.dir, &url).map_err(|e| format!("could not open Chrome: {e}"))?;
        let wait = if started { CLAIM_WAIT_COLD } else { CLAIM_WAIT };
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            if let Some(h) = Self::host_for(&self.hosts().await, &profile.dir) {
                return Ok(h.clone());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(format!(
                    "Opened the profile \"{}\" ({}){}, but its browser-hand extension did not answer within {} s. \
                     Is the extension loaded in that profile? (chrome://extensions, Developer mode, Load unpacked: extension/dist)",
                    profile.name,
                    profile.dir,
                    if started { " after starting Chrome" } else { "" },
                    wait.as_secs()
                ));
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    /// Sends a tool call to the bound profile, binding the only connected
    /// profile when none is selected, and reconnecting once if the host
    /// restarted.
    async fn call(&self, tool: &str, args: Value, wait: Duration) -> Outcome {
        let mut bound = self.inner.bound.lock().await;

        if bound.is_none() {
            let hosts = self.hosts().await;
            let claimed: Vec<&LiveHost> = hosts.iter().filter(|h| h.hello.profile_dir.is_some()).collect();
            if claimed.len() != 1 {
                return Err(
                    "No profile selected. Call list_profiles, then select_profile (ask the user which profile when several are connected)."
                        .into(),
                );
            }
            let dir = claimed[0].hello.profile_dir.clone().unwrap_or_default();
            let profiles = profiles::read_profiles(&self.inner.chrome_dir).unwrap_or_default();
            let profile = profiles.into_iter().find(|p| p.dir == dir).unwrap_or(Profile { name: dir.clone(), dir, last_used: false });
            let conn = HostConn::connect(&claimed[0].path).await.map_err(|e| format!("not_connected: {e}"))?;
            *bound = Some(Bound { profile, conn });
        }

        let b = bound.as_mut().expect("bound above");
        if !b.conn.is_alive() {
            let hosts = self.hosts().await;
            let Some(h) = Self::host_for(&hosts, &b.profile.dir) else {
                return Err(format!(
                    "not_connected: the profile \"{}\" is no longer connected. Call select_profile again.",
                    b.profile.name
                ));
            };
            b.conn = HostConn::connect(&h.path).await.map_err(|e| format!("not_connected: {e}"))?;
        }

        match b.conn.call(&self.inner.session, tool, args, wait).await {
            Ok(frame) => from_frame(frame),
            Err(e) => from_frame(host_conn::call_error_frame(e, tool, wait)),
        }
    }

    /// Takes a GIF frame of `tab_id` if this session is recording.
    async fn record(&self, tab_id: i64, label: Option<String>, click: Option<[f64; 2]>, drag: Option<([f64; 2], [f64; 2])>) {
        if !self.inner.recorder.lock().await.recording {
            return;
        }
        let shot = self.call("computer", json!({ "action": "screenshot", "tabId": tab_id, "scale": GIF_FRAME_SCALE }), CALL_WAIT).await;
        let Ok(content) = shot else { return };
        let scale = content
            .iter()
            .find_map(|c| match c {
                Content::Text { text } => images::scale_from_text(text),
                _ => None,
            })
            .unwrap_or(1.0);
        let Some(image) = content.into_iter().find_map(|c| match c {
            Content::Image { data, .. } => Some(data),
            _ => None,
        }) else {
            return;
        };
        let at = |p: [f64; 2]| (p[0] as f32 * scale, p[1] as f32 * scale);
        let frame = Recorded { image, label, click: click.map(at), drag: drag.map(|(a, b)| (at(a), at(b))) };
        self.inner.recorder.lock().await.frames.push(frame);
    }

    /// Gives each image an id for `upload_image` and saves it when asked.
    fn keep_images(&self, content: &mut Vec<Content>, save: bool) {
        let mut notes = vec![];
        for c in content.iter_mut() {
            if let Content::Image { data, mime_type, image_id } = c {
                let id = self.inner.images.lock().unwrap().keep(data.clone(), mime_type.clone());
                notes.push(format!("imageId: {id}"));
                if save {
                    match images::save(data, mime_type, "screenshot") {
                        Ok(path) => notes.push(format!("Saved to {}", path.display())),
                        Err(e) => notes.push(format!("Could not save: {e}")),
                    }
                }
                *image_id = Some(id);
            }
        }
        content.extend(notes.into_iter().map(text));
    }

    // Each tool's work, shared by its MCP method and by browser_batch.

    async fn do_list_profiles(&self) -> Outcome {
        let profiles = profiles::read_profiles(&self.inner.chrome_dir).map_err(|e| format!("Could not read Chrome's profiles: {e:#}"))?;
        let hosts = self.hosts().await;
        let selected = self.inner.bound.lock().await.as_ref().map(|b| b.profile.dir.clone());
        let list: Vec<Value> = profiles
            .iter()
            .map(|p| {
                json!({
                    "dir": p.dir,
                    "name": p.name,
                    "lastUsed": p.last_used,
                    "connected": Self::host_for(&hosts, &p.dir).is_some(),
                    "selected": selected.as_deref() == Some(p.dir.as_str()),
                })
            })
            .collect();
        let unclaimed = hosts.iter().filter(|h| h.hello.profile_dir.is_none()).count();
        json_text(json!({ "profiles": list, "unclaimedConnections": unclaimed }))
    }

    async fn do_select_profile(&self, args: SelectProfileArgs) -> Outcome {
        let profiles = profiles::read_profiles(&self.inner.chrome_dir).map_err(|e| format!("Could not read Chrome's profiles: {e:#}"))?;
        let Some(profile) = profiles::resolve(&profiles, &args.profile).cloned() else {
            let names: Vec<String> = profiles.iter().map(|p| format!("{} ({})", p.name, p.dir)).collect();
            return Err(format!("No profile \"{}\". Profiles: {}", args.profile, names.join(", ")));
        };
        let hosts = self.hosts().await;
        let host = match Self::host_for(&hosts, &profile.dir) {
            Some(h) => h.clone(),
            None => self.claim(&profile).await?,
        };
        self.bind(profile.clone(), &host).await?;
        json_text(json!({ "selected": { "dir": profile.dir, "name": profile.name }, "extensionVersion": host.hello.extension_version }))
    }

    async fn do_navigate(&self, args: NavigateArgs) -> Outcome {
        let out = self.call("navigate", to_args(&args), NAVIGATE_WAIT).await?;
        if let Some(tab) = args.tab_id {
            self.record(tab, Some(format!("Opens {}", args.url)), None, None).await;
        }
        Ok(out)
    }

    async fn do_form_input(&self, args: FormInputArgs) -> Outcome {
        let out = self.call("form_input", to_args(&args), CALL_WAIT).await?;
        let label = args.action_summary.clone().or(Some(format!("Fills {}", args.reference)));
        self.record(args.tab_id, label, None, None).await;
        Ok(out)
    }

    async fn do_javascript(&self, args: JavascriptArgs) -> Outcome {
        if args.action != "javascript_exec" {
            return Err("bad_args: action must be \"javascript_exec\"".into());
        }
        self.call("javascript_tool", to_args(&args), CALL_WAIT).await
    }

    async fn do_file_upload(&self, args: FileUploadArgs) -> Outcome {
        let files = files::read_for_upload(&args.paths)?;
        self.call("file_upload", json!({ "tabId": args.tab_id, "ref": args.reference, "files": files }), CALL_WAIT).await
    }

    async fn do_computer(&self, args: ComputerArgs) -> Outcome {
        if let Some(d) = args.duration {
            if !(0.0..=10.0).contains(&d) {
                return Err("bad_args: duration must be 0 to 10 seconds".into());
            }
        }
        if let Some(r) = args.repeat {
            if !(1..=100).contains(&r) {
                return Err("bad_args: repeat must be 1 to 100".into());
            }
        }
        if let Some(n) = args.scroll_amount {
            if !(1..=10).contains(&n) {
                return Err("bad_args: scroll_amount must be 1 to 10".into());
            }
        }
        let mut call = to_args(&args);
        call["pace"] = json!(self.inner.pace);
        let mut out = self.call("computer", call, COMPUTER_WAIT).await?;
        if matches!(args.action, ComputerAction::Screenshot | ComputerAction::Zoom) {
            self.keep_images(&mut out, args.save_to_disk.unwrap_or(false));
        } else if args.action.acts() {
            let label = args.action_summary.clone().or_else(|| Some(format!("{:?}", args.action)));
            let drag = match (args.action, args.start_coordinate, args.coordinate) {
                (ComputerAction::LeftClickDrag, Some(a), Some(b)) => Some((a, b)),
                _ => None,
            };
            let click = if drag.is_none() { args.coordinate } else { None };
            self.record(args.tab_id, label, click, drag).await;
        }
        Ok(out)
    }

    async fn do_upload_image(&self, args: UploadImageArgs) -> Outcome {
        if args.reference.is_some() == args.coordinate.is_some() {
            return Err("bad_args: give ref or coordinate, not both".into());
        }
        let (data, mime_type) = {
            let mut store = self.inner.images.lock().unwrap();
            let kept = store.get(&args.image_id).ok_or_else(|| {
                format!("bad_args: {} is unknown or older than 5 minutes; take a fresh screenshot and use its id", args.image_id)
            })?;
            (kept.data.clone(), kept.mime_type.clone())
        };
        let ext = if mime_type == "image/png" { "png" } else { "jpg" };
        let mut call = to_args(&args);
        call["data"] = json!(data);
        call["mimeType"] = json!(mime_type);
        if args.filename.is_none() {
            call["filename"] = json!(format!("image.{ext}"));
        }
        self.call("upload_image", call, CALL_WAIT).await
    }

    async fn do_gif(&self, args: GifArgs) -> Outcome {
        match args.action {
            GifAction::StartRecording => {
                {
                    let mut r = self.inner.recorder.lock().await;
                    r.recording = true;
                }
                self.record(args.tab_id, None, None, None).await;
                let n = self.inner.recorder.lock().await.frames.len();
                Ok(vec![text(format!("Recording. {n} frame(s) so far; a frame is taken after each action."))])
            }
            GifAction::StopRecording => {
                let mut r = self.inner.recorder.lock().await;
                r.recording = false;
                Ok(vec![text(format!("Stopped recording; {} frame(s) kept. Export or clear them.", r.frames.len()))])
            }
            GifAction::Clear => {
                let mut r = self.inner.recorder.lock().await;
                let n = r.frames.len();
                r.frames.clear();
                Ok(vec![text(format!("Cleared {n} frame(s)."))])
            }
            GifAction::Export => {
                let name = gif::safe_filename(args.filename.as_deref()).map_err(|e| format!("bad_args: {e}"))?;
                let o = args.options.unwrap_or_default();
                let overlays = Overlays {
                    click_indicators: o.show_click_indicators.unwrap_or(true),
                    drag_paths: o.show_drag_paths.unwrap_or(true),
                    action_labels: o.show_action_labels.unwrap_or(true),
                    progress_bar: o.show_progress_bar.unwrap_or(true),
                    quality: o.quality.unwrap_or(10),
                };
                let frames = self.inner.recorder.lock().await.frames.clone();
                let bytes = tokio::task::spawn_blocking(move || gif::encode(&frames, &overlays, GIF_FRAME_DELAY_MS))
                    .await
                    .map_err(|e| format!("page_error: {e}"))?
                    .map_err(|e| format!("bad_args: {e:#}"))?;
                let path = gif::output_dir().map_err(|e| e.to_string())?.join(name);
                std::fs::write(&path, &bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
                Ok(vec![text(format!("Exported {} ({} KB) to {}", path.file_name().unwrap_or_default().to_string_lossy(), bytes.len() / 1024, path.display()))])
            }
        }
    }

    /// One tool by name, for browser_batch.
    async fn dispatch(&self, name: &str, input: Value) -> Outcome {
        fn parse<T: serde::de::DeserializeOwned>(name: &str, input: Value) -> Result<T, String> {
            serde_json::from_value(input).map_err(|e| format!("bad_args: {name}: {e}"))
        }
        match name {
            "browser_batch" => Err("bad_args: browser_batch cannot be nested".into()),
            "list_profiles" => self.do_list_profiles().await,
            "select_profile" => self.do_select_profile(parse(name, input)?).await,
            "tabs_context" => self.call(name, to_args(&parse::<TabsContextArgs>(name, input)?), CALL_WAIT).await,
            "tabs_create" => self.call(name, json!({}), CALL_WAIT).await,
            "tabs_close" => self.call(name, to_args(&parse::<TabsCloseArgs>(name, input)?), CALL_WAIT).await,
            "navigate" => {
                let a: NavigateArgs = parse(name, input)?;
                if a.tab_id.is_none() {
                    return Err("bad_args: navigate needs tabId inside browser_batch".into());
                }
                self.do_navigate(a).await
            }
            "read_page" => self.call(name, to_args(&parse::<ReadPageArgs>(name, input)?), CALL_WAIT).await,
            "find" => self.call(name, to_args(&parse::<FindArgs>(name, input)?), CALL_WAIT).await,
            "get_page_text" => self.call(name, to_args(&parse::<TabArgs>(name, input)?), CALL_WAIT).await,
            "read_console_messages" => self.call(name, to_args(&parse::<ConsoleArgs>(name, input)?), CALL_WAIT).await,
            "read_network_requests" => self.call(name, to_args(&parse::<NetworkArgs>(name, input)?), CALL_WAIT).await,
            "form_input" => self.do_form_input(parse(name, input)?).await,
            "javascript_tool" => self.do_javascript(parse(name, input)?).await,
            "file_upload" => self.do_file_upload(parse(name, input)?).await,
            "computer" => self.do_computer(parse(name, input)?).await,
            "resize_window" => self.call(name, to_args(&parse::<ResizeArgs>(name, input)?), CALL_WAIT).await,
            "upload_image" => self.do_upload_image(parse(name, input)?).await,
            "gif_creator" => self.do_gif(parse(name, input)?).await,
            other => Err(format!("bad_args: unknown tool \"{other}\"")),
        }
    }

    async fn do_batch(&self, args: BatchArgs) -> Outcome {
        if args.actions.is_empty() {
            return Err("bad_args: actions is empty".into());
        }
        let mut out = vec![];
        let total = args.actions.len();
        for (i, item) in args.actions.into_iter().enumerate() {
            let name = bare_tool_name(&item.name).to_owned();
            match self.dispatch(&name, item.input).await {
                Ok(content) => {
                    out.push(text(format!("[{}/{total}] {name}: ok", i + 1)));
                    out.extend(content);
                }
                Err(e) => {
                    out.push(text(format!("[{}/{total}] {name} failed, batch stopped: {e}", i + 1)));
                    return if i == 0 { Err(e) } else { Ok(out) };
                }
            }
        }
        Ok(out)
    }
}

#[tool_router]
impl Server {
    #[tool(
        description = "List the Chrome profiles on this computer: dir, name, whether Chrome last used it, and whether the browser-hand extension in it is connected right now. A profile that is not open or not connected can still be selected: select_profile opens it. Call this before select_profile.",
        annotations(read_only_hint = true)
    )]
    pub async fn list_profiles(&self) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_list_profiles().await))
    }

    #[tool(
        description = "Select the Chrome profile this session acts in, by name or dir from list_profiles. If the profile is not open, it is opened with Chrome's command line (starting Chrome if it is not running), and a short-lived page connects its extension. Never choose a profile on the user's behalf when several are connected and they did not say which: ask them."
    )]
    pub async fn select_profile(&self, Parameters(args): Parameters<SelectProfileArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_select_profile(args).await))
    }

    #[tool(
        description = "Get this session's tab group in the selected profile: every tab id, title and URL. Call this at least once before other tab tools. Each session works in its own browser-hand tab group; work in new tabs (tabs_create) unless the user asks to use an existing one.",
        annotations(read_only_hint = true)
    )]
    pub async fn tabs_context(&self, Parameters(args): Parameters<TabsContextArgs>) -> Result<CallToolResult, McpError> {
        let call = json!({ "createIfEmpty": args.create_if_empty.unwrap_or(false) });
        Ok(respond(self.call("tabs_context", call, CALL_WAIT).await))
    }

    #[tool(
        description = "Create a new empty tab in this session's tab group. Tabs you create are yours to clean up: close each with tabs_close when done, unless the user wants it kept."
    )]
    pub async fn tabs_create(&self) -> Result<CallToolResult, McpError> {
        Ok(respond(self.call("tabs_create", json!({}), CALL_WAIT).await))
    }

    #[tool(
        description = "Close a tab in this session's tab group by id. Only tabs in this session's group can be closed. If the group's last tab closes, Chrome removes the group and the next tabs_context with createIfEmpty starts fresh.",
        annotations(destructive_hint = true)
    )]
    pub async fn tabs_close(&self, Parameters(args): Parameters<TabsCloseArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.call("tabs_close", to_args(&args), CALL_WAIT).await))
    }

    #[tool(
        description = "Navigate a tab to a URL, or go back/forward in its history, and wait for the page to load (up to 30 s). tabId may be omitted for a URL when called on its own (not in browser_batch): the session's first tab is used and the tab context is returned with the result. A tab opened this way is yours to close when done."
    )]
    pub async fn navigate(&self, Parameters(args): Parameters<NavigateArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_navigate(args).await))
    }

    #[tool(
        description = "Get the page as an accessibility-style tree: roles, names and element refs (ref_N) that computer clicks, scroll_to and form_input accept. Returns all elements by default, including non-visible ones; filter \"interactive\" keeps only controls. Output is capped at 50000 characters (cut at a line boundary with the full size noted); pass max_chars, a smaller depth, or ref_id to focus.",
        annotations(read_only_hint = true)
    )]
    pub async fn read_page(&self, Parameters(args): Parameters<ReadPageArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.call("read_page", to_args(&args), CALL_WAIT).await))
    }

    #[tool(
        description = "Find elements by what they are or say, in plain words (\"search bar\", \"login button\", \"email field\"). Matches words against each element's role, name, placeholder and value, and returns up to 20 best matches with refs for other tools.",
        annotations(read_only_hint = true)
    )]
    pub async fn find(&self, Parameters(args): Parameters<FindArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.call("find", to_args(&args), CALL_WAIT).await))
    }

    #[tool(
        description = "Get the page's text as plain text, the article first when the page has one (navigation and footers left out). Best for reading articles and text-heavy pages.",
        annotations(read_only_hint = true)
    )]
    pub async fn get_page_text(&self, Parameters(args): Parameters<TabArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.call("get_page_text", to_args(&args), CALL_WAIT).await))
    }

    #[tool(
        description = "Read the tab's console messages (log, info, warn, error, debug, uncaught exceptions) since the current page loaded. Always pass a pattern (a regex) to filter; without one the output may be long.",
        annotations(read_only_hint = true)
    )]
    pub async fn read_console_messages(&self, Parameters(args): Parameters<ConsoleArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.call("read_console_messages", to_args(&args), CALL_WAIT).await))
    }

    #[tool(
        description = "Read the tab's network requests (documents, XHR, fetch, images and others) with method, status and time; no bodies. Requests clear when the tab's page moves to another domain. Filter with urlPattern.",
        annotations(read_only_hint = true)
    )]
    pub async fn read_network_requests(&self, Parameters(args): Parameters<NetworkArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.call("read_network_requests", to_args(&args), CALL_WAIT).await))
    }

    #[tool(
        description = "Set a form field's value directly by ref (from read_page or find): text inputs, textareas, selects (option value or text), checkboxes and radios (boolean). Instant, with the input and change events a page expects; computer typing is the human-paced alternative."
    )]
    pub async fn form_input(&self, Parameters(args): Parameters<FormInputArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_form_input(args).await))
    }

    #[tool(
        description = "Run JavaScript in the page's context and return the last expression's value (REPL semantics: top-level await works; write the expression, not return). Runs under DevTools rules, so page CSP does not block it. Errors come back as page_error."
    )]
    pub async fn javascript_tool(&self, Parameters(args): Parameters<JavascriptArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_javascript(args).await))
    }

    #[tool(
        description = "Put files into a file input by its ref, as choosing them in the picker would. Never click a file input (it opens a native picker you cannot see). Paths must be absolute; 10 MB per call in total."
    )]
    pub async fn file_upload(&self, Parameters(args): Parameters<FileUploadArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_file_upload(args).await))
    }

    #[tool(
        description = "Use a mouse and keyboard on the tab the way a person does, and take screenshots. Moves follow curved paths that slow into the target, clicks are held briefly, text is typed one key at a time with human gaps, and scrolling turns the wheel in notches, so actions take human time (batch predictable steps with browser_batch). Consult a screenshot or a ref before clicking; aim at the centre of elements. Coordinates are in the viewport frame the screenshot text reports. Screenshots return an imageId usable with upload_image for 5 minutes."
    )]
    pub async fn computer(&self, Parameters(args): Parameters<ComputerArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_computer(args).await))
    }

    #[tool(description = "Resize the browser window holding the tab to the given size in pixels, e.g. to test responsive layouts.")]
    pub async fn resize_window(&self, Parameters(args): Parameters<ResizeArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.call("resize_window", to_args(&args), CALL_WAIT).await))
    }

    #[tool(
        description = "Run several browser tool calls in order in ONE round trip; stops at the first error. Each item is {name, input} with input exactly as for that tool (tabId required). Use it whenever you can predict two or more steps, e.g. click a field, type, press Enter, screenshot. Coordinates in a batch refer to the screenshot taken before the batch. Cannot be nested."
    )]
    pub async fn browser_batch(&self, Parameters(args): Parameters<BatchArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_batch(args).await))
    }

    #[tool(
        description = "Upload a screenshot taken with computer screenshot or zoom (by its imageId, valid 5 minutes) to a file input (ref) or drop it on a drag-and-drop target (coordinate). Take the screenshot right before uploading; retry at most once with a fresh one. Cannot upload other files: use file_upload."
    )]
    pub async fn upload_image(&self, Parameters(args): Parameters<UploadImageArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_upload_image(args).await))
    }

    #[tool(
        description = "Record this session's browser actions as an animated GIF. start_recording takes a first frame, then a frame follows every action (clicks, typing, navigation, form fills); stop_recording keeps the frames; export writes the GIF with click circles, drag arrows, action labels and a progress bar to ~/Downloads/browser-hand/ and returns the path; clear drops the frames."
    )]
    pub async fn gif_creator(&self, Parameters(args): Parameters<GifArgs>) -> Result<CallToolResult, McpError> {
        Ok(respond(self.do_gif(args).await))
    }
}

#[tool_handler]
impl ServerHandler for Server {
    // Written by hand so the instructions can come from a file
    // (docs/external/rmcp.md § Server `instructions`).
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("browser-hand", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}

pub async fn main() -> anyhow::Result<()> {
    let server = Server::with_pace(profiles::chrome_dir(), crate::paths::socket_dir(), open_in_chrome(), pace_from_env());
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}

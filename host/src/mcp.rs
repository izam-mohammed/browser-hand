//! `browser-hand mcp`: the stdio MCP server. One process is one session; it
//! binds to one Chrome profile's host and forwards tool calls to it.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{schemars, tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::host_conn::{self, HostConn};
use crate::profiles::{self, LiveHost, Profile};
use crate::wire::{Content, Frame};

/// The extension's ID, fixed by the `key` in `extension/manifest.json`
/// (checked by `host/tests/mcp.rs`).
pub const EXTENSION_ID: &str = "ednpkicgdjiiihmophoifehfeeoabjdc";

const PROBE_WAIT: Duration = Duration::from_millis(800);
const CLAIM_WAIT: Duration = Duration::from_secs(10);
/// Chrome cold-starting and loading the profile takes longer.
const CLAIM_WAIT_COLD: Duration = Duration::from_secs(30);
const CALL_WAIT: Duration = Duration::from_secs(20);
const NAVIGATE_WAIT: Duration = Duration::from_secs(45);

const INSTRUCTIONS: &str = "browser-hand drives the user's own Chrome profiles. \
Call list_profiles first. If the user named a profile, select_profile it; if several are \
connected and the user did not say which, ask them, never pick one yourself. Then call \
tabs_context before other tab tools, and work in tabs you create. Close the tabs you \
created before finishing unless the user wants them kept.";

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

struct Bound {
    profile: Profile,
    conn: HostConn,
}

pub struct Inner {
    session: String,
    chrome_dir: PathBuf,
    socket_dir: PathBuf,
    launch: Launcher,
    bound: Mutex<Option<Bound>>,
}

#[derive(Clone)]
pub struct Server {
    inner: Arc<Inner>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SelectProfileArgs {
    /// The profile's name as list_profiles shows it, or its dir (e.g. "Profile 3").
    pub profile: String,
}

#[derive(Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabsContextArgs {
    /// Creates a new window with this session's tab group and one empty tab
    /// if the session has no group yet. No effect when a group exists.
    #[serde(default)]
    pub create_if_empty: Option<bool>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabsCloseArgs {
    /// The tab to close. Must be in this session's group; get ids from tabs_context.
    pub tab_id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavigateArgs {
    /// The URL to open, with or without protocol (defaults to https://), or
    /// "back" / "forward" to move in history.
    pub url: String,
    /// Tab to navigate. May be omitted for a URL: the session's first tab is
    /// used, creating the group if needed, and the tab context is returned.
    /// Required for "back" and "forward".
    #[serde(default)]
    pub tab_id: Option<i64>,
}

fn text_result(value: Value) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(value.to_string())])
}

fn error_result(message: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message.into())])
}

/// A result frame from the extension as an MCP tool result.
fn to_tool_result(frame: Frame) -> CallToolResult {
    match frame {
        Frame::Result { ok: true, content, .. } => CallToolResult::success(
            content
                .unwrap_or_default()
                .into_iter()
                .map(|c| match c {
                    Content::Text { text } => ContentBlock::text(text),
                    Content::Image { data, mime_type, .. } => ContentBlock::image(data, mime_type),
                })
                .collect(),
        ),
        Frame::Result { error: Some(e), .. } => {
            let code = serde_json::to_value(e.code).unwrap_or_default();
            error_result(format!("{}: {}", code.as_str().unwrap_or("error"), e.message))
        }
        other => error_result(format!("unexpected reply from the browser: {other:?}")),
    }
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

impl Server {
    pub fn new(chrome_dir: PathBuf, socket_dir: PathBuf, launch: Launcher) -> Self {
        Server {
            inner: Arc::new(Inner {
                session: uuid::Uuid::new_v4().to_string(),
                chrome_dir,
                socket_dir,
                launch,
                bound: Mutex::new(None),
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
        let conn = HostConn::connect(&host.path).await.map_err(|e| format!("could not connect to {}: {e}", profile.dir))?;
        *self.inner.bound.lock().await = Some(Bound { profile, conn });
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

    /// Forwards a tool call to the bound profile, binding the only connected
    /// profile when none is selected, and reconnecting once if the host
    /// restarted.
    async fn forward(&self, tool: &str, args: Value, wait: Duration) -> CallToolResult {
        let mut bound = self.inner.bound.lock().await;

        if bound.is_none() {
            let hosts = self.hosts().await;
            let claimed: Vec<&LiveHost> = hosts.iter().filter(|h| h.hello.profile_dir.is_some()).collect();
            let profiles = profiles::read_profiles(&self.inner.chrome_dir).unwrap_or_default();
            if claimed.len() == 1 {
                let dir = claimed[0].hello.profile_dir.clone().unwrap_or_default();
                let profile = profiles.into_iter().find(|p| p.dir == dir).unwrap_or(Profile { name: dir.clone(), dir, last_used: false });
                match HostConn::connect(&claimed[0].path).await {
                    Ok(conn) => *bound = Some(Bound { profile, conn }),
                    Err(e) => return error_result(format!("not_connected: {e}")),
                }
            } else {
                return error_result(
                    "No profile selected. Call list_profiles, then select_profile (ask the user which profile when several are connected).",
                );
            }
        }

        let b = bound.as_mut().expect("bound above");
        if !b.conn.is_alive() {
            let hosts = self.hosts().await;
            match Self::host_for(&hosts, &b.profile.dir) {
                Some(h) => match HostConn::connect(&h.path).await {
                    Ok(conn) => b.conn = conn,
                    Err(e) => return error_result(format!("not_connected: {e}")),
                },
                None => {
                    return error_result(format!(
                        "not_connected: the profile \"{}\" is no longer connected. Call select_profile again.",
                        b.profile.name
                    ))
                }
            }
        }

        match b.conn.call(&self.inner.session, tool, args, wait).await {
            Ok(frame) => to_tool_result(frame),
            Err(e) => to_tool_result(host_conn::call_error_frame(e, tool, wait)),
        }
    }
}

#[tool_router]
impl Server {
    #[tool(
        description = "List the Chrome profiles on this computer: dir, name, whether Chrome last used it, and whether the browser-hand extension in it is connected right now. A profile that is not open or not connected can still be selected: select_profile opens it. Call this before select_profile.",
        annotations(read_only_hint = true)
    )]
    pub async fn list_profiles(&self) -> Result<CallToolResult, McpError> {
        let profiles = match profiles::read_profiles(&self.inner.chrome_dir) {
            Ok(p) => p,
            Err(e) => return Ok(error_result(format!("Could not read Chrome's profiles: {e:#}"))),
        };
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
        Ok(text_result(json!({ "profiles": list, "unclaimedConnections": unclaimed })))
    }

    #[tool(
        description = "Select the Chrome profile this session acts in, by name or dir from list_profiles. If the profile is not open, it is opened with Chrome's command line (starting Chrome if it is not running), and a short-lived page connects its extension. Never choose a profile on the user's behalf when several are connected and they did not say which: ask them."
    )]
    pub async fn select_profile(&self, Parameters(args): Parameters<SelectProfileArgs>) -> Result<CallToolResult, McpError> {
        let profiles = match profiles::read_profiles(&self.inner.chrome_dir) {
            Ok(p) => p,
            Err(e) => return Ok(error_result(format!("Could not read Chrome's profiles: {e:#}"))),
        };
        let Some(profile) = profiles::resolve(&profiles, &args.profile).cloned() else {
            let names: Vec<String> = profiles.iter().map(|p| format!("{} ({})", p.name, p.dir)).collect();
            return Ok(error_result(format!("No profile \"{}\". Profiles: {}", args.profile, names.join(", "))));
        };

        let hosts = self.hosts().await;
        let host = match Self::host_for(&hosts, &profile.dir) {
            Some(h) => h.clone(),
            None => match self.claim(&profile).await {
                Ok(h) => h,
                Err(e) => return Ok(error_result(e)),
            },
        };
        if let Err(e) = self.bind(profile.clone(), &host).await {
            return Ok(error_result(e));
        }
        Ok(text_result(json!({ "selected": { "dir": profile.dir, "name": profile.name }, "extensionVersion": host.hello.extension_version })))
    }

    #[tool(
        description = "Get this session's tab group in the selected profile: every tab id, title and URL. Call this at least once before other tab tools. Each session works in its own browser-hand tab group; work in new tabs (tabs_create) unless the user asks to use an existing one.",
        annotations(read_only_hint = true)
    )]
    pub async fn tabs_context(&self, Parameters(args): Parameters<TabsContextArgs>) -> Result<CallToolResult, McpError> {
        Ok(self.forward("tabs_context", json!({ "createIfEmpty": args.create_if_empty.unwrap_or(false) }), CALL_WAIT).await)
    }

    #[tool(
        description = "Create a new empty tab in this session's tab group. Tabs you create are yours to clean up: close each with tabs_close when done, unless the user wants it kept."
    )]
    pub async fn tabs_create(&self) -> Result<CallToolResult, McpError> {
        Ok(self.forward("tabs_create", json!({}), CALL_WAIT).await)
    }

    #[tool(
        description = "Close a tab in this session's tab group by id. Only tabs in this session's group can be closed. If the group's last tab closes, Chrome removes the group and the next tabs_context with createIfEmpty starts fresh.",
        annotations(destructive_hint = true)
    )]
    pub async fn tabs_close(&self, Parameters(args): Parameters<TabsCloseArgs>) -> Result<CallToolResult, McpError> {
        Ok(self.forward("tabs_close", json!({ "tabId": args.tab_id }), CALL_WAIT).await)
    }

    #[tool(
        description = "Navigate a tab to a URL, or go back/forward in its history, and wait for the page to load (up to 30 s). tabId may be omitted for a URL: the session's first tab is used and the tab context is returned with the result. A tab opened this way is yours to close when done."
    )]
    pub async fn navigate(&self, Parameters(args): Parameters<NavigateArgs>) -> Result<CallToolResult, McpError> {
        let mut call = json!({ "url": args.url });
        if let Some(id) = args.tab_id {
            call["tabId"] = json!(id);
        }
        Ok(self.forward("navigate", call, NAVIGATE_WAIT).await)
    }
}

#[tool_handler]
impl ServerHandler for Server {
    // Written by hand so the instructions can be a const
    // (docs/external/rmcp.md § Server `instructions`).
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("browser-hand", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}

pub async fn main() -> anyhow::Result<()> {
    let server = Server::new(profiles::chrome_dir(), crate::paths::socket_dir(), open_in_chrome());
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}

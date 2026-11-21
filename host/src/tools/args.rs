//! Tool inputs, matching Claude in Chrome's schemas
//! (`reference/claude-in-chrome/tools/`) so habits carry over. They are
//! forwarded to the extension as the same JSON.

use rmcp::schemars;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Reads `v` as `T`, or says how to respell it when it is JSON text
/// (plans/13-chrome-parity.md, decision 3). The text is never parsed into
/// the value: a mis-read string could click somewhere.
fn typed<T: serde::de::DeserializeOwned, E: serde::de::Error>(
    v: Value,
    field: &str,
    shape: &str,
) -> Result<T, E> {
    if let Value::String(s) = &v {
        let looks_json = matches!(
            serde_json::from_str::<Value>(s),
            Ok(Value::Array(_) | Value::Object(_))
        );
        return Err(E::custom(if looks_json {
            format!("{field} was sent as text ({s}); send it as {shape} itself, not as text, with no quotes around it")
        } else {
            format!("{field} was sent as text ({s}); it must be {shape}, not as text")
        }));
    }
    serde_json::from_value(v).map_err(|e| E::custom(format!("{field}: {e}; send {shape}")))
}

/// A `deserialize_with` function for an optional field of `T` that names
/// the field and its shape when the value arrives as text.
macro_rules! guarded {
    (opt $name:ident, $field:literal, $shape:literal) => {
        fn $name<'de, D: serde::Deserializer<'de>, T: serde::de::DeserializeOwned>(
            d: D,
        ) -> Result<Option<T>, D::Error> {
            match Value::deserialize(d)? {
                Value::Null => Ok(None),
                v => typed(v, $field, $shape).map(Some),
            }
        }
    };
    (req $name:ident, $field:literal, $shape:literal) => {
        fn $name<'de, D: serde::Deserializer<'de>, T: serde::de::DeserializeOwned>(
            d: D,
        ) -> Result<T, D::Error> {
            typed(Value::deserialize(d)?, $field, $shape)
        }
    };
}

guarded!(opt coordinate_json, "coordinate", "an array like [300, 200]");
guarded!(opt start_coordinate_json, "start_coordinate", "an array like [300, 200]");
guarded!(opt region_json, "region", "an array like [x0, y0, x1, y1]");
guarded!(opt values_json, "values", "an object like {\"4\": \"new text\"}");
guarded!(req paths_json, "paths", "an array like [\"/path/a.png\"]");
guarded!(req actions_json, "actions", "an array of {name, input} objects");

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct SelectProfileArgs {
    /// The profile's name as list_profiles shows it, or its dir (e.g. "Profile 3").
    pub profile: String,
}

#[derive(Debug, Default, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabsContextArgs {
    /// Creates a new window with this session's tab group and one empty tab
    /// if the session has no group yet. No effect when a group exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub create_if_empty: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabsCloseArgs {
    /// The tab to close. Must be in this session's group; get ids from tabs_context.
    pub tab_id: i64,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavigateArgs {
    /// The URL to open, with or without protocol (defaults to https://), or
    /// "back" / "forward" to move in history.
    pub url: String,
    /// Tab to navigate. May be omitted for a URL: the session's first tab is
    /// used, creating the group if needed, and the tab context is returned.
    /// Required for "back" and "forward".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReadFilter {
    Interactive,
    All,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct ReadPageArgs {
    /// Tab to read from. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    /// "interactive" for buttons, links and inputs only; "all" (default) for every element.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<ReadFilter>,
    /// Maximum depth of the tree (default 15). Use less if the output is too large.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<u32>,
    /// Reference ID of a parent element to read, with its children, to focus on part of the page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<String>,
    /// Maximum characters of output (default 50000); longer output is cut at a line boundary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct FindArgs {
    /// What to find, in plain words: "search bar", "add to cart button", "email field".
    pub query: String,
    /// Tab to search in. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct WaitForArgs {
    /// Tab to watch. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    /// Text the page must show, matched without regard to case.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// An element ref (from read_page or find) that must be on the page.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "ref")]
    pub element_ref: Option<String>,
    /// A substring the tab's URL must hold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_contains: Option<String>,
    /// Wait for it to disappear instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gone: Option<bool>,
    /// Seconds to wait, 1 to 60. Default 15.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_s: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct TabArgs {
    /// Tab to read. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct ConsoleArgs {
    /// Tab to read console messages from. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    /// Regex to filter messages, e.g. "error|warning" or "MyApp". Always pass one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    /// Only errors and uncaught exceptions.
    #[serde(
        default,
        rename = "onlyErrors",
        skip_serializing_if = "Option::is_none"
    )]
    pub only_errors: Option<bool>,
    /// Maximum messages to return (default 100).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Clear the messages after reading, to avoid duplicates next time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clear: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct NetworkArgs {
    /// Tab to read requests from. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    /// Only requests whose URL contains this text, e.g. "/api/".
    #[serde(
        default,
        rename = "urlPattern",
        skip_serializing_if = "Option::is_none"
    )]
    pub url_pattern: Option<String>,
    /// Maximum requests to return (default 100).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Clear the requests after reading.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clear: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct FormInputArgs {
    /// Element reference from read_page or find, e.g. "ref_k3x9_4".
    #[serde(rename = "ref")]
    pub reference: String,
    /// The value: a boolean for checkboxes, an option's value or text for selects, text otherwise.
    pub value: Value,
    /// Tab holding the form. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    /// A few words on what this sets, e.g. "Sets the delivery date to 29 September". The effect only; no secrets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_summary: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct JavascriptArgs {
    /// Must be "javascript_exec".
    pub action: String,
    /// JavaScript evaluated in the page with REPL semantics: top-level await works and the
    /// last expression's value is returned; write the expression, not `return`.
    pub text: String,
    /// Tab to run it in. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct FileUploadArgs {
    /// Absolute paths of the files to upload; under 10 MB together.
    #[serde(deserialize_with = "paths_json")]
    pub paths: Vec<String>,
    /// Reference of the file input from read_page or find. Never click a file input.
    #[serde(rename = "ref")]
    pub reference: String,
    /// Tab holding the input. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ComputerAction {
    LeftClick,
    RightClick,
    DoubleClick,
    TripleClick,
    Type,
    Screenshot,
    Wait,
    Scroll,
    Key,
    LeftClickDrag,
    Zoom,
    ScrollTo,
    Hover,
}

impl ComputerAction {
    /// Actions that change the page (and earn a GIF frame).
    pub fn acts(self) -> bool {
        !matches!(
            self,
            ComputerAction::Screenshot | ComputerAction::Zoom | ComputerAction::Wait
        )
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ScrollDirection {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct ComputerArgs {
    /// left_click, right_click, double_click, triple_click: click at coordinate or ref.
    /// type: type text, one key at a time. screenshot: capture the tab. wait: pause up to 10 s.
    /// scroll: wheel at coordinate in scroll_direction. key: press keys ("Enter", "cmd+a",
    /// "Backspace Backspace"). left_click_drag: drag from start_coordinate to coordinate.
    /// zoom: capture region closer. scroll_to: bring ref into view. hover: move without clicking.
    pub action: ComputerAction,
    /// Tab to act on. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    /// (x, y) in the viewport's pixels, as read off the latest screenshot (divide image pixels
    /// by the scale it reports). Required for clicks without ref, scroll and the drag's end.
    #[serde(
        default,
        deserialize_with = "coordinate_json",
        skip_serializing_if = "Option::is_none"
    )]
    pub coordinate: Option<[f64; 2]>,
    /// (x, y) where left_click_drag starts.
    #[serde(
        default,
        deserialize_with = "start_coordinate_json",
        skip_serializing_if = "Option::is_none"
    )]
    pub start_coordinate: Option<[f64; 2]>,
    /// Element reference from read_page or find; for clicks, hover and scroll_to, instead of coordinate.
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Text to type (type), or space-separated keys to press (key), e.g. "cmd+a" on Mac.
    /// Page zoom shortcuts are refused; use zoom.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Seconds to wait, 0 to 10 (wait).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// Direction for scroll.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll_direction: Option<ScrollDirection>,
    /// Wheel notches for scroll, 1 to 10 (default 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll_amount: Option<u32>,
    /// Modifier keys held during a click or drag: "ctrl", "shift", "alt", "cmd", combined with "+".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modifiers: Option<String>,
    /// Times to repeat the key sequence (key), 1 to 100.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat: Option<u32>,
    /// (x0, y0, x1, y1) viewport rectangle to capture for zoom.
    #[serde(
        default,
        deserialize_with = "region_json",
        skip_serializing_if = "Option::is_none"
    )]
    pub region: Option<[f64; 4]>,
    /// Shrinks the returned image for screenshot and zoom, 0.1 to 1. Coordinates stay in the viewport frame.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    /// For screenshot and zoom: also save the image under ~/Downloads/browser-hand and return the path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save_to_disk: Option<bool>,
    /// A few words on what this action does, e.g. "Opens the Filters menu". Set it on every
    /// click, drag, key and type. The effect only; no reasons, no secrets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_summary: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct ResizeArgs {
    /// Window width in pixels.
    pub width: f64,
    /// Window height in pixels.
    pub height: f64,
    /// A tab in the window to resize. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct UploadImageArgs {
    /// Id of a screenshot taken with computer screenshot or zoom in the last 5 minutes.
    #[serde(rename = "imageId")]
    pub image_id: String,
    /// Tab to upload into. Must be in this session's group.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    /// Reference of a file input (works for hidden inputs). Give ref or coordinate, not both.
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Viewport (x, y) to drop the image on, for drag-and-drop targets.
    #[serde(
        default,
        deserialize_with = "coordinate_json",
        skip_serializing_if = "Option::is_none"
    )]
    pub coordinate: Option<[f64; 2]>,
    /// File name for the upload (default "image.png").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct BatchItem {
    /// Tool name, e.g. "computer", "navigate", "find". browser_batch cannot be nested.
    pub name: String,
    /// That tool's input, exactly as when calling it directly (tabId required).
    pub input: Value,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct BatchArgs {
    /// Tool calls to run in order; the batch stops at the first error.
    #[serde(deserialize_with = "actions_json")]
    pub actions: Vec<BatchItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum GifAction {
    StartRecording,
    StopRecording,
    Export,
    Clear,
}

#[derive(Debug, Default, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GifOptions {
    /// Orange circles where clicks landed (default true).
    #[serde(default)]
    pub show_click_indicators: Option<bool>,
    /// Red arrows for drags (default true).
    #[serde(default)]
    pub show_drag_paths: Option<bool>,
    /// Black labels describing each action (default true).
    #[serde(default)]
    pub show_action_labels: Option<bool>,
    /// Orange progress bar along the bottom (default true).
    #[serde(default)]
    pub show_progress_bar: Option<bool>,
    /// Accepted for compatibility; there is no watermark.
    #[serde(default)]
    pub show_watermark: Option<bool>,
    /// 1 to 30, lower is better quality and slower (default 10).
    #[serde(default)]
    pub quality: Option<i32>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct GifArgs {
    /// start_recording (begin capturing; a first frame is taken), stop_recording (keep frames),
    /// export (write the GIF), clear (drop frames).
    pub action: GifAction,
    /// A tab in this session's group; frames are taken from the tab each action acts on.
    #[serde(rename = "tabId")]
    pub tab_id: i64,
    /// For export: accepted for compatibility; the GIF is always written to ~/Downloads/browser-hand/.
    #[serde(default)]
    pub download: Option<bool>,
    /// For export: file name (default recording-<time>.gif).
    #[serde(default)]
    pub filename: Option<String>,
    /// For export: overlay options.
    #[serde(default)]
    pub options: Option<GifOptions>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RecordingFormat {
    Text,
    Devtools,
}

#[derive(Debug, Default, Deserialize, Serialize, schemars::JsonSchema)]
pub struct RecordingGetArgs {
    /// The recording's id from recording_list; the newest when left out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// "text" (default): one line per step. "devtools": the Chrome DevTools Recorder UserFlow JSON
    /// alone, which DevTools' Recorder panel can import.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<RecordingFormat>,
    /// Also show the steps Claude's own actions made during the recording (hidden by default).
    #[serde(
        default,
        rename = "includeClaude",
        skip_serializing_if = "Option::is_none"
    )]
    pub include_claude: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
pub struct RecordingDeleteArgs {
    /// The recording's id from recording_list.
    pub id: String,
}

#[derive(Debug, Default, Deserialize, Serialize, schemars::JsonSchema)]
pub struct RecordingReplayArgs {
    /// The recording's id from recording_list; the newest when left out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Step number to start at, as recording_get numbers them (default 1). Use it to resume
    /// after the step that stopped a replay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<u32>,
    /// New values for change steps, by step number: {"4": "new search words"}. Masked steps
    /// (passwords, card numbers) need one, or the replay stops there.
    #[serde(
        default,
        deserialize_with = "values_json",
        skip_serializing_if = "Option::is_none"
    )]
    pub values: Option<std::collections::BTreeMap<String, String>>,
    /// Tab to replay in. Must be in this session's group; a new tab is created when left out.
    #[serde(default, rename = "tabId", skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<i64>,
}

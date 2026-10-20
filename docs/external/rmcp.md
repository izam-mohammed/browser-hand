# rmcp

Fetched: 17/10/2026 from https://crates.io/crates/rmcp/3.5.1, https://docs.rs/rmcp, https://docs.rs/rmcp-macros, https://github.com/modelcontextprotocol/rust-sdk (README.md on `main`), and the published crate sources `rmcp-3.5.1` / `rmcp-macros-3.5.1` (README.md, CHANGELOG.md, `src/`) as downloaded by `cargo info`.
Version: rmcp 3.5.1 (released 05/10/2026), rmcp-macros 3.5.1, MSRV 1.88, licence Apache-2.0. `cargo search rmcp --limit 3` on 17/10/2026 returned `rmcp = "3.5.1"`.
Version: MCP protocol, `ProtocolVersion::LATEST` = `2026-07-28`; `ProtocolVersion::LATEST_WITH_INITIALIZE` = `2025-11-25`.

The official Rust SDK for MCP. Repository README: "This SDK implements the stable MCP **`2026-07-28`** specification while remaining fully compatible with the **`2025-11-25`** release and earlier versions."

## What this project uses

### Cargo features for a stdio server

From `cargo info rmcp` (3.5.1):

```
+default            = [base64, macros, server]
 server             = [transport-async-rw, schemars, dep:pastey, uuid]
 transport-io       = [transport-async-rw, tokio/io-std]
 macros             = [dep:rmcp-macros, dep:pastey]
 base64             = [dep:base64]
```

Crate README feature table: `transport-io` is "Server-side stdio transport". The default set does **not** include `transport-io`, so `rmcp::transport::stdio` is unavailable without it. Minimal dependency line for this project:

```toml
rmcp = { version = "3.5.1", features = ["server", "macros", "transport-io"] }
```

`schemars` comes in through `server`, and the README imports it as `rmcp::schemars`. Tokio and serde are listed as "Basic dependencies".

### stdio transport

Source (`src/transport/io.rs`):

```rust
/// Create a pair of [`tokio::io::Stdin`] and [`tokio::io::Stdout`].
pub fn stdio() -> (tokio::io::Stdin, tokio::io::Stdout)
```

Repository README, Transports > stdio:

```rust
use rmcp::{ServiceExt, transport::stdio};

// Server: serve over stdin/stdout.
let server = MyServer.serve(stdio()).await?;
server.waiting().await?;
```

### Macros: `#[tool_router]`, `#[tool]`, `#[tool_handler]`

From `rmcp-macros` docs (`src/lib.rs`):

- `#[tool]` fields: `name` ("defaults to the function name"), `description` ("The document of this function will be used if not provided"), `input_schema` ("If not provide, if will use the json schema of its argument with type `Parameters<T>`"), `annotations` (`ToolAnnotationsAttribute`, default `None`). Also accepted in source: `output_schema`, `meta`.
- `#[tool_router]` fields: `router` (default `tool_router`), `vis`, `server_handler` (flag: "also emits `#[::rmcp::tool_handler]` on `impl ServerHandler for Self`"), `allow_empty` (flag: "Without it, an empty router is a compile error").
- `#[tool_handler]` "generates the `call_tool`, `list_tools`, `get_tool`, and (optionally) `get_info` methods". Fields: `router` (default `Self::tool_router()`), `meta`, `name` (default `CARGO_CRATE_NAME`), `version` (default `CARGO_PKG_VERSION`), `instructions` ("Optional human-readable instructions about using this server"). "If you provide your own `get_info()`, the macro will not generate one."

Annotation keys accepted by `annotations(...)` (from `rmcp-macros` `src/tool.rs`): `title`, `read_only_hint`, `destructive_hint`, `idempotent_hint`, `open_world_hint`. Doc example:

```rust
#[tool(name = "my_tool", description = "This is my tool", annotations(title = "我的工具", read_only_hint = true))]
pub async fn my_tool(param: Parameters<MyToolParam>) {
    // handling tool request
}
```

Minimal example copied from the repository README (Tools > Server-side), tools plus custom server metadata:

```rust
use rmcp::{handler::server::wrapper::Parameters, schemars, tool, tool_router, tool_handler, ServerHandler, ServiceExt};

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct AddParams {
    a: i32,
    b: i32,
}

#[derive(Clone)]
struct Calculator;

#[tool_router]
impl Calculator {
    #[tool(description = "Add two numbers")]
    fn add(&self, Parameters(AddParams { a, b }): Parameters<AddParams>) -> String {
        (a + b).to_string()
    }
}

#[tool_handler(name = "calculator", version = "1.0.0", instructions = "A simple calculator")]
impl ServerHandler for Calculator {}
```

Tools-only shortcut (same README): `#[tool_router(server_handler)]` on the inherent impl, then `Calculator.serve(stdio()).await?` and `service.waiting().await?` in `#[tokio::main]`.

README: "The generated tool `inputSchema` and `outputSchema` are derived from the fields of `T`. The type name and documentation on `T` are ignored; only field names, field types, and field documentation are used."

### What a `#[tool]` fn may return

Source (`src/handler/server/tool.rs`): `IntoCallToolResult` is implemented for any `T: IntoContents` (`ContentBlock`, `String`, `()`), `CallToolResult`, `InputRequiredResult`, `CallToolResponse`, `ErrorData`, `Json<T>`, and `Result<T, E>` where both sides implement it. For `Result<T, E>`, an `Err` that converts to a complete result has `is_error` forced to `Some(true)`; an `Err(ErrorData)` becomes a JSON-RPC protocol error.

### Returning text and image content

`ContentBlock` (`src/model/content.rs`, spec `ContentBlock`, serde tag `type`, snake_case): variants `Text`, `Image`, `Audio`, `Resource`, `ResourceLink`.

```rust
pub fn text(text: impl Into<String>) -> Self
pub fn image(data: impl Into<String>, mime_type: impl Into<String>) -> Self
pub fn json<S: Serialize>(json: S) -> Result<Self, crate::ErrorData>
```

`ImageContent` fields: `data: String` ("The base64-encoded image data"), `mime_type: String` (serialised `mimeType`, "e.g. `image/png`"), `meta: Option<MetaObject>` (`_meta`), `annotations: Option<Annotations>`. The SDK does not encode for you in `ContentBlock::image`: you pass a base64 string. (Only `PromptMessage::new_image` is documented as "raw bytes are base64-encoded for you", and that is for prompts, not tool results.)

`CallToolResult` (`src/model.rs`) fields: `result_type: Option<ResultType>`, `content: Vec<ContentBlock>`, `structured_content: Option<Value>`, `is_error: Option<bool>`, `meta: Option<MetaObject>`. Constructors:

```rust
pub fn success(content: Vec<ContentBlock>) -> Self
pub fn error(content: Vec<ContentBlock>) -> Self
pub fn structured(value: Value) -> Self
pub fn structured_error(value: Value) -> Self
pub fn with_meta(mut self, meta: Option<MetaObject>) -> Self
```

Example from the repository README ("Tool result content types"), trimmed to text and image:

```rust
use rmcp::model::{CallToolResult, ContentBlock, ResourceContents};

#[tool(description = "Render a chart")]
async fn chart(&self) -> Result<CallToolResult, McpError> {
    let png_base64 = render_png(); // base64-encoded image bytes

    Ok(CallToolResult::success(vec![
        // Text
        ContentBlock::text("Here is your chart:"),
        ContentBlock::image(png_base64, "image/png"),
    ]))
}
```

README: "Image and audio data are base64 strings with a MIME type."

Note on naming: the README and 3.x source use `ContentBlock`. Older tutorials use `Content::text` / `Content::image`; a `Content` alias was not found in the 3.5.1 sources (grep for `Content =` in `src/model*` returned nothing). Treat `Content::image` as pre-3.x API.

### Server `instructions`

Through the macro: `#[tool_handler(instructions = "...")]` (see above).

By hand, `ServerHandler::get_info` returns `ServerConfig`, which is `pub type ServerConfig = InitializeResult;`. `InitializeResult` fields: `protocol_version`, `capabilities`, `server_info: Implementation`, `instructions: Option<String>` ("Optional human-readable instructions about using this server"), `meta`. Doc example:

```rust
use rmcp::model::{ServerCapabilities, ServerConfig};

let config = ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    .with_instructions("Call `add` to sum two numbers.");
assert!(config.capabilities.tools.is_some());
```

Other builders on `InitializeResult`: `with_server_info(Implementation)`, `with_protocol_version(ProtocolVersion)`. `Implementation::new(name, version)`. For `2026-07-28` clients the same config is also turned into a `server/discover` result: `DiscoverResult::from_server_info(supported_versions, server_config)` copies `instructions` across.

`ServerInfo` is deprecated: `#[deprecated(note = "use `ServerConfig` instead")] pub type ServerInfo = InitializeResult;` (changelog 3.4.0, 15/09/2026).

### List-changed notification

README: `context.peer.notify_tool_list_changed().await?;`. Capability builder: `.enable_tool_list_changed()`. On `2026-07-28` the client must open `subscriptions/listen`; the README shows a `listen(&self, context: SubscriptionContext)` handler that calls `context.sink().notify_tool_list_changed()`.

### Protocol versions spoken

`ProtocolVersion::KNOWN_VERSIONS` = `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`, `2026-07-28`. Doc on `LATEST_WITH_INITIALIZE`: "The newest protocol version that still has an `initialize` handshake." From `2026-07-28` "the lifecycle moved into per-request `_meta`". A dual-era server built with rmcp answers both `initialize` (legacy) and `server/discover` (modern).

## Errors

- `rmcp::ErrorData` (re-export of `rmcp::model::ErrorData`), implements `Display` and `std::error::Error`. Constructors: `invalid_params(message, data: Option<Value>)`, `internal_error(message, data)`, `resource_not_found(message, data)`, `method_not_found::<M>()`. README aliases it as `use rmcp::ErrorData as McpError;`.
- `ErrorCode` constants: `PARSE_ERROR -32700`, `INVALID_REQUEST -32600`, `METHOD_NOT_FOUND -32601`, `INVALID_PARAMS -32602`, `INTERNAL_ERROR -32603`, `RESOURCE_NOT_FOUND -32002`, `HEADER_MISMATCH -32020`, `MISSING_REQUIRED_CLIENT_CAPABILITY -32021`, `UNSUPPORTED_PROTOCOL_VERSION -32022`.
- Tool-level vs protocol errors (doc on `CallToolResult::error`): use `Ok(CallToolResult::error(...))` when "the tool ran and didn't work"; use `Err(ErrorData)` when "the server cannot route the request at all". "MCP clients typically render protocol errors opaquely ... the caller does **not** see your message."
- `rmcp::RmcpError` (non-exhaustive): `Service(ServiceError)`, `ClientInitialize`, `ServerInitialize(ServerInitializeError)`, `Runtime(JoinError)`, `TransportCreation { .. }`, `TaskError(String)`.
- `ServerInitializeError`: `ExpectedInitializeRequest`, `ConnectionClosed(String)`, `UnexpectedInitializeResponse`, `InitializeFailed(ErrorData)`, `TransportError { error, context }`, `Cancelled`. This is what `.serve(stdio()).await` returns on handshake failure.

## Limits

- Tool names: `tool_name_validation.rs` warns (via `tracing::warn!`) when a name is outside 1 to 128 characters or uses characters other than `A-Z a-z 0-9 _ - .`. It is a warning, not a hard error.
- Payload size limits for stdio: not stated.
- Concurrency limits for tool calls over stdio: not stated.

## Gotchas

- API churn is high. Major versions: 1.0.0 on 03/03/2026, 2.0.0 on 27/06/2026, 3.0.0 on 28/07/2026, then 3.1 to 3.5 by 05/10/2026. 3.0 removed deprecated APIs and changed models for spec `2026-07-28`; the README points to a "migration guide" (GitHub discussion #969). Pin an exact minor version and expect breaking changes at the next major.
- Recent macro changes in 3.x minors: 3.3.0 "reject empty tool_router" (compile error unless `allow_empty`), 3.4.1 "accept const paths and concat! in tool/prompt descriptions", 3.1.1 "emit cache hints from handler macros". The three core macros themselves have kept the same names and attribute shape across these releases.
- `transport-io` is not a default feature; `cargo add rmcp --features server` alone does not give you `stdio()`.
- A `macro_rules!` helper inside a `#[tool_router]` impl is invisible to the macro ("An attribute macro receives the unexpanded item").
- `ContentBlock::image` expects base64 text, not raw bytes.
- Logging via MCP (`notify_logging_message`) is deprecated by SEP-2577; spec guidance is to log to `stderr` on stdio.
- `CallToolResult` has `result_type`; "the server handler clears the field when responding to peers that negotiated an older version". No action needed, but do not set it by hand.

## Alternatives (factual comparison)

| Crate | Version (crates.io, 17/10/2026) | Last release | Repo | Protocol | Notes |
| - | - | - | - | - | - |
| `rmcp` | 3.5.1 | 05/10/2026 | github.com/modelcontextprotocol/rust-sdk (official MCP org) | `2026-07-28` plus legacy down to `2024-11-05` | Dual-era. About 36.9 million total downloads per crates.io API. |
| `rust-mcp-sdk` | 2.0.0 | 27/08/2026 | github.com/rust-mcp-stack/rust-mcp-sdk (community, not the MCP org) | 2.x: "MCP 2026-07-28 (stateless) - no initialize, no sessions"; 1.x (LTS, branch `release-1.x`): `2025-11-25` | Defaults include client, server, auth, macros, stdio, sse, streamable-http. README claims "100% of official MCP conformance tests". About 315 thousand downloads. |

Not verified: whether `rust-mcp-sdk` 2.x accepts a legacy `initialize` from a client that does not probe with `server/discover`; its README says "no initialize", which suggests not.

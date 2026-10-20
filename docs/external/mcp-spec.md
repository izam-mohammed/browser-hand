# MCP specification

Fetched: 17/10/2026 from https://modelcontextprotocol.io/specification/latest (HTTP 307 to `/specification/2026-07-28`), and the source files behind it in https://github.com/modelcontextprotocol/modelcontextprotocol (`docs/specification/2026-07-28/{changelog,basic/transports/stdio,basic/versioning,basic/index,server/discover,server/tools}.mdx`, `schema/2026-07-28/schema.ts`), plus `docs/specification/2025-11-25/{basic/transports,basic/lifecycle,server/tools}.mdx` and `schema/2025-11-25/schema.ts` for the legacy era.
Version: `2026-07-28` (latest). Previous: `2025-11-25` (newest version with an `initialize` handshake).

Why both matter here: Claude Code's v1 MCP runtime speaks the legacy (`initialize`) era, its v2 runtime "adds MCP protocol revision 2026-07-28" (see `claude-code-mcp-and-skills.md`). `rmcp` 3.5.1 serves both. Design for both eras.

## What this project uses

### Era change in 2026-07-28 (changelog, quoted)

- "Make MCP stateless: remove the `initialize`/`notifications/initialized` handshake. Every request now carries its protocol version and client capabilities in `_meta` (`io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities`)."
- "Add `server/discover`: servers MUST implement this RPC to advertise their supported protocol versions, capabilities, and identity."
- "All results now carry a required `resultType` field: `"complete"` for ordinary results and `"input_required"` for multi round-trip request interim results."
- "Servers **SHOULD** return tools from `tools/list` in a deterministic order".
- Deprecated (SEP-2577): Roots, Sampling, Logging. Suggested migration: "log to `stderr` (stdio) or use OpenTelemetry instead of Logging."

### stdio transport (2026-07-28, `basic/transports/stdio`)

- "The server reads JSON-RPC messages from `stdin` and writes JSON-RPC messages to `stdout`."
- "Each message is a single JSON-RPC request, notification, or response."
- "Messages are delimited by newlines, and **MUST NOT** contain embedded newlines."
- "The server **MAY** write UTF-8 strings to `stderr` for any logging purposes including informational, debug, and error messages."
- "The server **MUST NOT** write anything to its `stdout` that is not a valid MCP message."
- "The server **MUST NOT** write JSON-RPC _requests_ to `stdout`." (Server-to-client requests are replaced by `InputRequiredResult`.)
- Shutdown: "Servers **SHOULD** exit promptly when their standard input is closed or reads return end-of-file. This is the primary graceful-shutdown signal and the only portable one".
- Unexpected termination: "If the server process exits unexpectedly, the client **SHOULD** restart it."
- Framing reuse: "The wire format (one newline-delimited JSON-RPC message per line over a reliable bidirectional byte stream) works unchanged over Unix domain sockets, TCP connections, or any similar channel."

The `2025-11-25` stdio rules are the same on framing, `stderr` and `stdout` purity.

### Request `_meta` (2026-07-28, `basic/index`)

| Key | Required | Meaning |
| - | - | - |
| `io.modelcontextprotocol/protocolVersion` | Yes | Protocol version for this request |
| `io.modelcontextprotocol/clientInfo` | No | Client name and version |
| `io.modelcontextprotocol/clientCapabilities` | Yes | Client capabilities relevant to this request |
| `io.modelcontextprotocol/logLevel` | No | Minimum log level |

Servers SHOULD put `io.modelcontextprotocol/serverInfo` in each result's `_meta`.

### server/discover and `instructions`

2026-07-28 response example (`server/discover.mdx`):

```json
{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "result": {
    "resultType": "complete",
    "supportedVersions": ["2026-07-28"],
    "capabilities": {
      "tools": {},
      "resources": {}
    },
    "_meta": {
      "io.modelcontextprotocol/serverInfo": {
        "name": "ExampleServer",
        "version": "1.0.0"
      }
    },
    "instructions": "This server provides weather and resource utilities.",
    "ttlMs": 3600000,
    "cacheScope": "public"
  }
}
```

`DiscoverResult.instructions` (schema.ts 2026-07-28): "Natural-language guidance describing the server and its features. This can be used by clients to improve an LLM's understanding of available tools (e.g., by including it in a system prompt). It should focus on information that helps the model use the server effectively and should not duplicate information already in tool descriptions."

Legacy `InitializeResult.instructions` (schema.ts 2025-11-25): "Instructions describing how to use the server and its features. This can be used by clients to improve the LLM's understanding of available tools, resources, etc. It can be thought of like a "hint" to the model. For example, this information MAY be added to the system prompt."

### tools/list

Capability: `{ "capabilities": { "tools": { "listChanged": true } } }`. Example response (2026-07-28):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resultType": "complete",
    "tools": [
      {
        "name": "get_weather",
        "title": "Weather Information Provider",
        "description": "Get current weather information for a location",
        "inputSchema": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City name or zip code"
            }
          },
          "required": ["location"]
        }
      }
    ],
    "nextCursor": "next-page-cursor",
    "ttlMs": 300000,
    "cacheScope": "public"
  }
}
```

(`icons` omitted from the original example.) `ttlMs` and `cacheScope` are required on `tools/list` results in 2026-07-28 (changelog minor change 5). `inputSchema` "**MUST** be a valid JSON Schema object (not `null`)"; for no parameters, `{ "type": "object", "additionalProperties": false }` is "**Recommended**".

### tools/call

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "location": "New York"
    }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "resultType": "complete",
    "content": [
      {
        "type": "text",
        "text": "Current weather in New York:\nTemperature: 72°F\nConditions: Partly cloudy"
      }
    ],
    "isError": false
  }
}
```

The spec examples omit `_meta`; "Every request **MUST** include the required `_meta` fields".

### ImageContent

Example (tools.mdx):

```json
{
  "type": "image",
  "data": "base64-encoded-data",
  "mimeType": "image/png",
  "annotations": {
    "audience": ["user"],
    "priority": 0.9
  }
}
```

Schema (2026-07-28): `type: "image"`, `data: string` ("The base64-encoded image data", `@format byte`), `mimeType: string` ("The MIME type of the image. Different providers may support different image types."), `annotations?: Annotations`, `_meta?: MetaObject`.

### Tool annotations (`ToolAnnotations`, schema.ts 2026-07-28)

| Field | Doc text | Default |
| - | - | - |
| `title?: string` | "A human-readable title for the tool." | none |
| `readOnlyHint?: boolean` | "If true, the tool does not modify its environment." | false |
| `destructiveHint?: boolean` | "If true, the tool may perform destructive updates to its environment. If false, the tool performs only additive updates." Meaningful only when `readOnlyHint == false`. | true |
| `idempotentHint?: boolean` | "If true, calling the tool repeatedly with the same arguments will have no additional effect on its environment." Meaningful only when `readOnlyHint == false`. | false |
| `openWorldHint?: boolean` | "If true, this tool may interact with an "open world" of external entities." | true |

"For trust & safety and security, clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers."

### notifications/tools/list_changed

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed"
}
```

- 2025-11-25: "When the list of available tools changes, servers that declared the `listChanged` capability **SHOULD** send a notification".
- 2026-07-28: servers SHOULD send it only "to clients that have opened a `subscriptions/listen` stream with `toolsListChanged: true`", tagged with `io.modelcontextprotocol/subscriptionId` in `_meta`.

## Errors

- Protocol errors (unknown tool, malformed request, server errors) are JSON-RPC errors, example: `{"code": -32602, "message": "Unknown tool: invalid_tool_name"}`.
- Tool execution errors go in the result with `"isError": true` and text content. "Clients **SHOULD** provide tool execution errors to language models to enable self-correction."
- 2026-07-28 MCP-reserved codes: `HeaderMismatch -32020`, `MissingRequiredClientCapability -32021`, `UnsupportedProtocolVersion -32022` (its `data` carries `supported: string[]` and `requested: string`). Range `-32000` to `-32019` is implementation-defined; `-32020` to `-32099` is reserved for the spec.
- Resource not found changed from `-32002` to `-32602` in 2026-07-28.

## Limits

- Tool names: "**SHOULD** be between 1 and 128 characters in length (inclusive)", case-sensitive, characters `A-Z a-z 0-9 _ - .` only, unique within a server.
- Message size on stdio: not stated.
- Number of tools: not stated.
- Image size or allowed MIME types: not stated ("Different providers may support different image types").

## Gotchas

- Anything written to `stdout` that is not an MCP message breaks the stream. All logs go to `stderr`. This includes logs from dependencies (for example a default `tracing` subscriber writing to stdout).
- Newline-delimited JSON: serialise compactly; a pretty-printed message is invalid on the wire.
- Compatibility matrix (versioning.mdx): a legacy client against a modern-only server "Fails"; a legacy client against a dual-era server "Works. The server answers `initialize`". Stay dual-era while Claude Code can still connect with the v1 runtime.
- 2026-07-28 has no per-connection state: "**MUST NOT** vary per-connection". The spec's "Stateful Tools" guidance names "an open browser context" as an example and says to return "an explicit handle from a creation tool and accepting that handle as an argument on subsequent calls". Relevant for tab IDs.
- `ping` and `logging/setLevel` are removed in 2026-07-28.

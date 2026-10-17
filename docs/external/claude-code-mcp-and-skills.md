# Claude Code: MCP servers, skills and plugins

Fetched: 17/10/2026 from https://code.claude.com/docs/en/mcp, https://code.claude.com/docs/en/skills, https://code.claude.com/docs/en/plugins, https://code.claude.com/docs/en/plugins-reference (markdown versions, `.md` suffix).
Version: the pages are unversioned; they cite Claude Code versions up to v2.1.296. The installed Claude Code version was not checked.

## What this project uses

### Register a local stdio MCP server

```bash
# Basic syntax
claude mcp add [options] <name> -- <command> [args...]
```

- "the `--` (double dash) separates Claude's own options, such as `--transport`, `--env`, and `--scope`, from the command and arguments that run the server. Everything after `--` is passed to the server untouched."
- `--env` takes `KEY=value` pairs. "If the server name comes directly after `--env`, the CLI reads the name as another pair and rejects it, so place at least one other option, such as `--transport stdio`, between `--env` and the server name."
- JSON form: `claude mcp add-json <name> '<json>'`, example `claude mcp add-json local-weather '{"type":"stdio","command":"/path/to/weather-cli","args":["--api-key","abc123"],"env":{"CACHE_DIR":"/tmp"}}'`.
- Manage: `claude mcp list`, `claude mcp get <name>`, `claude mcp remove <name>`, `/mcp` inside a session.

For this project that would be, for example, `claude mcp add --transport stdio --scope user browser-hand -- /absolute/path/to/browser-hand mcp` (the binary name and subcommand are ours, not from the docs).

Claude Code sets `CLAUDE_PROJECT_DIR` in the spawned server's environment.

### Scopes

| Scope | Loads in | Shared with team | Stored in |
| - | - | - | - |
| Local (default) | Current project only | No | `~/.claude.json` |
| Project | Current project only | Yes, via version control | `.mcp.json` in project root |
| User | All your projects | No | `~/.claude.json` |

Flag: `--scope local|project|user`. Precedence when names collide: Local, Project, User, plugin-provided, claude.ai connectors. "fields are not merged across scopes."

`.mcp.json` shape (project scope):

```json
{
  "mcpServers": {
    "shared-server": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

For stdio the entry uses `"type": "stdio"`, `command`, `args`, `env` (from the `add-json` example). `.mcp.json` supports `${VAR}` and `${VAR:-default}` expansion. Project-scoped servers need approval in interactive sessions (`claude mcp reset-project-choices` resets choices).

### Tool naming

- Standalone server: `mcp__<server>__<tool>` (shown in `/mcp`).
- Plugin-bundled server: "`mcp__plugin_<plugin-name>_<server-name>__<tool-name>`, where any character outside `A-Z`, `a-z`, `0-9`, `_`, and `-` is replaced with `_`." Example `mcp__plugin_my-plugin_database-tools__query`. The server registers as `plugin:<plugin-name>:<server-name>`.
- "Claude Code leaves an MCP tool out of the tools it sends to Claude when its full name is over 128 characters."

### Output limits

- "Claude Code displays a warning when any MCP tool output exceeds 10,000 tokens".
- "the default maximum is 25,000 tokens", configurable with `MAX_MCP_OUTPUT_TOKENS` (example `export MAX_MCP_OUTPUT_TOKENS=50000`).
- "Tools that return image data are still subject to `MAX_MCP_OUTPUT_TOKENS`".
- Text over 50,000 characters (successful, no image content) is saved to a file under the session's `tool-results` directory and replaced with the path. A tool can raise this with `_meta["anthropic/maxResultSizeChars"]` in its `tools/list` entry, "up to a hard ceiling of 500,000 characters".
- Error results (`isError: true`): "Error text longer than about 11,000 characters keeps only its first 5,000 and last 5,000 characters".
- Server instructions, and the description of an upfront tool: cut at 4,096 characters. Description of a tool loaded through tool search: 16,384. Override with `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` (v2.1.280+).
- Startup timeout: `MCP_TIMEOUT` (ms). Per-call timeout: per-server `timeout`, else `MCP_TOOL_TIMEOUT`, default "about 28 hours". "Stdio and WebSocket servers have no per-request timer."

### Images in tool results

"When an MCP tool returns a PNG, JPEG, GIF, or WebP image, Claude sees the image inline in the conversation. The inline copy may be scaled down or compressed to fit the model's image size limits. Claude Code also saves the original bytes to a file in the session's `tool-results` directory under `~/.claude/projects/` and gives Claude the path." Requires v2.1.283 or later. With `--no-session-persistence` no file is written.

### Server instructions and tool search

"Only tool names and server instructions load at session start". "If you're building an MCP server, the server instructions field becomes more useful with tool search enabled." Recommended contents: what category of tasks the tools handle, when Claude should search for them, key capabilities. A tool can ask to load upfront with `"anthropic/alwaysLoad": true` in its `_meta`; a user can set `alwaysLoad: true` on the server config.

### Protocol runtime

"The v1 runtime is built on MCP TypeScript SDK 1.x. The v2 runtime is the same code on MCP TypeScript SDK 2.0, which adds MCP protocol revision 2026-07-28." On v2, Claude Code "Asks HTTP, stdio, and claude.ai connector servers whether they support the newer revision, and uses it with those that do." Force with `MCP_SDK_GENERATION=v1|v2` and `MCP_PROTOCOL_NEGOTIATION=auto|legacy`.

`list_changed`: "In an interactive terminal session, Claude Code fetches the updated list from that server". In `-p` mode it "refreshes only the tool list".

### Agent Skills

Locations:

| Location | Path |
| - | - |
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` ("All your projects on this machine, but not Cowork or cloud sessions") |
| Project | `.claude/skills/<skill-name>/SKILL.md` |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md`, invoked as `/plugin-name:skill-name` |
| Enterprise | `.claude/skills/<skill-name>/SKILL.md` in the managed settings directory |

Frontmatter: "All fields are optional. Only `description` is recommended". Key fields:

- `name`: "Command name shown in the `/` menu. Defaults to the directory name."
- `description`: "What the skill does and when to use it." If omitted, the first non-empty markdown line is used. Combined `description` and `when_to_use` text "is truncated at 1,536 characters in the skill listing".
- `when_to_use`, `allowed-tools`, `disallowed-tools`, `disable-model-invocation`, `user-invocable`, `argument-hint`, `arguments`, `model`, `effort`, `context: fork`, `agent`, `hooks`, `paths`, `shell`, `metadata`, `license`, `compatibility`.

Example from the docs:

```yaml
---
name: my-skill
description: What this skill does
disable-model-invocation: true
allowed-tools: Read Grep
---

Your skill instructions here...
```

"Claude Code reads the frontmatter only when the opening `---` is the file's first line." Unknown fields are ignored "without reporting an error".

### Plugin bundling an MCP server plus a skill

Standard layout (plugins-reference): `.claude-plugin/plugin.json` (optional manifest), `skills/<name>/SKILL.md`, `.mcp.json` at the plugin root. "Put every other plugin file at the plugin root, not inside `.claude-plugin/`."

`.mcp.json` at plugin root (docs example):

```json
{
  "mcpServers": {
    "database-tools": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": {
        "DB_URL": "${DB_URL}"
      }
    }
  }
}
```

Or inline in `plugin.json`:

```json
{
  "name": "my-plugin",
  "mcpServers": {
    "plugin-api": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/api-server",
      "args": ["--port", "8080"]
    }
  }
}
```

- `name` is the only required manifest key; kebab-case; no spaces, `@`, `:` or path separators. Names starting with `claude-` or `anthropic-` are reserved (validation error).
- "When you enable a plugin, Claude Code starts its MCP servers automatically". Placeholders `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` are substituted in stdio `command`, `args`, `env`.
- Local development: load with `--plugin-dir` (no marketplace needed).
- A `bin/` directory puts executables on the Bash tool's `PATH`, but "claude.ai and Cowork don't install a plugin that has this directory".

## Errors

- Tool name over 128 characters: tool silently omitted from what Claude sees (listed in `/mcp`).
- Root-level `anyOf`/`oneOf`/`allOf` in `inputSchema`: Claude Code flattens it; if it cannot, "it skips that one tool, records the reason in the server's log".
- Failed refresh after `list_changed`: Claude Code "keeps the server's previously discovered tools".

## Limits

See Output limits above. Also: stdio server shutdown on macOS/Linux is "`SIGINT`, then `SIGTERM` if the process is still running 100 milliseconds later, then `SIGKILL` after a further 400 milliseconds". Skill listing budget "scales at 1% of the model's context window".

## Gotchas

- Plugin tool names differ from standalone tool names, so permission rules and skill `allowed-tools` must use the right form. "A hook matcher written against the bare server key ... never fires for a plugin-bundled server."
- Image results count against `MAX_MCP_OUTPUT_TOKENS` even when a tool sets `anthropic/maxResultSizeChars`. Screenshot sizing matters.
- Instructions over 4,096 characters are cut; put critical guidance first.
- The 600 ms shutdown window on macOS is short; clean up the socket file on `SIGINT`/`SIGTERM` or tolerate a stale one at next start.
- How the token cost of an image result is computed by Claude Code: not stated.

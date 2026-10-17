# Claude in Chrome: extracted reference

Captured 17/10/2026 from this machine: Claude Code's `claude-in-chrome` MCP
integration and the installed Claude Chrome extension (ID
`fcoeoabgfenejglbffodgkkbkcdhcgfn`, version 1.0.101).

## Contents

| Path | What it is |
| --- | --- |
| `tools/tools.json` | All 22 MCP tools: name, description, input schema |
| `tools/<tool>.json` | The same, one file per tool |
| `skill/SKILL.md` | The built-in `claude-in-chrome` skill (ships inside the Claude Code binary, not on disk) |
| `usage/mcp-server-instructions.md` | Instructions the MCP server sends at connection |
| `usage/system-prompt-rules.md` | Behaviour rules from the system prompt and tool descriptions, summarised |
| `extension/manifest.json` | Extension manifest: permissions, content scripts, CSP, side panel command |
| `extension/managed_schema.json` | Chrome enterprise policy keys (`blockedUrlPatterns`, `forceLoginOrgUUID`) |
| `extension/i18n/` | UI strings in 11 locales |
| `extension/_metadata/verified_contents.json` | Chrome Web Store content hashes |
| `extension/file-listing.tsv` | Every file in the installed extension, with size in bytes |
| `extension/git-hash.txt` | Build commit of the extension |
| `extension/installed-versions.txt` | Versions present on disk |
| `native-hosts/` | Native messaging host registrations and the Claude Code host wrapper |

## Tools

- Browser selection: `list_connected_browsers`, `select_browser`, `switch_browser`
- Tabs and windows: `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `resize_window`
- Reading: `read_page`, `find`, `get_page_text`, `read_console_messages`, `read_network_requests`
- Acting: `computer`, `form_input`, `javascript_tool`, `file_upload`, `upload_image`, `browser_batch`
- Extras: `gif_creator`, `shortcuts_list`, `shortcuts_execute`

## How it connects

Claude Code → `native-hosts/chrome-native-host.sh` (runs
`claude --chrome-native-host`) → Chrome native messaging
(`com.anthropic.claude_code_browser_extension`) → the extension. The Claude
desktop app registers a second host, `com.anthropic.claude_browser_extension`.
The extension can also reach a remote relay at
`wss://bridge.claudeusercontent.com` (see the manifest's CSP).

## Not included

The extension's JavaScript, HTML and CSS bundles are proprietary and were not
copied; `extension/file-listing.tsv` records what exists. Study the extension
by its behaviour and manifest only.

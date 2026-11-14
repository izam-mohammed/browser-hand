# Claude in Chrome: extracted reference

First captured 17/10/2026 (Claude extension 1.0.101). Updated 14/11/2026 from
this machine: Claude Code 2.1.325's `claude-in-chrome` MCP integration (tool
list read live from `claude --claude-in-chrome-mcp`) and the installed Claude
Chrome extension (ID `fcoeoabgfenejglbffodgkkbkcdhcgfn`, version 1.0.107).

## Contents

| Path | What it is |
| --- | --- |
| `tools/tools.json` | All 20 MCP tools: name, description, input schema |
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
- Extras: `gif_creator`

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

## Changes since 17/10/2026

- Claude Code removed `shortcuts_list` and `shortcuts_execute` from its
  built-in Claude in Chrome tools (22 tools down to 20).
- `read_network_requests`: URLs list auth values as `REDACTED`, and
  `urlPattern` matches against that form.
- `action_summary` on `computer` and `form_input` (and its mention in
  `browser_batch`) is behind a feature flag in 2.1.325; it is kept in the
  schemas here as captured on 17/10/2026.
- `javascript_tool` results up to 60,000 characters stay in the conversation.
- After a brief disconnect Claude Code waits up to 6 seconds for the session's
  own browser before picking another, and checks the page before repeating an
  action that may have run.
- Browser tool calls refuse some escaped or JSON-text inputs and say how to
  respell them.
- Extension 1.0.107 adds a `cursor-motion.js` content script (an animated agent
  cursor), the `favicon` permission and a Google Meet content script
  (`meet-add-claude`); `forceLoginOrgUUID` now also blocks Claude Code and
  Claude Desktop when the signed-in organisation is not listed.
- Skill text and MCP server instructions: unchanged.
- `native-hosts/` is still the 17/10/2026 macOS capture; this Linux machine
  has no `com.anthropic.*` host registered in Chrome.

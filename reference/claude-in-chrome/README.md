# Claude in Chrome: extracted reference

First captured 17/10/2026 (Claude extension 1.0.101). Updated 14/11/2026 and
again 17/11/2026 from this machine: Claude Code's `claude-in-chrome` MCP
integration (tool list read live from `claude --claude-in-chrome-mcp`; 2.1.326
on 17/11/2026) and the installed Claude Chrome extension (ID
`fcoeoabgfenejglbffodgkkbkcdhcgfn`, version 1.0.107).

## Contents

| Path | What it is |
| --- | --- |
| `tools/tools.json` | All 20 MCP tools: name, description, input schema, and `_meta` or `title` where the server sends them (as of 2.1.326) |
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

## Changes since 14/11/2026

Refreshed 17/11/2026 against Claude Code 2.1.326 (changelog entries for
2.1.325 and 2.1.326 read, 13 and 16 November) and the installed extension.

- Tool set: still 20 tools, same names; nothing added or removed.
- `action_summary` is gone from the live schemas of `computer` and
  `form_input`, and its sentence is gone from `browser_batch`'s `input`
  description. `tools/*.json` now hold the live shape (the 14/11/2026 note
  said they kept the 17/10/2026 text).
- `read_page`, `get_page_text`, `javascript_tool` and `browser_batch` carry
  `_meta: {"anthropic/maxResultSizeChars": 60000}`: a client hint that their
  results stay in the conversation up to 60,000 characters. 14/11/2026 knew
  of it for `javascript_tool` only.
- `tabs_context_mcp`, `tabs_create_mcp` and `tabs_close_mcp` carry a `title`
  ("Tabs Context", "Tabs Create", "Tabs Close").
- The live tool names are bare (`computer`); `tools/*.json` keep the
  `mcp__claude-in-chrome__` prefix as captured on 17/10/2026.
- Claude Code 2.1.326: a long `browser_batch` call has 150 s to answer (was
  90 s); permission prompts over Remote Control name the site.
- Claude Code docs (`code.claude.com/docs/en/chrome`, read 17/11/2026):
  - file uploads refuse files with more than one hard link and files whose
    name or folder holds credentials (`.env`, `.pem`, `.key`, anything under
    `.ssh`, Claude Code 2.1.293 or later); 10 MB per upload; `Read` deny
    rules also block uploads;
  - works in Chrome and Edge, and Claude Code sets up the host for Brave,
    Arc, Vivaldi and Opera; native host manifests documented for macOS,
    Linux (`~/.config/google-chrome/NativeMessagingHosts/`) and Windows;
  - `/clear` closes the session's tab group; resume or exit closes it only
    when it holds nothing but empty new tabs;
  - plan mode asks before a GIF recording or a new tab (also
    `tabs_context_mcp` with `createIfEmpty` and a `browser_batch` holding
    one);
  - an install prompt when the extension is missing; a project's
    `.claude/settings.json` cannot turn Chrome on (`CLAUDE_CODE_ENABLE_CFC`);
  - the extension must be signed in to the same claude.ai organisation as
    Claude Code; HIPAA and zero-data-retention organisations have it off.
- Extension (support articles read 17/11/2026; the release-notes article
  returned 404): 1.0.107 is still the newest installed and its manifest and
  file list are unchanged from the 14/11/2026 capture. The article lists
  features the extension itself holds, none of them MCP tools: Cowork
  sessions in the side panel, shortcuts (type `/`), scheduled tasks (clock
  icon), workflow recording saved as a shortcut, automatic approval of
  actions by a classifier (general availability, 26/08/2026), admin site
  allow and block lists, 1Password sign-in (beta), and prompt-injection
  probes.
- Skill text and MCP server instructions: not re-captured. A bare
  `claude --claude-in-chrome-mcp` sent no `instructions` field on 17/11/2026,
  so `usage/mcp-server-instructions.md` (captured inside a connected Claude
  Code session) is unchecked this round.

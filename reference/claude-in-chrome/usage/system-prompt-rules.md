# System prompt rules for Claude in Chrome

Claude Code puts a "Claude in Chrome browser automation" section into the system
prompt when the integration is enabled. Its text is the same as the skill body
(`../skill/SKILL.md`): loading deferred tools in one ToolSearch call, GIF
recording, console log filtering, avoiding alerts and dialogs, stopping after
2 or 3 failures, and calling `tabs_context_mcp` first.

Rules that live in the tool descriptions rather than the skill
(see `../tools/tools.json`):

- `browser_batch` runs items in order, stops on the first error, cannot be
  nested, and runs each tool's own permission check per item. Coordinates in a
  batch refer to the screenshot taken before the call.
- Clicks, drags, `key`, `type` and `form_input` take an `action_summary`: a few
  words stating the effect only, with no reasons and no secrets.
- `navigate` can omit `tabId` when called on its own; it then calls
  `tabs_context_mcp{createIfEmpty:true}` itself. Inside a batch `tabId` is
  required.
- Tabs Claude creates are Claude's to close before finishing, unless the user
  wants them kept.
- `file_upload`: never click a file input (it opens a native picker). Only
  files the user has shared with the session; 10 MB total per call.
- `upload_image`: only screenshots Claude just took; IDs expire in minutes;
  retry at most once with a fresh screenshot.
- `list_connected_browsers` / `select_browser` / `switch_browser`: never pick a
  browser on the user's behalf when several are connected; ask with one option
  per browser plus an exact final option for the in-Chrome confirmation screen.
- `computer` `wait` is capped at 10 s; `key` repeat 1 to 100; page zoom
  shortcuts are refused (use the `zoom` action).
- `read_page` output is capped at 50,000 characters by default (default depth 15).
- `read_console_messages` returns the current domain only; always pass a pattern.
- `read_network_requests` clears automatically on cross-domain navigation.
- `shortcuts_execute` returns immediately and does not wait for completion.

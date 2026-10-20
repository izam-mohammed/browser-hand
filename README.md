# browser-hand

Lets Claude Code drive your own Chrome profiles: pick a profile, open and read
pages, and click, type and scroll the way a person does, through a local MCP
server and a Chrome extension whose only UI is a Record button for your own
steps, which Claude can then read and replay, and a settings page. Modelled on Claude in Chrome
(`reference/claude-in-chrome/`), with profiles in place of a connected-browser
list. macOS and Google Chrome for now.

What is built, and what is left: `PLAN.md`.

## How it fits together

```text
Claude Code --stdio--> browser-hand mcp --unix socket--> browser-hand (native host) --native port--> extension
```

Chrome starts one native host per profile that has the extension. Each
listens on its own socket; the MCP server finds them and talks to the one for
the profile you select, opening that profile with Chrome's command line if it
is not open. The wire format is `docs/protocol.md`.

## Install

Needs Rust (1.88+), Node (to build the extension) and Google Chrome.

1. Build everything and register the native host:

   ```sh
   sh scripts/build.sh
   ```

   It builds `host/` and `extension/`, copies the binary into
   `plugin/server/`, and writes one file outside the repository,
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.browserhand.host.json`
   (`plugin/server/browser-hand install --uninstall` removes it).

2. In each Chrome profile Claude may use: open `chrome://extensions`, turn on
   Developer mode, choose **Load unpacked** and pick `extension/dist`. The
   extension ID is always `ednpkicgdjiiihmophoifehfeeoabjdc`.

3. Start Claude Code with the plugin, which brings the server and the
   `browser-hand` skill:

   ```sh
   claude --plugin-dir "$PWD/plugin"
   ```

   Or add only the server:

   ```sh
   claude mcp add --scope user browser-hand -- "$PWD/plugin/server/browser-hand" mcp
   ```

## Settings

Right-click the extension's toolbar button and choose **Options** (or
`chrome://extensions`, Details, Extension options). The page sets, for
every Chrome profile at once: pace (Human or Fast), typing and mouse speed,
a default profile, whether a session opens a new window and closes its tabs
at the end, blocked and read-only sites, screenshot size and quality, the
GIF folder and frame delay, and how soon the debugger detaches.

The native host saves them to `~/.config/browser-hand/config.toml`
(`$XDG_CONFIG_HOME/browser-hand/` when set), mode `0600`, and every open
profile picks a change up within 2 seconds. The page needs the host: with
it not running, the page shows the last values read-only. Deleting the file
brings the defaults back.

Blocked and read-only sites are patterns like `*.bank.com/*` (`host/path`,
`*` for anything, no scheme). The extension enforces them, so no request
from the MCP server gets past them: every tool checks the tab's site, and
Claude's tabs cannot load a blocked site at all (a network rule, on Claude's
tab groups only). Read-only sites can be read and screenshotted but not
clicked, typed in or scripted. Claude is told never to edit the file;
nothing stops a Bash command that does, so keep that in mind.

`BROWSER_HAND_PACE=fast` (or `human`) in a server's environment still
overrides the page's pace for that server, and `BROWSER_HAND_OUTPUT_DIR`
the GIF folder.

## Tools

| Tool | What it does |
| --- | --- |
| `list_profiles` | Your Chrome profiles, and which have the extension connected |
| `select_profile` | Binds the session to a profile; opens it with Chrome's command line (starting Chrome if needed) when it is not open |
| `tabs_context`, `tabs_create`, `tabs_close` | The session's own `browser-hand` tab group |
| `navigate` | Opens a URL, or goes back or forward, and waits for the load |
| `read_page` | The page as a tree of roles, names and refs (`ref_k3x9_12`) |
| `find` | Elements matching plain words ("email field", "log in button") |
| `get_page_text` | The article's text, or the page's |
| `read_console_messages` | Console output and uncaught errors since the page loaded |
| `read_network_requests` | Requests with method, status and time |
| `form_input` | Sets a field, select or checkbox instantly |
| `javascript_tool` | Runs JavaScript in the page |
| `file_upload` | Puts files from disk into a file input |
| `computer` | Mouse, keyboard and screenshots, moving like a person |
| `resize_window` | Resizes the tab's window |
| `browser_batch` | Several tool calls in one round trip |
| `upload_image` | Uploads a recent screenshot to a file input or drop target |
| `gif_creator` | Records the session's actions as an animated GIF, into the settings' GIF folder |
| `recording_list`, `recording_get`, `recording_delete` | Steps you recorded with the toolbar button: list, read (as text or DevTools Recorder JSON), delete |
| `recording_replay` | Does a recording's steps again in Claude's tab, moving like a person, with values changed where asked |

Each Claude session works in its own tab group and cannot touch other tabs.

### How to record

Pin browser-hand from Chrome's puzzle-piece menu, then press its button (or
Alt+Shift+R) in the window you want to record. "REC" shows on the badge of
every tab in that window, and of windows its tabs open. Do the task, then
press the button again. Clicks, what you typed into fields (as the final
value), Enter, Tab and Escape, scrolls and page loads become steps that name
each element the way a screen reader would ("button 'Save'"). Passwords,
card numbers and one-time codes are stored as `<masked>`. Then ask Claude
"what did I just record?", or to do it again.

Recordings stay in this profile's extension storage: the newest 20, up to
50 MB. A recording stops by itself after 30 minutes with no step, when its
window closes, or at 5,000 steps; "FULL" on the badge means a write failed,
and the steps up to then are kept. Only you start a recording; Claude has
no tool for it. Steps reach Claude only when it reads a recording.

### How "humane" works

`computer` sends input through Chrome's debugger protocol, so pages receive
trusted events, but shapes them like a hand: the cursor follows a curved path
on a minimum-jerk speed profile with an overshoot on long moves, clicks are
held for a moment, keys go down and up one at a time with gaps drawn from
typing research, and the wheel turns in notches. Every constant, with its
source or marked as an assumption, is in `extension/src/humane/params.ts`;
the research is `docs/research/humane-input.md`.

Reading tools never attach the debugger, so Chrome's "started debugging this
browser" bar only shows while Claude is acting, and goes 30 s after (the
settings' "Detach after idle").

## Tests

```sh
cargo test --manifest-path host/Cargo.toml   # also regenerates extension/src/wire.gen.ts
npm --prefix extension test
```

Proofs that the external pieces behave as documented live in
`scripts/prove/`; each prints `PASS` or `FAIL`. Two of them need you at
Chrome (`chrome-bridge.sh`, `cdp-input.sh`); each says how to run it at the
top of the file.

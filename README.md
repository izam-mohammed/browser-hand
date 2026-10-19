# browser-hand

Lets Claude Code drive your own Chrome profiles: pick a profile, open and read
pages, and click, type and scroll the way a person does, through a local MCP
server and a Chrome extension with no UI. Modelled on Claude in Chrome
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

Set `BROWSER_HAND_PACE=fast` in the server's environment to skip the human
travel time and typing gaps.

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
| `gif_creator` | Records the session's actions as an animated GIF |

Each Claude session works in its own tab group and cannot touch other tabs.

### How "humane" works

`computer` sends input through Chrome's debugger protocol, so pages receive
trusted events, but shapes them like a hand: the cursor follows a curved path
on a minimum-jerk speed profile with an overshoot on long moves, clicks are
held for a moment, keys go down and up one at a time with gaps drawn from
typing research, and the wheel turns in notches. Every constant, with its
source or marked as an assumption, is in `extension/src/humane/params.ts`;
the research is `docs/research/humane-input.md`.

Reading tools never attach the debugger, so Chrome's "started debugging this
browser" bar only shows while Claude is acting, and goes 30 s after.

## Tests

```sh
cargo test --manifest-path host/Cargo.toml   # also regenerates extension/src/wire.gen.ts
npm --prefix extension test
```

Proofs that the external pieces behave as documented live in
`scripts/prove/`; each prints `PASS` or `FAIL`. Two of them need you at
Chrome (`chrome-bridge.sh`, `cdp-input.sh`); each says how to run it at the
top of the file.

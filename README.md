# browser-hand

Lets Claude Code drive your own Chrome profiles: list them, pick one, and
work in tabs there, through a local MCP server and a Chrome extension with no
UI. Modelled on Claude in Chrome (`reference/claude-in-chrome/`), with
profiles in place of a connected-browser list. macOS and Google Chrome for
now.

What is built so far, and what is next: `PLAN.md`.

## How it fits together

```text
Claude Code --stdio--> browser-hand mcp --unix socket--> browser-hand (native host) --native port--> extension
```

Chrome starts one native host per profile that has the extension. Each
listens on its own socket; the MCP server finds them and talks to the one
for the profile you select. The wire format is `docs/protocol.md`.

## Install

Needs Rust (1.88+), Node (for building the extension) and Google Chrome.

1. Build both halves:

   ```sh
   cargo build --release --manifest-path host/Cargo.toml
   npm --prefix extension install
   npm --prefix extension run build
   ```

2. Register the native host (writes one file,
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.browserhand.host.json`):

   ```sh
   host/target/release/browser-hand install
   ```

   `browser-hand install --uninstall` removes it.

3. In each Chrome profile you want Claude to use: open
   `chrome://extensions`, turn on Developer mode, choose **Load unpacked**
   and pick `extension/dist`. The extension ID is always
   `ednpkicgdjiiihmophoifehfeeoabjdc`.

4. Add the server to Claude Code:

   ```sh
   claude mcp add --scope user browser-hand -- "$PWD/host/target/release/browser-hand" mcp
   ```

## Tools so far

| Tool | What it does |
| --- | --- |
| `list_profiles` | Your Chrome profiles, and which have the extension connected |
| `select_profile` | Binds this Claude session to one profile, connecting it if needed |
| `tabs_context` | This session's tab group: tab ids, titles, URLs |
| `tabs_create` | A new tab in the session's group |
| `tabs_close` | Closes a tab in the session's group |
| `navigate` | Opens a URL, or goes back or forward, and waits for the load |

Each Claude session works in its own tab group titled `browser-hand` and
cannot touch other tabs.

## Tests

```sh
cargo test --manifest-path host/Cargo.toml    # also regenerates extension/src/wire.gen.ts
npm --prefix extension test
```

Proofs that the external pieces behave as documented live in
`scripts/prove/`; each prints `PASS` or `FAIL`.

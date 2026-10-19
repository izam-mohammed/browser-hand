# Evidence for plans/01-bridge.md

Gathered 17/10/2026 while planning, moved here from the plan on 18/10/2026
so the plan stays short. The tables and choices stay in the plan; this note
holds the evidence behind the scores. Searches added on 18/10/2026 are
marked with that date.

## Decision 1: how Claude's tool calls reach a running Chrome profile

- Remote debugging and `--load-extension`:
  `docs/external/chrome-profiles-and-launch.md` § Chrome 136 and § Chrome
  137. Chrome 136 ignores `--remote-debugging-port` on the default user data
  dir; branded Chrome 137 drops `--load-extension`. Both rule out driving the
  user's own running profiles from outside.
- Efficiency 4 each: the native route adds one local socket hop; the
  WebSocket route needs the extension to poll for a server that may not be
  running.
- Security 5 vs 2: native messaging is gated by `allowed_origins` and the
  socket sits in a `0700` directory; a localhost port is reachable by every
  local process and user (`docs/external/chrome-native-messaging.md` § Host
  manifest).
- Reliability 4 vs 3: an open native port keeps the service worker alive
  (§ Service worker lifetime); a WebSocket keeps it alive only while messages
  flow, and several MCP sessions would fight over one port.
- Compatibility 5: the shape Claude in Chrome itself uses
  (`reference/claude-in-chrome/README.md` § How it connects).
- Sensitivity: moving 10 points from security to efficiency leaves 4.25 vs
  3.40; the winner holds.
- Risk: Chrome kills the host when the port closes, so a service worker
  restart drops in-flight calls; the MCP side retries a call once on
  `not_connected` after the extension reconnects.

Searches, 17/10/2026: the Chrome native messaging guide, the service worker
lifecycle page and the `runtime` reference (developer.chrome.com); the
Chrome blog post on remote debugging port changes; a web search for "Chrome
137 --load-extension command line switch removed branded Chrome", the
chromium-extensions group thread it led to, and Chromium source search for
`DisableLoadExtensionCommandLineSwitch`.

## Decision 2: the language of the MCP server and native host

- Efficiency: idle RSS 2.0 MB Rust, 27.9 MB Bun, 46.2 MB Node, measured
  17/10/2026 (`docs/research/runtime-baseline.md`). The built host measured
  2,288 KB idle with one socket client (plan Phase 3).
- Reliability Bun 3: a younger runtime with a smaller stdio and socket test
  record; Node and Rust both have long-stable stdio and Unix socket APIs.
- Security: Rust has no runtime package fetch and is memory safe; the Node
  and Bun routes pull an npm tree into a process that holds the browser.
- Portability Node 5: runs wherever Node is installed; Rust needs a build
  per target, which `cargo` gives for macOS, Linux and Windows.
- MCP SDK: `rmcp` 3.5.1 is the official Rust SDK (`docs/external/rmcp.md`,
  fetched from crates.io, docs.rs and the modelcontextprotocol/rust-sdk
  repository on 17/10/2026).

Search, 18/10/2026: "Chrome native messaging host written in Rust vs Node.js
memory footprint". One project's benchmark of the same Chrome-driving daemon
in both languages reports about 140 MB of V8 overhead for Node against about
7 MB for Rust; Chrome's own guidance names Go or Rust for cross-platform
hosts. Nothing contradicts the local measurement; the choice holds.

## Decision 3: the language of the extension

Search, 18/10/2026: "Chrome extension MV3 service worker written in Rust
WebAssembly chrome API access wasm-bindgen". Rust-to-wasm extensions exist
(wasm-bindgen tutorials, the `oxichrome` framework), but every one reaches
`chrome.*` through JS glue or an unstable binding crate
(`web-extensions-sys`, last released April 2023), and MV3 needs
`'wasm-unsafe-eval'` in the extension CSP to run wasm at all. This confirms
the table's "no direct `chrome.*` or DOM access" and "JS glue for every
`chrome.*` call"; the choice holds.

## Decision 4: who listens on the local socket

- Socket path `<per-user temp dir>/bh/<pid>.sock`: macOS caps `sun_path` at
  103 usable bytes and `$TMPDIR` is 49 here (`docs/external/rust-ipc.md`
  § macOS `sun_path` limit).

Searches, 17/10/2026: docs.rs pages for tokio `UnixListener` and
`UnixStream`, and crates.io for `interprocess` 2.4.6
(`docs/external/rust-ipc.md`).

## Decision 5: how a connection learns its profile

- The handshake: `select_profile` runs `open -na "Google Chrome" --args
  --profile-directory=<dir> chrome-extension://<id>/claim.html#dir=<dir>&nonce=<n>`.
  The same command opens the profile when it is not open, and starts Chrome
  in that profile when Chrome is not running. Chrome routes it to that
  profile; the extension page stores `dir` in `chrome.storage.local` and
  reports it with the nonce. Every later connection from that profile says
  its `dir` in `hello`.
- Routing and the extension URL launch were read from Chromium source
  (`startup_browser_creator*.cc`, `url_util.cc`), not tested, so Phase 1
  proves them (`docs/external/chrome-profiles-and-launch.md`).
- Chrome passes the host only the caller origin, never the profile
  (`docs/external/chrome-native-messaging.md` § How Chrome launches the
  host).

Searches, 17/10/2026: the native messaging guide and the Chromium sources
listed in `docs/external/chrome-profiles-and-launch.md`, plus the
`storage` reference page (developer.chrome.com).

## Decision 6: framing on the local socket

Searches, 17/10/2026: the native messaging guide (its four-byte length
prefix) and crates.io for `native_messaging`
0.3.0 and `chrome_native_messaging` 0.3.0 (`docs/external/rust-ipc.md`
§ Native messaging framing).

## Security

Search, 18/10/2026: "OWASP browser extension security cheat sheet native
messaging". The OWASP Browser Extension Vulnerabilities Cheat Sheet
(cheatsheetseries.owasp.org) covers permission overreach, data leakage and
XSS; other write-ups name the native-messaging risks: a wildcard content
script forwarding page messages to a native host, loose `allowed_origins`,
and a relative host `path`. The plan's `## Security` table walks those.

## Build notes

The `Landed` notes in the plan's phases, in full. The plan keeps a short
form of each.

- Phase 2, wire types: ts-rs 12.0.1 output checked and written up in
  `docs/external/ts-rs.md`; it also emits
  `extension/src/serde_json/JsonValue.ts`. Fixtures shared by both sides:
  `host/tests/fixtures/frames.json` and `chunked-call.json`; the TS
  rejoiner is `extension/src/wire.ts`.
- Phase 3, relay: the socket dir is the per-user temp dir from
  `confstr(_CS_DARWIN_USER_TEMP_DIR)` (`host/src/paths.rs`), not `$TMPDIR`,
  since Chrome and Claude Code may start with different environments.
  Chrome passes only the extension origin, so `host/src/main.rs` treats a
  `chrome-extension://` first argument as `native-host`.
- Phase 4, tabs: tab logic in `extension/src/tabs.ts` behind an injected
  Chrome API; session to group ids kept in `chrome.storage.session` so a
  service worker restart keeps them; claim page script
  `extension/src/claim.ts`, bundled by `extension/build.mjs`.
- Phase 5, select: the socket client is `host/src/host_conn.rs`. A profile
  is found by dir or by name in any case. With exactly one connected
  profile, tab tools bind it without `select_profile`; with several they
  refuse and ask for a selection. Server instructions come from a
  hand-written `get_info`, since `#[tool_handler(instructions)]` takes only
  a literal.

## What the tests hold

`wire.rs` round-trips every frame type and splits and rejoins chunks at the
1 MB boundary; the TS side decodes the same fixtures. The host relays a call
from two socket clients to a fake native port and returns each result to the
client that sent it. `profiles.rs` parses a fixture `Local State` and pairs
profiles with live sockets. The extension's dispatcher keeps each session's
tabs in its own group, tested against a `chrome` API fake. The walk in Phase
6 is the only check against real Chrome.

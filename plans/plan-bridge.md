# Claude lists the local Chrome profiles, picks one and opens, lists and closes tabs in it

## The ask

"Build a chrome extension with a local mcp and related skill to manage the
chrome instance and do changes over there. Primarily whatever claude in
chrome has. No need for any interface in browser. Instead of global browser
list, I have profiles available in local chrome; I want to list them and
perform in particular chrome instances via claude using mcp. Rust for the mcp
part and ts for the extension, but use the research method and find the best."

What it means against the tree: `reference/claude-in-chrome/` holds the 22
tools Claude in Chrome exposes, its skill and its native host wiring. This
plan builds the pipe every later tool rides on: a Rust binary that is the MCP
server and the native messaging host, a TypeScript MV3 extension with no UI,
profile discovery from Chrome's `Local State`, and the tab tools. The
reading tools are `plans/plan-page-tools.md`, the mouse and keyboard
`plans/plan-humane-input.md`, the skill and packaging `plans/plan-skill.md`.

This Mac has three profiles (`Default`, `Profile 3`, `Profile 4`) on Chrome
155.

## Constraints

- "No need for any interface in browser": no side panel, popup or options UI.
- "Use rust for mcp part and ts for the chrome extension part", subject to
  the research (decisions 2 and 3 confirm both on the result).

## Alternatives

### Decision 1: how do Claude's tool calls reach a running Chrome profile? (one-way door)

Everything else is built on this pipe.

| Must | Native host + local socket | Extension WebSocket to localhost | CDP remote debugging port | Playwright persistent context |
| --- | --- | --- | --- | --- |
| Drives the user's existing profiles while Chrome runs | yes | yes | no (Chrome 136 ignores the switch on the default user data dir) | no (needs the profile closed, and `--load-extension` is gone since 137) |
| **Survives** | **yes** | **yes** | no | no |

| Criterion | Weight | Native host + local socket | Extension WebSocket |
| --- | ---: | ---: | ---: |
| Performance efficiency | 35 | 4 | 4 |
| Security | 25 | 5 | 2 |
| Reliability | 20 | 4 | 3 |
| Compatibility | 10 | 5 | 3 |
| Reversibility | 10 | 4 | 4 |
| **Weighted total** | **100** | **4.35** | **3.20** |

- Remote debugging and `--load-extension`: `docs/external/chrome-profiles-and-launch.md`
  § Chrome 136 and § Chrome 137.
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

Sensitivity: moving 10 points from security to efficiency leaves 4.25 vs
3.40; the winner holds. Risk: Chrome kills the host when the port closes, so
a service worker restart drops in-flight calls; the MCP side retries a call
once on `not_connected` after the extension reconnects.

**Chosen: native messaging host relaying to a local Unix socket.** Revisit
if Chrome changes native messaging lifetime rules.

### Decision 2: what language is the MCP server and native host? (two-way door)

One host process runs per connected profile for as long as Chrome runs, so
idle footprint dominates (`docs/research/runtime-baseline.md`).

| Criterion | Weight | Rust | Node (TypeScript) | Bun |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency | 45 | 5 | 2 | 3 |
| Reliability | 20 | 4 | 4 | 3 |
| Security | 15 | 4 | 3 | 3 |
| Portability | 10 | 4 | 5 | 4 |
| Compatibility | 10 | 4 | 4 | 4 |
| **Weighted total** | **100** | **4.45** | **3.05** | **3.20** |

- Efficiency: idle RSS 2.0 MB Rust, 27.9 MB Bun, 46.2 MB Node, measured
  17/10/2026 (`docs/research/runtime-baseline.md`).
- Reliability Bun 3: a younger runtime with a smaller stdio and socket test
  record; Node and Rust both have long-stable stdio and Unix socket APIs.
- Security: Rust has no runtime package fetch and is memory safe; the Node
  and Bun routes pull an npm tree into a process that holds the browser.
- Portability Node 5: runs wherever Node is installed; Rust needs a build
  per target, which `cargo` gives for macOS, Linux and Windows.
- MCP SDK: `rmcp` 3.5.1 is the official Rust SDK (`docs/external/rmcp.md`).

**Chosen: Rust, one binary `browser-hand` with `mcp`, `native-host` and
`install` subcommands.** Revisit if the host's idle RSS in Phase 3 exceeds
20 MB.

### Decision 3: what language is the extension? (two-way door)

| Criterion | TypeScript | Plain JavaScript | Rust compiled to wasm |
| --- | --- | --- | --- |
| Performance efficiency | same JS at run time | same | wasm load plus JS glue for every `chrome.*` call |
| Fit to the ask | full `chrome.*` and DOM access | same | no direct `chrome.*` or DOM access |
| Compatibility | wire types generated from the Rust types (`ts-rs`) | hand-copied types drift | shares Rust types natively |
| Maintainability of the result | types check every message handler | none | two toolchains in the extension |

**Chosen: TypeScript, bundled by esbuild.** Equal at run time to JS and
cheaper than wasm, and the generated wire types hold the contract on both
sides. Revisit if a hot path (GIF encoding, path generation) proves too slow
in JS.

### Decision 4: who listens on the local socket? (two-way door)

| Criterion | Each host listens, MCP connects | The MCP server listens, hosts connect |
| --- | --- | --- |
| Fit to the ask | several Claude sessions can share one profile | each host must guess which of several MCP servers to dial |
| Reliability | hosts live as long as Chrome; sessions come and go | a host with no server running has nowhere to go |
| Performance efficiency | MCP scans one directory at `list_profiles` | same |

Socket path `$TMPDIR/bh/<pid>.sock`: macOS caps `sun_path` at 103 usable
bytes and `$TMPDIR` is 49 here (`docs/external/rust-ipc.md` § macOS `sun_path`
limit).

**Chosen: each host listens on its own socket.** Revisit if Windows support
is added (named pipes, `interprocess`).

### Decision 5: how does a connection learn which profile it belongs to? (two-way door)

Chrome passes the host only the caller origin, never the profile
(`docs/external/chrome-native-messaging.md` § How Chrome launches the host).

| Must | Claim handshake by launch URL | Match signed-in email | Scan extension storage on disk |
| --- | --- | --- | --- |
| Works for a profile with no Google sign-in | yes | no | yes |
| Never reads Chrome's internal databases while it runs | yes | yes | no |
| **Survives** | **yes** | no | no |

The handshake: `select_profile` runs `open -na "Google Chrome" --args
--profile-directory=<dir> chrome-extension://<id>/claim.html#dir=<dir>&nonce=<n>`;
Chrome routes it to that profile, the extension page stores `dir` in
`chrome.storage.local` and reports it with the nonce. Every later connection
from that profile says its `dir` in `hello`. Routing and the extension URL
launch are read from Chromium source, not tested
(`docs/external/chrome-profiles-and-launch.md`), so Phase 1 proves them.

**Chosen: claim handshake.** Revisit if Phase 1's proof fails, falling back
to the email match for signed-in profiles.

### Decision 6: framing on the local socket (two-way door)

| Criterion | u32 length + JSON | Newline-delimited JSON | MessagePack |
| --- | --- | --- | --- |
| Performance efficiency | reads a frame without scanning for a delimiter | scans every byte of multi-MB base64 screenshots | smallest, but re-encoded to JSON for Chrome anyway |
| Compatibility | same framing as native messaging, one codec | a second codec | a second codec plus a dependency |

**Chosen: u32 little-endian length plus UTF-8 JSON.** Revisit never unless
payloads leave JSON.

## The decision

Feature path. One Rust crate in `host/` builds `browser-hand`:
`browser-hand mcp` is the stdio MCP server Claude Code starts (decision 2),
`browser-hand native-host` is what Chrome starts per profile, relaying between
the native port and its socket (decisions 1, 4, 6), `browser-hand install`
writes the host manifest. The extension in `extension/` is TypeScript with a
service worker and one page, `claim.html` (decisions 3, 5). Profiles come from
`Local State` `profile.info_cache` (`docs/external/chrome-profiles-and-launch.md`
§ `Local State`).

Tools this plan lands, named as Claude in Chrome names them minus the `_mcp`
suffix: `list_profiles` and `select_profile` (replacing
`list_connected_browsers`, `select_browser`, `switch_browser`),
`tabs_context`, `tabs_create`, `tabs_close`, `navigate`. Each MCP session owns
one tab group titled `browser-hand` per profile.

Dependencies: crates `rmcp` (features `server`, `macros`, `transport-io`,
pinned to 3.5), `tokio`, `serde`, `serde_json`, `ts-rs`, `uuid`; npm dev
dependencies `typescript`, `esbuild`, `vitest`, `@types/chrome`. Extension
permissions: `nativeMessaging`, `tabs`, `tabGroups`, `storage`. Native host
name `dev.browserhand.host`, distinct from the two Anthropic hosts already
installed. Writes one file outside the repo: the host manifest under
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. No
network host, no secret.

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| rmcp stdio server | `docs/external/rmcp.md` | `scripts/prove/rmcp-stdio.sh` | none |
| Chrome native messaging and profile launch | `docs/external/chrome-native-messaging.md` | `scripts/prove/chrome-bridge.sh` | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/rmcp-stdio.sh` | new | 1 | proof driver for the MCP SDK | expected |
| `scripts/prove/rmcp-stdio/` | new | 1 | minimal rmcp server crate, kept in the repo | expected |
| `scripts/prove/chrome-bridge.sh` | new | 1 | proof driver for native port and claim launch | expected |
| `scripts/prove/chrome-bridge/` | new | 1 | echo extension and echo host, kept in the repo | expected |
| `docs/protocol.md` | new | 2 | the wire contract below | fixed |
| `host/src/wire.rs` | new | 2 | message types, framing, `ts-rs` export | fixed |
| `extension/src/wire.gen.ts` | new | 2 | generated from `wire.rs` | fixed |
| `host/src/native_host.rs` | new | 3 | stdio and socket relay | expected |
| `extension/manifest.json` | new | 4 | MV3, pinned `key`, permissions | fixed |
| `extension/src/background.ts` | new | 4 | native port, dispatch, tab groups | expected |
| `extension/claim.html` | new | 4 | the claim page | fixed |
| `host/src/profiles.rs` | new | 5 | `Local State` reader, socket discovery | expected |
| `host/src/mcp.rs` | new | 5 | tool router | expected |
| `host/src/install.rs` | new | 6 | host manifest writer | expected |

*Reused, not rewritten:* the repository holds only `reference/`, which is
read for tool names and schemas (`reference/claude-in-chrome/tools/tools.json`)
and copied into our tool descriptions where they still apply; no code exists
to extend. Searched crates.io for a native messaging framing crate:
`native_messaging` 0.3.0 exists, but the framing is a four-byte prefix shared
with the socket, so one codec in `wire.rs` serves both
(`docs/external/rust-ipc.md` § Native messaging framing).

## Contract

Authoritative: `docs/protocol.md`, held by `host/src/wire.rs` and the
generated `extension/src/wire.gen.ts`. Every frame on the socket and the
native port is one JSON object:

```text
call     {"type":"call","id":u64,"session":"<uuid>","tool":"<name>","args":{...}}
result   {"type":"result","id":u64,"ok":true,"content":[Content...]}
         {"type":"result","id":u64,"ok":false,"error":{"code":"<code>","message":"..."}}
Content  {"type":"text","text":"..."}
         {"type":"image","data":"<base64>","mimeType":"image/png","imageId":"<id>"}
hello    {"type":"hello","protocol":1,"profileDir":"<dir>"|null,"extensionVersion":"x.y.z","instance":"<uuid>"}
claimed  {"type":"claimed","profileDir":"<dir>","nonce":"<n>"}
chunk    {"type":"chunk","id":u64,"seq":u32,"last":bool,"data":"<base64>"}
end      {"type":"end","session":"<uuid>"}
```

Error codes: `not_connected`, `no_tab`, `debugger_refused`, `timeout`,
`bad_args`, `page_error`. Any host-to-extension frame over 1 MB is split into
`chunk` frames of at most 786,432 data characters, because Chrome closes the
port above 1,048,576 bytes (`docs/external/chrome-native-messaging.md`
§ Limits). `protocol` is bumped on any breaking change; a host and MCP with
different `protocol` refuse with `not_connected` and say why.

## Edge cases

- Profile has no extension installed: the claim times out after 10 s and
  `select_profile` says to load the extension into that profile.
- Chrome not running: `select_profile` launches it with the profile.
- Stale socket file from a killed host: `connect` fails, the file is removed.
- Two MCP sessions in one profile: separate tab groups, never each other's
  tabs.
- A tab group's last tab closed by the user: the next `tabs_context` with
  `createIfEmpty` starts a new group.

## Rollback

`browser-hand install --uninstall` removes the host manifest; removing the
unpacked extension from each profile removes the rest. No stored data beyond
`chrome.storage.local` in the extension.

## Risks

- The claim launch may not route as source suggests: Phase 1 proves it before
  anything depends on it (decision 5).
- `rmcp` moves fast (three majors in 2026): pinned to the minor version.

## Declined

- CDP remote debugging port and Playwright persistent context (decision 1):
  both fail the must of driving the user's running profiles.
- Extension WebSocket to localhost (decision 1): lost on security and
  reliability.
- Node and Bun for the host (decision 2): 23 and 14 times Rust's idle memory,
  per host process.
- Plain JavaScript and Rust-to-wasm for the extension (decision 3).
- MCP server as the listener (decision 4): several sessions per profile.
- Email match and on-disk storage scan for profile identity (decision 5):
  failed musts.
- Newline-delimited JSON and MessagePack framing (decision 6).

## What the tests hold

`wire.rs` round-trips every frame type and splits and rejoins chunks at the
1 MB boundary; the TS side decodes the same fixtures. The host relays a call
from two socket clients to a fake native port and returns each result to the
client that sent it. `profiles.rs` parses a fixture `Local State` and pairs
profiles with live sockets. The extension's dispatcher keeps each session's
tabs in its own group, tested against a `chrome` API fake. The walk in Phase 6
is the only check against real Chrome.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove rmcp and the Chrome bridge (needs you at Chrome)

- [ ] `scripts/prove/rmcp-stdio.sh` builds the minimal rmcp 3.5 server kept
  in the repo at `scripts/prove/rmcp-stdio/` (its own `Cargo.toml`, one
  `main.rs`, no project code), pipes an initialize and `tools/list` into it
  over stdio and prints `PASS` when one tool with an image result comes back,
  per `docs/external/rmcp.md` § stdio transport.
- [ ] `scripts/prove/chrome-bridge.sh` builds the echo host and installs its
  manifest from `scripts/prove/chrome-bridge/` (an echo extension with a
  pinned `key` and a one-file Rust echo host, both kept in the repo), then,
  once you have loaded that extension unpacked into two profiles, launches
  its `claim.html` into each with `--profile-directory` and prints `PASS` when
  both claims arrive with the right `dir`, per
  `docs/external/chrome-native-messaging.md` and
  `docs/external/chrome-profiles-and-launch.md`. It removes its manifest after,
  and `.gitignore` keeps the proof crates' `target/` out.
- [ ] Check: both scripts exit 0 and print `PASS`; if the claim fails,
  decision 5 is reopened before Phase 2.

### Phase 2: the wire contract

- [ ] `docs/protocol.md` written from `## Contract`, and the frames, codec
  and chunker land in `host/src/wire.rs`, pinned by `host/tests/wire.rs`.
- [ ] `extension/src/wire.gen.ts` generated by `ts-rs` from `wire.rs`, with an
  extension decoder test reading the same fixtures (`extension/test/wire.test.ts`).
- [ ] Check: `cargo test` and `npm --prefix extension test` pass.

### Phase 3: the native host relays

- [ ] `browser-hand native-host` reads frames on stdin, listens on
  `$TMPDIR/bh/<pid>.sock` in a `0700` directory, sends `hello` to each
  client, rewrites call ids per client and routes results back (expected in
  `host/src/native_host.rs`), pinned by `host/tests/relay.rs`.
- [ ] The host removes its socket on exit and on stdin EOF; its idle RSS with
  one socket client is recorded in `docs/research/runtime-baseline.md`.
- [ ] Check: `cargo test` passes and the RSS line is under 20 MB.

### Phase 4: the extension connects and claims

- [ ] `extension/manifest.json` with a pinned `key` (so the ID is stable,
  `docs/external/chrome-extension-apis.md` § Manifest `key`) and only this
  plan's permissions; the service worker connects the native port on install
  and startup and sends `hello` (expected in `extension/src/background.ts`).
- [ ] `claim.html` stores its `dir` and sends `claimed`; `tabs_context`,
  `tabs_create`, `tabs_close` and `navigate` act only inside the session's
  `browser-hand` tab group, pinned by `extension/test/tabs.test.ts`.
- [ ] Check: `npm --prefix extension run build` emits `extension/dist/` and
  `npm --prefix extension test` passes.

### Phase 5: the MCP server lists and selects profiles

- [ ] `list_profiles` reads `Local State` and reports each profile's dir,
  name, last used and whether a live socket claims it (expected in
  `host/src/profiles.rs`), pinned by `host/tests/profiles.rs` on a fixture.
- [ ] `select_profile` binds the session to a connected profile, or launches
  the claim and waits up to 10 s, and the tab tools forward to that socket
  (expected in `host/src/mcp.rs`), pinned by `host/tests/mcp.rs` against a
  fake host.
- [ ] Check: `cargo test` passes.

### Phase 6: install and the walk (needs you at Chrome)

- [ ] `browser-hand install` writes the `dev.browserhand.host` manifest
  pointing at the built binary, and `--uninstall` removes it (expected in
  `host/src/install.rs`); `README.md` says how to load the extension unpacked.
- [ ] Walk, recorded under `## Verified` in this plan: with the extension in
  two profiles and the server added via `claude mcp add`, Claude lists the
  profiles, selects each in turn, opens a tab, navigates and closes it, and
  the other profile's windows stay untouched.
- [ ] Check: `## Verified` in `plans/plan-bridge.md` records the walk as
  `passed`, with what was seen.

### Phase 7: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

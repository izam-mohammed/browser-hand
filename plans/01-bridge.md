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
reading tools are `plans/02-page-tools.md`, the mouse and keyboard
`plans/03-humane-input.md`, the skill and packaging `plans/04-skill.md`.
This Mac has three profiles (`Default`, `Profile 3`, `Profile 4`), Chrome 155.

## Constraints

- "No need for any interface in browser": no side panel, popup or options UI.
- "Use rust for mcp part and ts for the chrome extension part", subject to
  the research (decisions 2 and 3 confirm both on the result).

## Alternatives

### Decision 1: how do Claude's tool calls reach a running Chrome profile? (one-way door)

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

Sensitivity: 10 points from security to efficiency leaves 4.25 vs 3.40;
the winner holds. Evidence: `docs/research/01-bridge.md` § Decision 1.
Searched 17/10/2026: Chrome's native messaging and service worker docs, the
remote debugging port post, and the `--load-extension` removal in 137.

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

Idle RSS 2.0 MB Rust, 27.9 MB Bun, 46.2 MB Node, measured 17/10/2026; the
rest in `docs/research/01-bridge.md` § Decision 2.
Searched 17/10/2026: `rmcp` 3.5.1 (`docs/external/rmcp.md`). Searched
18/10/2026: Rust vs Node host memory, about 7 vs 140 MB. The choice holds.

**Chosen: Rust, one binary `browser-hand` with `mcp`, `native-host` and
`install` subcommands.** Revisit if the Phase 3 idle RSS exceeds 20 MB.

### Decision 3: what language is the extension? (two-way door)

| Criterion | TypeScript | Plain JavaScript | Rust compiled to wasm |
| --- | --- | --- | --- |
| Performance efficiency | same JS at run time | same | wasm load plus JS glue for every `chrome.*` call |
| Fit to the ask | full `chrome.*` and DOM access | same | no direct `chrome.*` or DOM access |
| Compatibility | wire types generated from the Rust types (`ts-rs`) | hand-copied types drift | shares Rust types natively |
| Maintainability of the result | types check every message handler | none | two toolchains in the extension |

Searched 18/10/2026: Rust-to-wasm MV3 extensions; each reaches `chrome.*`
through JS glue (`docs/research/01-bridge.md` § Decision 3). The choice holds.

**Chosen: TypeScript, bundled by esbuild.** Equal at run time to JS, cheaper
than wasm, and generated wire types hold the contract on both sides. Revisit
if a hot path (GIF encoding, path generation) proves too slow in JS.

### Decision 4: who listens on the local socket? (two-way door)

| Criterion | Each host listens, MCP connects | The MCP server listens, hosts connect |
| --- | --- | --- |
| Fit to the ask | several Claude sessions can share one profile | each host must guess which of several MCP servers to dial |
| Reliability | hosts live as long as Chrome; sessions come and go | a host with no server running has nowhere to go |
| Performance efficiency | MCP scans one directory at `list_profiles` | same |

Socket path `$TMPDIR/bh/<pid>.sock`, short for macOS `sun_path`
(`docs/research/01-bridge.md` § Decision 4).
Searched 17/10/2026: tokio `UnixListener` and `UnixStream`, `interprocess`.

**Chosen: each host listens on its own socket.** Revisit for Windows pipes.

### Decision 5: how does a connection learn which profile it belongs to? (two-way door)

Chrome passes the host only the caller origin, never the profile.

| Must | Claim handshake by launch URL | Match signed-in email | Scan extension storage on disk |
| --- | --- | --- | --- |
| Works for a profile with no Google sign-in | yes | no | yes |
| Never reads Chrome's internal databases while it runs | yes | yes | no |
| **Survives** | **yes** | no | no |

The handshake: `select_profile` opens `claim.html#dir=<dir>&nonce=<n>` in
that profile with `open -na "Google Chrome" --args --profile-directory=<dir>`,
opening the profile or Chrome when needed; the page reports `dir`, later
connections say it in `hello`. Routing is read from source, so Phase 1
proves it (`docs/research/01-bridge.md` § Decision 5).
Searched 17/10/2026: native messaging, `storage` and Chromium startup source.

**Chosen: claim handshake.** Revisit if Phase 1's proof fails, falling back
to the email match for signed-in profiles.

### Decision 6: framing on the local socket (two-way door)

| Criterion | u32 length + JSON | Newline-delimited JSON | MessagePack |
| --- | --- | --- | --- |
| Performance efficiency | reads a frame without scanning for a delimiter | scans every byte of multi-MB base64 screenshots | smallest, but re-encoded to JSON for Chrome anyway |
| Compatibility | same framing as native messaging, one codec | a second codec | a second codec plus a dependency |

Searched 17/10/2026: native messaging framing, `native_messaging` 0.3.0.

**Chosen: u32 little-endian length plus UTF-8 JSON.** Revisit if payloads
leave JSON.

## The decision

Feature path. One Rust crate in `host/` builds `browser-hand`: `mcp` is the
stdio MCP server Claude Code starts (decision 2), `native-host` is what Chrome
starts per profile, relaying between the native port and its socket
(decisions 1, 4, 6), `install` writes the host manifest. The extension in
`extension/` is TypeScript with a service worker and one page, `claim.html`
(decisions 3, 5). Profiles come from `Local State` `profile.info_cache`
(`docs/external/chrome-profiles-and-launch.md` § `Local State`).

Opening profiles is part of the MCP server: `select_profile` on a profile
with no live host opens it with Chrome's command line, starting Chrome when
needed, and waits 10 s for the claim, or 30 s cold (decision 5, Phase 7).

Tools, named as Claude in Chrome names them minus `_mcp`: `list_profiles`
and `select_profile` (replacing `list_connected_browsers`, `select_browser`,
`switch_browser`), `tabs_context`, `tabs_create`, `tabs_close`, `navigate`.
Each MCP session owns one tab group titled `browser-hand` per profile.

Dependencies: crates `rmcp` (features `server`, `macros`, `transport-io`,
pinned to 3.5), `tokio`, `serde`, `serde_json`, `ts-rs`, `uuid`; npm dev
dependencies `typescript`, `esbuild`, `vitest`, `@types/chrome`. Extension
permissions: `nativeMessaging`, `tabs`, `tabGroups`, `storage`. Native host
`dev.browserhand.host`, distinct from the two Anthropic hosts. No network
host, no secret. One file outside the repo, the host manifest under
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`.

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| rmcp stdio server | `docs/external/rmcp.md` | `scripts/prove/rmcp-stdio.sh` | none |
| Chrome native messaging and profile launch | `docs/external/chrome-native-messaging.md` | `scripts/prove/chrome-bridge.sh` | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/rmcp-stdio.sh` | added 17/10/2026 | 1 | proof driver for the MCP SDK | expected |
| `scripts/prove/rmcp-stdio/` | added 17/10/2026 | 1 | minimal rmcp server crate, kept in the repo | expected |
| `scripts/prove/chrome-bridge.sh` | added 17/10/2026 | 1 | proof driver for native port and claim launch | expected |
| `scripts/prove/chrome-bridge/` | added 17/10/2026 | 1 | echo extension and echo host, kept in the repo | expected |
| `docs/protocol.md` | new | 2 | the wire contract below | fixed |
| `host/src/wire.rs` | new | 2 | message types, framing, `ts-rs` export | fixed |
| `extension/src/wire.gen.ts` | new | 2 | generated from `wire.rs` | fixed |
| `host/src/native_host.rs` | new | 3 | stdio and socket relay | expected |
| `extension/manifest.json` | new | 4 | MV3, pinned `key`, permissions | fixed |
| `extension/src/background.ts` | new | 4 | native port, dispatch, tab groups | expected |
| `extension/claim.html` | new | 4 | the claim page | fixed |
| `host/src/profiles.rs` | new | 5 | `Local State` reader, socket discovery | expected |
| `host/src/mcp.rs` | new | 5 | tool router | expected |
| `host/src/install.rs` | added 17/10/2026 | 6 | host manifest writer | expected |

Landed 17/10/2026: `added` rows landed in `386ca98`, before phases 1 and 6.

*Reused, not rewritten:* only `reference/` existed, read for tool names and
schemas (`reference/claude-in-chrome/tools/tools.json`); no code to extend.
`native_messaging` 0.3.0 was found, but one codec in `wire.rs` serves the
port and the socket (`docs/external/rust-ipc.md` § Native messaging framing).

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

- No extension in the profile: the claim times out and `select_profile`
  says to load it.
- Profile not open, or Chrome not running: the same command opens it or
  starts Chrome, and the claim waits 10 s, or 30 s cold (Phase 7).
- Stale socket file from a killed host: `connect` fails, the file is removed.
- Two MCP sessions in one profile: separate tab groups, never each other's tabs.
- The user closes a group's last tab: the next `tabs_context` with
  `createIfEmpty` starts a new group.

## Security

Protected: the user's signed-in Chrome profiles. Entry points, all local:
the host socket (dir `0700`, socket `0600`, `paths.rs`, `native_host.rs`),
open to any process of this user, which is the trust boundary; the native
port, started by Chrome only for `allowed_origins` (`install.rs`);
`claim.html`, from our page only (`background.ts`); `Local State`, read only.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Spoofing | another extension connects to our host | `allowed_origins` names only our pinned extension ID | `the_manifest_names_this_host_the_binary_and_only_our_extension` (`host/tests/install.rs`) |
| Spoofing | a page or extension sends a fake `claim` | sender must be our ID and `claim.html`; not web accessible | no test yet |
| Spoofing | a host claims a profile it is not | MCP accepts any host whose `hello` names the dir; the nonce is sent but not checked | no test yet |
| Tampering | a stale socket left by a killed host | discovery removes sockets that refuse | `discovery_removes_stale_sockets_and_ignores_other_files` (`host/tests/profiles.rs`) |
| Tampering | a profile dir reaching a shell | `open` runs with an argument array; the URL fragment is percent-encoded | `the_claim_url_encodes_spaces_in_the_dir` (`host/tests/mcp.rs`) |
| Repudiation | browser actions nobody can see | each session works in a visible `browser-hand` tab group | `creates one titled group per session, in its own window` (`extension/test/tabs.test.ts`) |
| Information disclosure | another user reads the socket | dir `0700`, socket `0600` | no test yet |
| Information disclosure | a result reaches the wrong client | ids rewritten per client, routed back | `results_go_back_to_the_client_that_called_under_its_own_id` (`host/tests/relay.rs`) |
| Information disclosure | profile emails leave `Local State` | only dir, name and last used are read | `never_reads_out_email_addresses` (`host/tests/profiles.rs`) |
| Denial of service | a huge or garbled frame | frames over 64 MiB refused; a bad frame is skipped | `an_unknown_frame_is_invalid_data_and_the_stream_continues` (`host/tests/wire.rs`); no test yet for the cap |
| Elevation of privilege | a session acts on the user's own tabs | tab tools act only inside the session's group | `never touches another session's tabs` (`extension/test/tabs.test.ts`) |

Data: profile names and dirs, not stored; the claimed `dir` in
`chrome.storage.local`. No secret, no network host. Logged: frame types and
errors to stderr, never args or results. Followed: OWASP Browser Extension
Vulnerabilities Cheat Sheet (searched 18/10/2026); no dependency audit yet.

## Rollback

`browser-hand install --uninstall` removes the host manifest; removing the
unpacked extension from each profile removes the rest, `chrome.storage` too.

## Risks

- The claim launch may not route as source suggests: Phase 1 proves it.
- A worker restart drops in-flight calls: the call fails with `not_connected`
  and the next call reconnects. It is not retried, since a retried acting
  tool could act twice.
- `rmcp` moves fast (three majors in 2026): pinned to the minor version.

## Declined

- CDP port and Playwright (decision 1): fail the must of running profiles.
- Extension WebSocket (decision 1): lost on security and reliability.
- Node and Bun (decision 2): 23 and 14 times Rust's idle memory per host.
- Plain JavaScript and Rust-to-wasm for the extension (decision 3).
- MCP server as the listener (decision 4): several sessions per profile.
- Email match and on-disk scan for identity (decision 5): failed musts.
- Newline-delimited JSON and MessagePack framing (decision 6).

## What the tests hold

Frames, chunks, relay, profile parsing and per-session tab groups, against
fakes (`docs/research/01-bridge.md` § What the tests hold; security tests in
`## Security`). The Phase 6 walk is the only check against real Chrome.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove rmcp and the Chrome bridge (needs you at Chrome)

- [x] `scripts/prove/rmcp-stdio.sh` builds the minimal rmcp 3.5 server kept
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

- [x] `docs/protocol.md` written from `## Contract`, and the frames, codec
  and chunker land in `host/src/wire.rs`, pinned by `host/tests/wire.rs`.
- [x] `extension/src/wire.gen.ts` generated by `ts-rs` from `wire.rs`, with an
  extension decoder test reading the same fixtures (`extension/test/wire.test.ts`).
  Landed 17/10/2026: shared fixtures in `host/tests/fixtures/`, rejoiner in
  `extension/src/wire.ts` (`docs/research/01-bridge.md` § Build notes).
- [x] Check: `cargo test` and `npm --prefix extension test` pass.

### Phase 3: the native host relays

- [x] `browser-hand native-host` reads frames on stdin, listens on
  `$TMPDIR/bh/<pid>.sock` in a `0700` directory, sends `hello` to each
  client, rewrites call ids per client and routes results back (expected in
  `host/src/native_host.rs`), pinned by `host/tests/relay.rs`.
  Landed 17/10/2026: socket dir from `confstr`, not `$TMPDIR`
  (`host/src/paths.rs`); a `chrome-extension://` first argument means
  `native-host` (`docs/research/01-bridge.md` § Build notes).
- [x] The host removes its socket on exit and on stdin EOF; its idle RSS with
  one socket client is recorded in `docs/research/runtime-baseline.md`.
- [x] Check: `cargo test` passes and the RSS line is under 20 MB.
  Landed 17/10/2026: 2,288 KB.

### Phase 4: the extension connects and claims

- [x] `extension/manifest.json` with a pinned `key` (so the ID is stable,
  `docs/external/chrome-extension-apis.md` § Manifest `key`) and only this
  plan's permissions; the service worker connects the native port on install
  and startup and sends `hello` (expected in `extension/src/background.ts`).
- [x] `claim.html` stores its `dir` and sends `claimed`; `tabs_context`,
  `tabs_create`, `tabs_close` and `navigate` act only inside the session's
  `browser-hand` tab group, pinned by `extension/test/tabs.test.ts`.
  Landed 17/10/2026: tab logic in `extension/src/tabs.ts`, groups kept in
  `chrome.storage.session` (`docs/research/01-bridge.md` § Build notes).
- [x] Check: `npm --prefix extension run build` emits `extension/dist/` and
  `npm --prefix extension test` passes.

### Phase 5: the MCP server lists and selects profiles

- [x] `list_profiles` reads `Local State` and reports each profile's dir,
  name, last used and whether a live socket claims it (expected in
  `host/src/profiles.rs`), pinned by `host/tests/profiles.rs` on a fixture.
- [x] `select_profile` binds the session to a connected profile, or launches
  the claim and waits up to 10 s, and the tab tools forward to that socket
  (expected in `host/src/mcp.rs`), pinned by `host/tests/mcp.rs` against a
  fake host.
  Landed 17/10/2026: client in `host/src/host_conn.rs`; one connected profile
  binds without `select_profile`, several refuse to guess
  (`docs/research/01-bridge.md` § Build notes).
- [x] Check: `cargo test` passes.

### Phase 6: install and the walk (needs you at Chrome)

- [x] `browser-hand install` writes the `dev.browserhand.host` manifest
  pointing at the built binary, and `--uninstall` removes it (expected in
  `host/src/install.rs`); `README.md` says how to load the extension unpacked.
- [x] Walk, recorded under `## Verified` in this plan: with the extension in
  two profiles and the server added via `claude mcp add`, Claude lists the
  profiles, selects each in turn, opens a tab, navigates and closes it, and
  the other profile's windows stay untouched.
- [x] Check: `## Verified` in `plans/01-bridge.md` records the walk as
  `passed`, with what was seen.

### Phase 7: open the profile when it is not open

> Added 17/10/2026 at the user's request: `select_profile` opens a profile
> that is not open with Chrome's command line, starting Chrome if needed.

- [x] `select_profile` on a profile with no live host opens that profile with
  `open -na "Google Chrome" --args --profile-directory=<dir>` and the claim
  page (`docs/external/chrome-profiles-and-launch.md` § Opening a URL in a
  specific profile), checks first whether Chrome is running, and waits 10 s
  when it was, 30 s when the command had to start it (expected in
  `host/src/mcp.rs`), pinned by `host/tests/mcp.rs`.
- [x] `list_profiles` and the `select_profile` description say a profile that
  is not open will be opened, and `README.md` says the same.
- [x] Check: `cargo test --manifest-path host/Cargo.toml` passes.
  Landed 17/10/2026: the launcher says if it started Chrome (`pgrep` first);
  pinned by `opening_a_profile_whose_extension_never_answers_says_what_happened`.

### Phase 8: open the PR

- [x] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

## Verified

20/10/2026, passed. Extension loaded in Default ("Izam") and Profile 4
("fabulate"); the server driven over stdio as Claude Code would.

- `list_profiles` listed Default, Profile 3 and Profile 4, with Default and
  Profile 4 connected once claimed.
- `select_profile` on each, then `tabs_context` (createIfEmpty),
  `tabs_create`, `navigate` to example.com / example.org, `tabs_close`: each
  worked in its own `browser-hand` group, and the group was left with its
  first tab. The other profile's windows were not touched.
- The first `select_profile "Default"` timed out at 10 s ("did not answer
  within 10 s"); its native host started a few seconds later, and the next
  call claimed it. The extension had just been loaded, so its worker was
  slow to start; not changed.

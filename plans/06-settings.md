# the person sets how Claude drives Chrome on one settings page, and every profile follows it

## The ask

"Plan the settings page, as designed." Asked 19/10/2026; the design is in
Penpot (project `browser-hand`, file `Settings`), exported to `design/`
(`settings--light.png`, `--dark`, `--editing`, `--saved`,
`--disconnected`, `tokens--sheet.png`), with colours and type in
`design/theme.md`. It shows 13 settings in five sections, saved by the host
to `~/.config/browser-hand/config.toml` for every Chrome profile, a
Connected pill, an unsaved-changes bar, a Saved toast and a read-only
disconnected state (`docs/research/06-settings.md` § What the design asks
for). Six settings have no code behind them (typing and mouse speed,
default profile, new window off, close tabs on end, blocked and read-only
sites); this plan builds that behaviour too (§ Where each setting lives
today).

## Constraints

- "No need for any interface in browser" (17/10/2026). Plan 05 made its
  Record button the one exception. The settings page, asked for on
  19/10/2026, is a second: an extension page reached from Chrome's own
  menus (right-click the toolbar button, Options; or `chrome://extensions`,
  Details). It adds nothing to web pages, no popup, and no Record control.
  > Amended by `08-recorder-popup.md`: the toolbar button now has a popup
  > (Start recording, past recordings, a Settings link that opens this
  > page); this page still holds no Record control. See § Amended,
  > 21/10/2026 below.
- Build to the design; add no setting it does not show.
- `design/theme.md` is the source for the CSS as it is for Penpot.
- Site rules are "Enforced in the extension, so a request from the server
  cannot get past it" (the design).

## Alternatives

Evidence, sensitivity and risk for every decision are in
`docs/research/06-settings.md` under the same headings. Behaviours with one
approach have no table: the default profile binds where `Server::call`
binds the only connected profile today; new window off groups a tab in
`windows.getLastFocused`; close tabs removes the group's tabs where
`TabTools.end` forgets the group.

### Decision 1: where the page lives (two-way door)

Searched 19/10/2026: "chrome extension options_ui open_in_tab vs
options_page"; the options guide (`docs/external/chrome-extension-apis.md`
§ Options page). Musts (a full tab as drawn; plan 05's `onClicked` still
fires) remove embedded `options_ui` and an action popup.

| Criterion | Weight | `options_ui` in a tab | `options_page` |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 5 |
| Fit to the design | 30 | 5 | 5 |
| Reversibility | 30 | 5 | 4 |
| **Weighted total** | **100** | **5.00** | **4.70** |

**Chosen: `options_ui` with `open_in_tab: true`, at `options.html`.**
Revisit if the person wants it inside `chrome://extensions`.

### Decision 2: where settings are stored (one-way door)

Searched 19/10/2026: "chrome.storage.sync quota across profiles"; the
storage reference. Musts (every profile; the MCP server reads it with no
profile bound) remove `storage.sync` and `storage.local`.

| Criterion | Weight | `config.toml` by the host (the design's pick) | Hybrid: file plus per-profile site lists |
| --- | ---: | ---: | ---: |
| Performance efficiency | 35 | 5 | 4 |
| Fit to the design | 25 | 5 | 3 |
| Security | 25 | 3 | 4 |
| Reliability | 15 | 4 | 3 |
| **Weighted total** | **100** | **4.35** | **3.60** |

**Chosen: `config.toml`, written only by the native host on a request from
the settings page; the extension keeps the last copy it saw.** Revisit if
Claude is seen editing the file.

### Decision 3: how settings travel (one-way door)

Searched 19/10/2026: "chrome extension sendNativeMessage vs connectNative
process per message"; Chrome's native messaging guide, `docs/protocol.md`.
Musts (the server cannot leave out a site rule; works with no Claude
session) remove settings passed by the MCP server in each call.

| Criterion | Weight | New frames on the open port | `sendNativeMessage` |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 3 |
| Fit to the design | 25 | 5 | 3 |
| Reliability | 20 | 4 | 4 |
| Compatibility | 15 | 4 | 3 |
| **Weighted total** | **100** | **4.65** | **3.20** |

**Chosen: `settings`, `settings_set` and `settings_saved` frames on the
native port (Contract); `protocol` stays 1, as peers skip unknown frames.**
Revisit if saving must work while the port is down.

### Decision 4: how other profiles hear of a change (two-way door)

Searched 19/10/2026: "rust notify crate macOS FSEvents atomic rename";
notify's README. The must (a new block applies in every open profile
within seconds) removes reading only at connect.

| Criterion | Weight | Poll mtime every 2 s | `notify` crate |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 4 | 5 |
| Reliability | 35 | 5 | 4 |
| Security | 25 | 5 | 3 |
| **Weighted total** | **100** | **4.60** | **4.15** |

**Chosen: each native host stats the file every 2 s and pushes a changed
one.** Revisit past ten profiles at once.

### Decision 5: the file's parser (two-way door)

Searched 19/10/2026: "toml crate rust latest toml_edit serde"; docs.rs,
crates.io, OSV.dev (`docs/external/toml.md`). JSON fails the design's
`config.toml`.

| Criterion | Weight | `toml` 1.1.8 | `toml_edit` 0.25.17 |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 4 |
| Fit (keeps hand-written comments) | 35 | 3 | 4 |
| Security | 25 | 5 | 5 |
| **Weighted total** | **100** | **4.30** | **4.25** |

**Chosen: `toml`; fragile, broken on efficiency.** Revisit if people edit
the file by hand.

### Decision 6: where site rules are enforced (two-way door)

Searched 19/10/2026: "chrome declarativeNetRequest session rules tabIds";
the DNR reference and permissions list
(`docs/external/chrome-extension-apis.md` § chrome.declarativeNetRequest).
The must (a link Claude clicks cannot load a blocked site) removes the tool
gate alone.

| Criterion | Weight | Gate plus DNR session rules on Claude's tabs | Gate plus `webNavigation` redirect |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 3 |
| Reliability | 35 | 4 | 3 |
| Security | 25 | 4 | 5 |
| **Weighted total** | **100** | **4.40** | **3.50** |

**Chosen: every tool checks the tab's URL first, and blocked patterns
become session rules (`main_frame`, `sub_frame`) for tabs in browser-hand
groups, under `declarativeNetRequestWithHostAccess` (no warning).** Revisit
if the proof shows rules miss `tabs.update`.

### Decision 7: pattern syntax and matching (two-way door)

Searched 19/10/2026: "URLPattern hostname wildcard apex domain"; MDN
URLPattern. Chrome match patterns fail the must (the design's patterns have
no scheme).

| Criterion | Weight | Own glob, compiled once | URLPattern |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 4 | 4 |
| Reliability (gate and DNR agree) | 60 | 5 | 3 |
| **Weighted total** | **100** | **4.60** | **3.40** |

**Chosen: the grammar in Contract, compiled to one regex for the gate and
the DNR `regexFilter`.** Revisit if a pattern needs a port or query.

### Decision 8: keeping the CSS in step with theme.md (two-way door)

Searched 19/10/2026: "generate CSS custom properties from design tokens
markdown table Style Dictionary"; every tool found reads JSON tokens. A
Penpot export fails the must that `theme.md` is the source.

| Criterion | Weight | Generated at build from `theme.md` | Hand-written, checked by a test |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 5 |
| Reliability (cannot drift) | 35 | 5 | 4 |
| Maintainability of the result | 25 | 5 | 3 |
| **Weighted total** | **100** | **5.00** | **4.15** |

**Chosen: `extension/build.mjs` writes `src/options/theme.gen.css` from
`design/theme.md`, committed like `wire.gen.ts`.** Revisit if a second page
needs tokens.

### Decision 9: the page's code (two-way door)

Searched 19/10/2026: "preact bundle size gzip vs lit vs vanilla"; etch.co's
build comparison.

| Criterion | Weight | Plain TypeScript and DOM | Preact |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 4 |
| Security (no new dependency) | 25 | 5 | 4 |
| Maintainability of the result | 35 | 3 | 5 |
| **Weighted total** | **100** | **4.30** | **4.35** |

**Chosen: plain TypeScript, one `render(state)` per section; fragile, 0.05
apart, broken on efficiency as the method says.** Revisit if the page grows
past five sections.

### Decision 10: fonts (two-way door)

Searched 19/10/2026: "JetBrains Mono latest release woff2 OFL"; the
JetBrains Mono releases page.

| Criterion | Weight | Bundled Inter and JetBrains Mono | System fonts |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 4 | 5 |
| Fit to the design | 60 | 5 | 2 |
| **Weighted total** | **100** | **4.60** | **3.20** |

**Chosen: Inter copied from `host/assets/` at build, JetBrains Mono v2.304
Regular in `extension/fonts/`, both OFL.** Revisit if extension size
matters.

### Decision 11: pace when `BROWSER_HAND_PACE` is set (two-way door)

Searched 19/10/2026: "MCP server environment variable vs config file
precedence"; servers that read both mostly let the variable win.

| Criterion | Weight | Env var overrides that server | Settings only |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 5 |
| Fit (the page shows the truth) | 35 | 3 | 5 |
| Compatibility (README setups keep working) | 25 | 5 | 2 |
| **Weighted total** | **100** | **4.30** | **4.25** |

**Chosen: the server sends `pace` only when `BROWSER_HAND_PACE` is set;
fragile, broken on reversibility.** Revisit once README drops the variable.

## The decision

The page is an `options_ui` tab (1) on a `runtime.connect` port to the
service worker; the worker and its native host exchange three new frames
(3); the host owns `config.toml` (2, 5) and polls it (4); the MCP server
reads the same file when it needs a value. Site rules are checked before
every tool and enforced in the network stack for Claude's tabs (6, 7). CSS
is generated from `theme.md` (8), plain TypeScript (9), bundled fonts (10).
"Not connected" is the worker's real port state: no `settings` frame since
`connectNative`, or `onDisconnect` fired.

New permissions: `declarativeNetRequestWithHostAccess` (no warning); the
`options_ui` and `icons` manifest keys. New dependencies: the `toml` crate
1.1.8; JetBrains Mono v2.304 (OFL). New stored data: `config.toml`, mode
`0600`; one `storage.local` key `settings:last`, at most 64 KB, which shares
the `storage.local` budget plan 05 sets for recordings.

Standards: `docs/standards.md` (types, vitest, cargo test, build, through
`npm --prefix extension test && cargo test --manifest-path host/Cargo.toml
&& sh scripts/build.sh`).

## How this plan and plan 05 affect each other

- Plan 05 lands first (root `PLAN.md`) and does not wait on this one: it
  lists blocked sites as a follow-up, and Phase 4 here makes its recorder
  skip blocked tabs.
- Icons: plan 05 lands `extension/icons/` (16 and 32 px); Phase 6 here adds
  48 and 128 px and the manifest `icons` key.
- Storage: `settings:last` counts against plan 05's `storage.local` budget.
- Replay (plan 05 Phase 4) passes the same tool gate and uses the pace set
  here.

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| Options page, declarativeNetRequest session rules | `docs/external/chrome-extension-apis.md` | `scripts/prove/site-rules.sh` | none |
| `toml` crate | `docs/external/toml.md` | `scripts/prove/config-toml.sh` | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/site-rules.sh`, `scripts/prove/config-toml.sh` | new | 1 | proofs, with their folders | expected |
| `host/src/config.rs` | new | 2-5 | load, validate, save, poll | expected |
| `host/src/wire.rs`, `extension/src/wire.gen.ts`, `docs/protocol.md` | edit | 2 | three frames, `blocked` code | fixed |
| `host/src/native_host.rs` | edit | 2, 5 | send, save, push settings | expected |
| `host/src/mcp.rs`, `host/src/gif.rs`, `host/src/tools/images.rs` | edit | 2, 3 | pace, default profile, GIF values | expected |
| `extension/options.html`, `extension/src/options/` | new | 2, 5, 6 | the page | expected |
| `extension/src/settings.ts`, `extension/src/sites.ts`, `extension/src/site-rules.ts` | new | 2, 4, 5 | store, matcher, DNR rules | expected |
| `extension/src/background.ts`, `extension/src/tabs.ts`, `extension/src/humane/params.ts` | edit | 2, 3 | settings take effect | expected |
| `extension/src/screenshot.ts`, `extension/src/debugger.ts` | edit | 3 | size, quality, idle | expected |
| `extension/manifest.json`, `extension/build.mjs`, `design/theme.md` | edit | 2, 4, 6 | key, permission, icons, CSS, `global` table | expected |
| `extension/fonts/` | new | 6 | Inter, JetBrains Mono | expected |
| `host/tests/config.rs`, `extension/test/settings.test.ts`, `extension/test/sites.test.ts`, `extension/test/theme.test.ts` | new | 2-6 | tests | expected |

*Reused, not rewritten:* `Server::call`'s binding, `do_select_profile` and
`claim` (default profile); `Input`'s `Params` argument (speeds);
`TabTools.ownTab` (the gate); `gif::output_dir` and `images::save`;
`DebuggerManager`'s `idleMs`; `fitScale`'s `MAX_WIDTH` and `MAX_HEIGHT`;
the claim page's sender check and `GroupStore` in `background.ts`. Searched
`host/src`, `extension/src` and `scripts/` for a config loader, URL pattern
matcher, options page or CSS tokens: none exist.

## Contract

`config.toml`; a missing file or key is the default, an unknown key is
dropped:

```toml
# Written by the browser-hand settings page. Edits here apply too.
version = 1
[input]
pace = "human"          # or "fast"
typing_speed = 1.0      # 0.25 to 3.0, multiplies the gap between keys
mouse_speed = 1.0       # 0.25 to 3.0, multiplies the cursor's travel time
[sessions]
default_profile = ""    # a Chrome profile dir; "" asks
new_window = true
close_tabs_on_end = false
[sites]
blocked = []            # each list: 200 patterns, 100 characters each
read_only = []
[capture]
screenshot_size = "1280x800"   # or "1024x640", "1568x980"
screenshot_quality = 80        # 30 to 100
gif_folder = "~/Downloads/browser-hand"
gif_frame_delay_ms = 700       # 100 to 5000
[debugger]
detach_after_idle_s = 30       # 5 to 600
```

Frames (`docs/protocol.md`); `settings` holds the file's keys:

```text
settings        host->ext {"type":"settings","settings":{...},"revision":"<mtime ns>",
                  "path":"<abs>","profiles":[{"dir","name"}],"warnings":["<key>: ..."]}
settings_set    ext->host {"type":"settings_set","id":u64,"settings":{...},"revision":"<base>"}
settings_saved  host->ext {"type":"settings_saved","id":u64,"ok":bool,"path"?:"<abs>",
                  "error"?:{"field":"<key>"|null,"message":"..."}}
```

`settings_set` is taken only from the native port, never a socket client;
a stale `revision` is refused ("changed in another profile"). New error
code `blocked`: "<host> is blocked (or read-only) in browser-hand settings;
ask the person."

Pattern: `host/path`, `*` matches any run of characters, `*.x.com` also
matches `x.com`; no scheme, port or query; a `/` required; host compared
lower-case. Matched against the URL's host and path.

## Edge cases

- No file: defaults (today's constants); Save creates the folder
  (`XDG_CONFIG_HOME` honoured). A bad hand-edited value: that key falls
  back and the page shows the warning.
- An older host sends no `settings`: the pill reads Not connected and says
  the host is older than the extension.
- Read-only sites allow reading tools, `screenshot`, `zoom`, `scroll`,
  `scroll_to`; other `computer` actions, `form_input`, `javascript_tool`,
  `file_upload` and `upload_image` answer `blocked`.
- A redirect onto a blocked site: the tab goes to `about:blank` and the call
  answers `blocked`. A new tab from a group tab that lands on one before its
  rule exists: closed on `webNavigation.onCommitted`.
- `tabs_context` lists a blocked tab with no title or URL.
- A default profile that no longer exists: today's behaviour.

## Security

Entry points: the page (the person), the worker's page port,
`settings_set`, `config.toml` on disk, and every tool call (Claude).

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Elevation of privilege | Claude unblocks a site through MCP | socket clients' `settings_set` dropped; no settings tool | `host/tests/relay.rs` |
| Spoofing | a content script or page posts settings to the worker | only a port from this extension's `options.html` is served | `settings.test.ts` "refuses other senders" |
| Tampering | a malformed or huge `settings_set` | every field and cap validated; atomic write, `0600` | `host/tests/config.rs` |
| Elevation of privilege | a read-only site gets a click through `browser_batch` or replay | the gate sits under every tool in the worker | `sites.test.ts` |
| Information disclosure | a blocked tab's title reaches Claude | `tabs_context` hides it | `tabs.test.ts` |
| Tampering | `gif_folder` points somewhere odd | absolute after `~`, no `..`, only the page sets it | `host/tests/config.rs` |
| Elevation of privilege | Claude edits `config.toml` with Bash | residual; instructions and skill say never to | `host/tests/instructions.rs` |

Data: preferences and site patterns (which can name the person's bank or
employer), in a local file and extension storage, never sent to Claude.
Logged: nothing. Checklist: OWASP Top 10 for LLM Applications 2025 (LLM06
excessive agency).

## Rollback

Delete `config.toml` for the defaults. An older build ignores the file and
the frames and keeps reading `BROWSER_HAND_PACE` and
`BROWSER_HAND_OUTPUT_DIR`. Session rules end with the browser session.

## Declined

`options_page`, embedded options, a popup (1); `storage.sync`,
`storage.local`, the hybrid (2); `sendNativeMessage`, settings in each call
(3); `notify`, reading only at connect (4); `toml_edit`, JSON (5);
`webNavigation` redirects, the gate alone (6); URLPattern, match patterns
(7); a hand copy of the CSS, Style Dictionary (8); Preact, Lit (9); system
fonts (10); dropping `BROWSER_HAND_PACE` (11).

## What the tests hold

`host/tests/config.rs`: defaults, round trip, ranges, caps, the pattern
grammar, `gif_folder`, the write mode, revisions. `relay.rs` and `wire.rs`:
the frames, socket clients refused. `mcp.rs`: pace, default profile, GIF
values. `sites.test.ts`: matching, the gate per tool, DNR rules.
`settings.test.ts`: the store, sender check, connection state, the page's
states. `tabs.test.ts`, `humane.test.ts`, `tools.test.ts`: each setting's
effect. `theme.test.ts`: the CSS is fresh. Chrome is the proof and the walk.

## Open decisions

The person's to answer; the plan builds the default.

- The banner says "Start a Claude session"; the host comes from
  `browser-hand install`. Default: "Run `browser-hand install`, then Retry".
- Screenshot sizes beyond 1280 x 800: default 1024 x 640 and 1568 x 980.
- Slider ranges, and mouse speed's direction: default both multiply time
  (0.5 is twice as fast), 0.25 to 3.0.
- Hover on read-only sites: default refused; scroll allowed.
- Default profile "ask": default a first option "Ask each time".
- "Where recordings and saved screenshots go" means GIFs, not plan 05's
  step recordings: default caption "GIFs and saved screenshots".
- The app icon is not drawn: default a Penpot board `icon--app` (Phase 6).
- Claude can edit `config.toml` with Bash: default accept, as above.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove site rules and the parser (needs you at Chrome)

- [x] `scripts/prove/site-rules.sh` loads a proof extension in
  `scripts/prove/site-rules/` (no project code) with `options_ui` in a tab
  and `declarativeNetRequestWithHostAccess`, per
  `docs/external/chrome-extension-apis.md` § Options page and
  § chrome.declarativeNetRequest; `openOptionsPage` opens it, a rule with
  tab A's id blocks a link click, a `tabs.update` and an iframe in tab A
  but not tab B, and it prints `PASS` with each result.
  Headless on Chrome for Testing, 17/11/2026: options opened in a tab (Start button clicked over CDP); tab
  A's link, `tabs.update` and iframe all failed with
  `net::ERR_BLOCKED_BY_CLIENT`, and tab B loaded all three. Not shown:
  nothing found.
- [x] `scripts/prove/config-toml.sh` builds `scripts/prove/config-toml/`
  against `toml` 1.1.8, round-trips the Contract's file and prints a parse
  error's line and column, per `docs/external/toml.md`, then `PASS`.
  Landed 20/10/2026: prints `PASS`; the default features hold `from_str`
  and `to_string_pretty`, and an error reads "TOML parse error at line 3,
  column 14" with the line quoted (`docs/external/toml.md` § Errors).
- [x] Check: both print `PASS`; a rule that misses `tabs.update` is noted in
  `docs/research/06-settings.md` and the gate covers it.

Written 20/10/2026; not run yet, needs the person at Chrome. The site-rules
proof reports to a local server the script runs (`serve.py` on
127.0.0.1:8790, which also serves the pages and counts each request for
the blocked page) instead of a native host, so it needs no `key` and no
host manifest; the blocked host is `localhost:8790`, the same server under
another name.

### Phase 2: the rough cut (needs you: try it)

- [x] `config.toml` loads with defaults, validates and saves atomically,
  mode `0600` (expected in `host/src/config.rs`), pinned by
  `host/tests/config.rs`.
  Landed 20/10/2026: `config::parse` reads key by key, so a wrong type or a
  value out of range falls back alone with a warning, and a bad pattern
  drops only itself; a file that is not TOML at all keeps the native
  host's last good settings (the MCP server uses the defaults). The
  revision is the file's mtime in ns, "0" with no file. The path is
  `paths::config_path()`.
- [x] The three frames and `blocked` exist (expected in `host/src/wire.rs`,
  regenerating `extension/src/wire.gen.ts`, with fixtures and
  `docs/protocol.md`); the native host sends `settings` on the extension's
  hello and saves `settings_set` from Chrome only (expected in
  `host/src/native_host.rs`), pinned by `host/tests/relay.rs`.
  Landed 20/10/2026: `Frame`'s tag is now `snake_case` (one-word frames
  unchanged). `settings_set` carries its settings as JSON and is checked by
  key (`config::from_page`), so a bad value is refused with its field
  rather than the frame being skipped. After every `settings_set`, saved or
  refused, the host sends `settings` again. Socket clients' `settings_set`
  falls through the relay's catch-all and is dropped.
- [x] Options opens every section of `design/settings--light.png` with plain
  controls, a Connected pill and a Save that writes the file (expected in
  `extension/options.html`, `extension/src/options/` and
  `extension/src/settings.ts`), pinned by `extension/test/settings.test.ts`.
  Landed 20/10/2026: `extension/src/options/page.ts` (`SettingsPage`, plain
  DOM, one render function per section) on a `runtime.connect` port to
  `SettingsHub` in `extension/src/settings.ts`, which serves only ports
  from this extension's `options.html`. Profiles for the default profile
  come in the `settings` frame from Chrome's `Local State`.
- [x] Pace follows the setting unless `BROWSER_HAND_PACE` is set, and a
  blocked site is refused by `navigate` and every tab tool (expected in
  `extension/src/sites.ts`, `extension/src/tabs.ts`, `host/src/mcp.rs`),
  pinned by `extension/test/sites.test.ts` and `host/tests/mcp.rs`.
  Landed 20/10/2026: the server sends `pace` only when `BROWSER_HAND_PACE` is
  set (any value but `fast` is `human`); the extension uses the settings
  otherwise. The gate is `TabTools.ownTab(session, tab, use)` with
  `useFor(tool, args)` from `sites.ts`; `navigate` checks the target URL
  and never refuses leaving a site, and `tabs_close` is never refused.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 20/10/2026: 188 extension tests and 97 host tests pass; of
  `scripts/build.sh` the build steps ran (`cargo build --release`,
  `npm --prefix extension run build`) but not its `install`, which writes
  under `~/Library` and was left for the person.
- [x] You try it: reload the extension, right-click its button, Options,
  set Pace to Fast and block a site you use, Save, open
  `~/.config/browser-hand/config.toml`, then ask Claude to open that site
  and to click something elsewhere. Say whether the page and the refusal
  read right.

### Phase 3: every setting takes effect

- [x] Typing and mouse speed scale a copy of `PARAMS` that open tabs'
  `Input` pick up (expected in `extension/src/humane/params.ts`), pinned by
  `extension/test/humane.test.ts`.
  Landed 20/10/2026: `scaledParams(typing, mouse)` multiplies the key gap's
  mean, SD, floor and word pause by typing speed, and Fitts's a and b by
  mouse speed; holds and dwells stay as measured. `Input.setParams` takes
  the new copy, and the worker gives it to every open tab's `Input`.
- [x] Read-only sites allow only Edge cases' reading tools (expected in
  `extension/src/sites.ts`), pinned by `sites.test.ts`.
  Landed 20/10/2026: as the Edge cases list them, so `computer` `wait` and
  `hover` are refused too; `resize_window` is allowed (it touches the
  window, not the page).
- [x] Screenshot size and quality and detach after idle follow the settings
  (expected in `extension/src/screenshot.ts`, `extension/src/debugger.ts`),
  pinned by `extension/test/tools.test.ts`.
  Landed 20/10/2026: `ShotPrefs` replaces `MAX_WIDTH`, `MAX_HEIGHT` and
  the JPEG quality for `fitScale`, `zoomScale`, `capture` and
  `captureVisible`; `DebuggerManager.setIdleMs` takes the idle time, from
  each tab's next use.
- [x] New window off groups a tab in the last focused window; close tabs
  removes the group's tabs on `end` (expected in `extension/src/tabs.ts`),
  pinned by `extension/test/tabs.test.ts`.
  Landed 20/10/2026: with new window off the group's first tab opens in the
  background (`active: false`) of `windows.getLastFocused` (normal
  windows), so it does not take the person's view; with no window open it
  falls back to a new one.
- [x] The MCP server binds the default profile when none is bound, and GIF
  export and saved screenshots use the file's folder and delay (expected in
  `host/src/mcp.rs`, `host/src/gif.rs`), pinned by `host/tests/mcp.rs`;
  `README.md`, `host/src/instructions.md` and the skill describe the page,
  the override and never editing the file.
  Landed 20/10/2026: before any call with no profile bound, a default
  profile that Chrome still lists is selected as `select_profile` would,
  opening it when it is not connected. `BROWSER_HAND_OUTPUT_DIR` still
  overrides the GIF folder, as it did. Replay stops at a step that stands
  for a blocked site.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 20/10/2026: 188 extension tests and 97 host tests pass; of
  `scripts/build.sh` the build steps ran (`cargo build --release`,
  `npm --prefix extension run build`) but not its `install`, which writes
  under `~/Library` and was left for the person.

### Phase 4: site rules in the network stack

- [x] Blocked patterns become `main_frame` and `sub_frame` session rules
  for browser-hand group tabs, kept current as tabs and settings change,
  with the permission in `extension/manifest.json` (expected in
  `extension/src/site-rules.ts`), pinned by `sites.test.ts`.
  Landed 20/10/2026: `SiteRuleSync` rewrites the whole set (remove every
  old id, add one rule per pattern with every tab of every group titled
  browser-hand) on a settings change, `tabs.onUpdated` with a `groupId`,
  `tabs.onRemoved` and `tabGroups.onUpdated`; calls made together share
  one rewrite. The `regexFilter` comes from the same pieces as the gate's
  regex, pinned by a test that they agree.
- [x] Redirects, new tabs and `tabs_context` behave as Edge cases say
  (expected in `extension/src/tabs.ts`), pinned by `tabs.test.ts`.
  Landed 20/10/2026: `TabTools.committed` handles `webNavigation.onCommitted`
  for tabs of any browser-hand group: one with an opener is closed, an
  older one goes to about:blank.
- [x] Plan 05's recorder drops steps from blocked tabs and notes the gap
  (expected in `extension/src/recorder.ts`), pinned by
  `extension/test/record.test.ts`.
  Landed 20/10/2026: a step whose frame URL (`sender.url`) is blocked is
  dropped, and one stand-in step per stay (`navigate` to about:blank with
  `meta.blocked`) notes the gap, with no address; a recording started on a
  blocked page keeps no title. `recording_get` reads it as a gap.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 20/10/2026: 188 extension tests and 97 host tests pass; of
  `scripts/build.sh` the build steps ran (`cargo build --release`,
  `npm --prefix extension run build`) but not its `install`, which writes
  under `~/Library` and was left for the person.

### Phase 5: the states

- [x] Editing as `design/settings--editing.png`: the bar counts changes,
  Discard reverts, a bad pattern is refused inline with the design's words;
  saving as `design/settings--saved.png`: a 4 s toast with the path, and a
  stale revision says "changed in another profile" (expected in
  `extension/src/options/`), pinned by `settings.test.ts`.
  Landed 20/10/2026: one change per value and per pattern added or
  removed. A page with edits keeps them when the file changes elsewhere;
  saving then is refused as stale, and the page shows the file as it is
  now with a toast "Not saved: changed in another profile". The GIF delay,
  idle time and folder are checked on the page too; Save waits for them.
- [x] Disconnected as `design/settings--disconnected.png`: pill and banner
  follow the port, controls read-only from `settings:last`, Retry reconnects
  at once (expected in `extension/src/settings.ts`), pinned by
  `settings.test.ts`.
  Landed 20/10/2026: the banner says "Run browser-hand install, then Retry"
  (the Open decision's default) with Chrome's reason when there is one;
  an open port with no `settings` after 3 s reads as an older host. While
  the port is connecting the pill says Not connected and no banner shows.
- [x] Each native host polls the file every 2 s and pushes a change
  (expected in `host/src/config.rs`), pinned by `host/tests/relay.rs`.
  Landed 20/10/2026: in `host/src/native_host.rs` (`poll_loop`), reading
  `config::revision`; the file's functions are in `host/src/config.rs`.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 20/10/2026: 188 extension tests and 97 host tests pass; of
  `scripts/build.sh` the build steps ran (`cargo build --release`,
  `npm --prefix extension run build`) but not its `install`, which writes
  under `~/Library` and was left for the person.

### Phase 6: the look (needs you: the icon)

- [x] `design/theme.md` gains the `global` token table, and
  `extension/build.mjs` writes `extension/src/options/theme.gen.css` from
  it, pinned by `extension/test/theme.test.ts`.
  Landed 20/10/2026: the generator is `extension/theme.mjs` (typed by
  `theme.d.mts`), used by `build.mjs` and the test; the page's own CSS
  names no colour, also pinned.
- [x] The page matches `design/settings--light.png` and
  `design/settings--dark.png` in the system's mode, with fonts from
  `extension/fonts/` (expected in `extension/src/options/`), checked by eye.
  Landed 20/10/2026: checked against the exported PNGs from headless Chrome
  screenshots of the page (light, dark, editing, saved, disconnected) on a
  fake port, not yet in the extension itself. Inter is copied from
  `host/assets/` at build; JetBrains Mono v2.304 Regular (woff2) and its
  OFL are in `extension/fonts/`. The sliders put 1.0x at a quarter of the
  0.25 to 3.0 track, where the drawing has it in the middle.
- [x] The person draws Penpot board `icon--app` and exports
  `design/icon--app.png`; 48 and 128 px join plan 05's `extension/icons/`
  under the `icons` key in `extension/manifest.json`.
  Written 20/10/2026, not drawn yet: stand-ins `extension/icons/app-48.png`
  and `app-128.png` (the idle ring and dot in the accent orange, made with
  a standard-library script) are under the `icons` key until the board
  exists; 16 and 32 px use plan 05's idle icons.
  Landed 21/10/2026: board `icon--app` (128 px, x 7400 on the Settings
  page) is an accent-orange tile, radius 26, with a `#1C1C1A` cursor
  outlined in white. Penpot's exporter needs a password login or a
  connected tab, so `design/icon--app.png` was rendered from the same
  geometry with headless Chrome (transparent corners); `app-48.png` is it
  scaled down. 16 and 32 px still use plan 05's idle icons.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 20/10/2026: 188 extension tests and 97 host tests pass; of
  `scripts/build.sh` the build steps ran (`cargo build --release`,
  `npm --prefix extension run build`) but not its `install`, which writes
  under `~/Library` and was left for the person.

### Phase 7: the walk (needs you at Chrome)

- [x] In two profiles: change every setting in one and watch the other
  follow; have Claude try a link to a blocked site and a click on a
  read-only one; stop the host and see the disconnected state; a
  `## Verified` section here records the date and what each showed.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.

### Phase 8: open the PR

- [x] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

## Verified

21/10/2026, Profile 4 ("fabulate") and Default ("Izam"). passed.
Claude's tools cannot click or scroll the extension's own settings page
(only screenshots and key presses reach it), which keeps Claude from
changing its own settings, so the person made the changes.

- The person set Pace to Fast, blocked `example.com/*`, made
  `*.wikipedia.org/*` read-only and saved in fabulate. Their note on the
  page: it should not show where the settings are stored, in the header,
  the toast or any alert; only that they saved. Done: the intro is "Settings
  apply to every Chrome profile.", the toast says "Saved", and the
  warnings box no longer names `config.toml`.
- Both profiles followed: in fabulate and in Izam, `navigate` to
  `https://example.com` came back `blocked: example.com is blocked in
  browser-hand settings; ask the person.`
- A click on a link to `https://example.com/` on a local page left the tab
  on Chrome's "example.com is blocked" page (`ERR_BLOCKED_BY_CLIENT`),
  nothing from the site loaded, and every tool on that tab then answered
  `blocked`.
- On `https://en.wikipedia.org/wiki/Hand`, in both profiles,
  `get_page_text` and a screenshot worked; a click and `javascript_tool`
  came back `blocked: en.wikipedia.org is read-only in browser-hand
  settings: Claude may read it but not click, type or run scripts there;
  ask the person.`
- Fast pace took effect without a restart: clicks took 60 to 135 ms,
  against about 1 s at Human pace.
- The speed sliders, default profile, session toggles, capture and debugger
  settings were not changed in this walk; their effect is pinned by tests.

- The page opens in Claude's tab and shows "Connected" with the defaults
  (Human pace, 1.0x speeds, "Ask each time", new window on, close tabs
  off, no blocked sites).
- Disconnected state: the first try showed "Connected" with the host
  stopped. SIGTERM ended the host's select, but the process never exited:
  dropping the tokio runtime waited on the blocking thread that reads
  stdin, which Chrome still held open. Fixed in `host/src/main.rs` with
  `shutdown_background()`, pinned by `host/tests/signal.rs`. After the
  fix, with the host stopped and the binary moved away, the page showed
  "Not connected" and the banner "The browser-hand host is not running",
  with Chrome's own reason ("Specified native messaging host not found")
  and every control dimmed; with the binary back, it showed "Connected"
  again within 6 s.

## Amended, 21/10/2026: a popup on the toolbar button

This plan said no popup, because the only ask then was a settings page.
On 21/10/2026 the person asked for a small screen on the toolbar button to
start a recording, look back at recordings, and reach the settings.
`plans/08-recorder-popup.md` adds it: when not recording, the button opens
`popup.html`, styled from the same `theme.gen.css` tokens, whose Settings
link calls `chrome.runtime.openOptionsPage()`. Right-click, Options still
opens this page too. The settings page itself is unchanged.

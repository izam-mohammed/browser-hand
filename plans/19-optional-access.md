# Claude can use your browser's data and controls, each one switched on by you and revocable

## The ask

First: "a new plan with everything in the worth-adding list, with bookmarks
and history, no clipboard, windows and offscreen, and update each thing's
access revoke or the necessary updates in settings." Then, on the same
plan: all `sessions` things, tabs extras, `webRequest` response data, the
profile's user info, management of extensions, content settings and
privacy, response bodies, request controls, emulation, performance metrics,
page console logs and errors, all the page data a content script can read,
and the omnibox.

The list: `downloads`, a side panel, cookies (read only), alarms with
scheduled replays, page capture, notifications with an `ask_user` pause,
`idle`, history, bookmarks, `windows`, `offscreen`; and now `sessions`,
tabs extras, response headers and bodies, `identity` profile info,
`management`, `contentSettings`, `privacy`, request control, emulation,
performance, console details, page storage and page info, and the omnibox.

Read from the tree: the manifest holds ten permissions, all required
(`extension/manifest.json`); every setting is a key in `config.toml`, owned by
the host and shown on one page (`host/src/config.rs`,
`extension/src/settings.ts`, `extension/src/options/page.ts`); `chrome.windows`
is used by `resize_window` and `chrome.offscreen` only in the docs; console
messages come from a content-script buffer (`extension/src/page/console.ts`)
and URLs in network reads are redacted by `redactUrl` in
`extension/src/network.ts`; the debugger attaches only when a tool needs it
(`extension/src/debugger.ts`). Plan 17 (PR `#59`) adds `sites.allowed`,
`audit.*`, `capture.save_screenshots` and `browser-hand replay`, and this
plan builds on all four.

Built so far: `docs/built/BUILT-2026-11-20-1956.md` (plans 17 and 18 are
open PRs, not built).

## Constraints

- No clipboard access (asked).
- "Make sure all of this have proper access controls and everything in the
  settings": every capability below has a switch on the settings page, a
  grant where Chrome needs one, and a revoke; none is reachable otherwise.
- "Each profile will get separate things": the switches and limits are kept
  per profile, with a default for every profile beneath them.
- "Page console logs and errors over there": the console detail comes with
  the debugger tools, next to the performance metrics.
- "Make sure all works in Linux and Mac": both are built and walked (see
  `## Platforms`); nothing here may break the Windows build.
- Settings live in `config.toml`, never in a secret store: this plan adds no
  secret, token or environment variable (so nothing to add in Infisical, and
  the repository has no `.infisical.json`).

## Alternatives

### Decision 1: how is each capability gated? (one-way door: the manifest)

Eleven new APIs, several of them sensitive (`history`, `cookies`,
`bookmarks`). The person must be able to give and take back each one.

Searched 2026-11-20: "chrome extension optional_permissions request remove
user gesture"; developer.chrome.com `permissions` and "declare permissions"
(`docs/external/chrome-extension-apis.md` § Optional access).

| Must | A: optional permissions + a policy key | B: required permissions + a policy key | C: required, no key |
| --- | --- | --- | --- |
| Off really removes the permission | yes (`permissions.remove`) | no (the permission stays held) | no |
| No new install-time warning | yes | no ("read your browsing history") | no |
| **Survives** | **yes** | no | no |

| Criterion | Weight | A | B | C |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency (tool-call overhead) | 30 | 4 | 5 | 5 |
| Security (least privilege, real revoke) | 35 | 5 | 2 | 1 |
| Reliability (no drift, no extra clicks) | 20 | 3 | 5 | 5 |
| Fits the settings model | 15 | 4 | 5 | 3 |
| **Weighted total** | **100** | **4.15** | **3.95** | **3.30** |

- A efficiency 4: one `permissions.contains` before a gated call; unmeasured,
  Phase 1 records it.
- A reliability 3: Chrome keeps grants per profile, so each profile needs one
  click, and the person can revoke in `chrome://extensions`.
- B and C fail the first must by construction: a required permission cannot
  be removed (`permissions.remove` docs).

Sensitivity: with efficiency 25, security 25, reliability 40 and fit 10, B
(4.25) beats A (3.85). It holds only if the per-profile click is judged worse than a
permanently held permission; the person asked for revoke, so A stays.
Risk: a grant a person revokes in Chrome leaves the policy on; the tool then
fails with `permission_missing` and says where to grant it again.

**Chosen: A.** The policy is `[access]` in `config.toml` (every profile); the
grant is Chrome's, per profile, asked for by a click on the settings page.
Revoke: switching a policy off removes the permission in every profile as its
worker sees the change. Revisit if the click per profile proves a chore.

### Decision 2: what runs a scheduled replay? (two-way door)

Searched 2026-11-20: `chrome.alarms` docs; plan 17 Decision 1
(`browser-hand replay`); "launchd cron Task Scheduler vs browser alarms".

| Must | Extension alarms | OS scheduler (cron, launchd, Task Scheduler) | An always-on host daemon |
| --- | --- | --- | --- |
| Replays with no model in the loop | yes (calls the plan 17 replay) | yes | yes |
| Only what the person scheduled, listed in the settings page | yes | yes (a second place to look) | yes |
| **Survives** | **yes** | **yes** | **yes** |

| Criterion | Weight | Alarms | OS scheduler | Daemon |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency (idle cost) | 40 | 5 | 5 | 2 |
| Reliability (runs when Chrome is closed) | 30 | 3 | 5 | 4 |
| Containment (revoked by one switch, stays in Chrome) | 30 | 5 | 2 | 3 |
| **Weighted total** | **100** | **4.40** | **4.10** | **2.90** |

- Alarms reliability 3: they fire only while Chrome runs; a missed one fires
  once on wake (`alarms` docs). Missed runs are shown as missed, never hidden.
- OS scheduler containment 2: it edits the person's crontab or Task Scheduler,
  outside the browser and outside the one switch.

Sensitivity: with efficiency 20, reliability 50 and containment 30, the OS
scheduler (4.10) beats alarms (4.00); `v0.3.0` would then add it. Risk: a hostile page makes
Claude schedule repeated actions; so Claude has no tool to create a
schedule (`## Security`).

**Chosen: extension alarms**, schedules created only by the person on the
settings page, run through the plan 17 replay. Revisit when missed runs
bite.

### Decision 3: how are pages and cookies read without the debugger bar? (one-way door: tool shapes)

Reading tools never attach the debugger, so Chrome's "started debugging this
browser" bar shows only while Claude acts (`README.md`).

Searched 2026-11-20: `chrome.pageCapture`, `chrome.cookies`, `tabCapture`
docs; CDP `Page.captureSnapshot` and `Network.getCookies`.

| Must | pageCapture / cookies API | CDP snapshot and cookies | `get_page_text` | `tabCapture` |
| --- | --- | --- | --- | --- |
| No debugger bar | yes | no (attaches) | yes | yes |
| Keeps images and layout (an archive) | yes (MHTML) | yes | no (text only) | n/a (video) |
| Starts with no click from the person | yes | yes | yes | no (needs the extension invoked) |
| **Survives** | **yes** | no | no | no |

Single survivor.

**Chosen: `pageCapture` for archives and `cookies` for cookie status.** `tabCapture` is declined for the same reason the table
shows: Claude cannot start it. Cookie values are never returned (names,
flags and expiry only), so the narrower API is also the safer one.

### Decision 4: how does Claude ask the person? (two-way door)

Searched 2026-11-20: `chrome.notifications` and `chrome.sidePanel` docs.

| Must | Notification | Side panel only | Overlay drawn in the page |
| --- | --- | --- | --- |
| Reaches a person not looking at Chrome | yes | no | no |
| Cannot be drawn or clicked by the page | yes | yes | no |
| **Survives** | **yes** | yes (fails the first) | no |

| Criterion | Weight | Notification | Side panel only |
| --- | ---: | ---: | ---: |
| Performance efficiency (time to see and answer) | 40 | 4 | 2 |
| Reliability across macOS, Linux, Windows | 30 | 4 | 4 |
| Containment | 30 | 4 | 5 |
| **Weighted total** | **100** | **4.00** | **3.50** |

- Side panel efficiency 2: `sidePanel.open()` needs a user gesture, so it
  cannot open itself when Claude asks (`docs/external`).

**Chosen: a notification with two buttons, plus the side panel** (opened by
the person from the popup or a shortcut) that shows the same question and
Claude's current step with a stop button. Revisit if a platform drops
notification buttons.

### Decision 5: which reads need the debugger? (one-way door: tool shapes)

Reading tools never attach the debugger, so Chrome's "started debugging this
browser" bar shows only while Claude acts (`README.md`). These tools are
asked for beyond that.

Searched 2026-11-20: CDP `Network.getResponseBody`, `Emulation`,
`Performance.getMetrics`, `Log` and `Runtime.exceptionThrown` domains;
`chrome.webRequest` response body support in MV3; `PerformanceObserver`.

| Must | Extension API or content script | CDP (debugger) |
| --- | --- | --- |
| Read a response body | no (`webRequest` has no body in MV3) | yes (`Network.getResponseBody`) |
| Emulate geolocation, timezone, locale, throttling | no | yes (`Emulation`) |
| JS heap, layout and node counts | no | yes (`Performance.getMetrics`) |
| Console stack traces, CSP and deprecation messages | partial (`console.*` and `window.onerror` only) | yes (`Log`, `Runtime`) |
| Response headers | yes (`webRequest` with `responseHeaders`) | yes |
| Load timing, resource timing, Web Vitals | yes (`performance`, `PerformanceObserver`) | yes |
| **Survives** | all of them | the first four |

**Chosen: a split.** Response headers, load timing and Web Vitals use the
extension and content scripts (no bar); response bodies, emulation, heap and
layout metrics and console details use the debugger, with the bar showing
only while one of them runs. Each is its own switch, so someone who wants
no bar leaves them off.

### Decision 6: how does Claude control requests? (one-way door: rule shapes)

Searched 2026-11-20: `chrome.declarativeNetRequest` (session rules, already
used in `extension/src/site-rules.ts`) and CDP `Fetch`.

| Criterion | Weight | DNR session rules | CDP `Fetch` |
| --- | ---: | ---: | ---: |
| Performance efficiency (cost per request) | 40 | 5 | 2 |
| Capability (block, redirect, headers, mock a body) | 30 | 3 | 5 |
| Containment (tab-scoped, no body reads, no bar) | 30 | 5 | 3 |
| **Weighted total** | **100** | **4.40** | **3.20** |

- DNR efficiency 5: matched in the browser, no round trip to the worker;
  `Fetch` pauses every matching request until the worker answers
  (unmeasured, Phase 1 records it).
- DNR capability 3: block, redirect and header rules; a mock only by
  redirecting to a `data:` URL, unverified.

**Chosen: DNR session rules**, scoped to Claude's tab ids, ten rules at
most, ending with the session; `Cookie` and `Authorization` headers can
never be set. A `mock` rule ships only if the proof shows the `data:`
redirect works. Revisit if mocking real bodies matters.

### Decision 7: how are writes confirmed? (one-way door: the tool contract)

`extensions` enable and disable, `site_permissions` and `privacy_settings`
changes change what protects the person.

Searched 2026-11-20: OWASP LLM Top 10 on excessive agency; plan 17
Security; `chrome.notifications` (above).

| Must | Switch only | Claude calls `ask_user` first | Confirmation built into the tool |
| --- | --- | --- | --- |
| A hostile page cannot cause an unconfirmed change | no | no (the model may skip the call) | yes |
| Works with no side panel open | yes | yes | yes |
| **Survives** | no | no | **yes** |

Single survivor. **Chosen: every write asks the person itself, with a
notification, before it runs**, and fails `confirm_unavailable` when
`access.notifications` is off or not granted. Writes also only tighten:
the settable names and values are an allow-list in code, and anything that
loosens (granting camera, microphone, location or notifications to a site,
allowing third-party cookies, enabling a disabled extension that the person
disabled) is refused.

### Decision 8: how does a typed task reach Claude? (two-way door)

The omnibox keyword `bh` lets the person type in the address bar. Claude
Code only calls tools; nothing can wake it.

Searched 2026-11-20: `chrome.omnibox` docs (a manifest keyword, input
events, suggestions); Claude Code MCP (pull only, `docs/external/
claude-code-mcp-and-skills.md`).

| Must | An inbox Claude reads with a tool | Start `claude -p` from the host |
| --- | --- | --- |
| Needs no process the person did not start | yes | no |
| Nothing a hostile page can trigger | yes (only omnibox input) | no |
| **Survives** | **yes** | no |

Single survivor. **Chosen: `bh <recording name>` replays it (plan 17's
replay), `bh ask <text>` leaves a note in an inbox (20 notes, 500
characters each) that Claude reads with `inbox`, and `bh stop` stops the
run.** The keyword is in the manifest, which cannot be optional, so the
handlers do nothing and the suggestions say "turned off" until the switch is
on.

### Decision 9: where does per-profile policy live? (one-way door: config shape)

Searched 2026-11-20: plan 06 Decision 1 (host owns `config.toml`), plan 15
(`<browser>:<dir>` names), `chrome.permissions` (grants are per profile).

| Must | A: sparse overrides in `config.toml` | B: each profile's `storage.local` | C: one file per profile |
| --- | --- | --- | --- |
| The host can refuse a call itself | yes | no (only the extension sees it) | yes |
| Editable from one settings page | yes | no | yes |
| **Survives** | **yes** | no | **yes** |

| Criterion | Weight | A | C |
| --- | ---: | ---: | ---: |
| Performance efficiency (parse and poll cost) | 30 | 4 | 3 |
| Reliability (one atomic write, no drift between files) | 30 | 5 | 3 |
| Containment (a profile cannot read another's policy) | 20 | 3 | 4 |
| Fits the settings model of plan 06 | 20 | 5 | 2 |
| **Weighted total** | **100** | **4.30** | **3.00** |

- A containment 3: the host and the settings page see every profile's
  policy; profile names are already public to Claude through
  `list_profiles`.

**Chosen: A.** `[profiles."<browser>:<dir>"]` tables beside the defaults,
each holding only what differs. A profile's value is its own key if set,
else the default, else the built-in `false`.

## The decision

- D1: new APIs go in `optional_permissions`; `[access]` holds one boolean per
  capability, default `false`; a policy on plus no grant in this profile is
  `permission_missing`.
- D2: schedules are made on the settings page only and stored in the
  profile's `storage.local`; an alarm tells the host to run the plan 17
  replay.
- D3: `save_page` uses `pageCapture`; `cookies_status` uses `cookies`;
  `sessions`, `history`, `bookmarks`, `identity`, `management`,
  `contentSettings` and `privacy` are plain extension APIs.
- D4: `ask_user` sends a notification and waits for a button.
- D5: response headers, load timing and Web Vitals need no debugger; response
  bodies, emulation, heap and layout metrics and console details do.
- D6: request control is DNR session rules on Claude's tabs.
- D7: every write confirms itself with a notification and only tightens.
- D8: the omnibox keyword `bh` replays, leaves a note in an inbox, or stops.
- D9: policy is per profile, as sparse overrides in `config.toml`; the host
  checks it before it sends a call, and the extension checks it again.
- No clipboard.
- No lanes: every part edits `config.rs`, `mcp.rs`, `args.rs` and the
  settings page, so the files are not disjoint.
- Permissions added to the manifest as optional: `downloads`, `cookies`,
  `history`, `bookmarks`, `sessions`, `identity`, `identity.email`,
  `pageCapture`, `notifications`, `sidePanel`, `alarms`, `idle`,
  `offscreen`, `management`, `contentSettings`, `privacy`. The manifest also
  gains the `omnibox` keyword. Tabs extras, response data, response bodies,
  request control, emulation, performance and page data use permissions the
  extension already holds. No new host, secret or Rust or npm package.

Standards: `docs/standards.md` (format, lint, types, tests, coverage floors,
audit, secrets, docs, site), through `make check`.

## Settings map

Every row is a switch under Settings, Access, with a grant chip where it
needs a permission and a "confirms each time" mark where it writes. All
default off, per profile.

| Group | Switch (`access.`) | Permission to grant | Confirms | Limits (settings keys) |
| --- | --- | --- | --- | --- |
| Browser data | `downloads` | `downloads` | no | none |
| | `history` | `history` | no | `history.max_days`, `history.max_results` |
| | `bookmarks` | `bookmarks` | no | none |
| | `sessions` | `sessions` | no | none |
| | `cookies` | `cookies` | no | none (names only) |
| | `profile_info` | `identity`, `identity.email` | no | none |
| | `page_capture` | `pageCapture`, `offscreen` | no | `capture.page_folder` |
| Page data | `page_storage` | none | no | `page.storage_values` (off: names and sizes only) |
| | `page_info` | none | no | none |
| Network | `response_headers` | none | no | none |
| | `response_bodies` | none | no | `bodies.max_kb` |
| | `request_control` | none | no | none (ten rules) |
| Debugger | `emulation` | none | no | none |
| | `performance` | none | no | none |
| | `console_details` | none | no | none |
| Tabs and windows | `tabs_extras` | none | no | none |
| | `windows` | none | no | `windows.allow_focus` |
| Browser control | `extensions` / `extensions_write` | `management` | write: yes | none |
| | `site_permissions` / `site_permissions_write` | `contentSettings` | write: yes | none |
| | `privacy` / `privacy_write` | `privacy` | write: yes | none |
| Asking you | `notifications` | `notifications` | n/a | none |
| | `side_panel` | `sidePanel` | no | none |
| | `idle` | `idle` | no | `idle.quiet_s` |
| | `omnibox` | none (manifest keyword) | no | none |
| | `schedules` | `alarms` | no | schedules are made on the page |

Also on the page, per profile: **Turn everything off**, **Grant all** (the
switched-on ones, one click), **Copy from another profile**, **Reset to the
default**; and for every profile: the same defaults, with **Turn everything
off for every profile**. A row shows the profile it applies to, and each
connected profile's grant state (`granted`, `not granted`, `unknown` for a
closed profile).

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| Optional permissions and the extension APIs | `docs/external/chrome-extension-apis.md` § Optional access | `scripts/prove/optional-access.sh` | none |
| Chrome DevTools Protocol domains | `docs/external/chrome-debugger-cdp.md` | `scripts/prove/cdp-diagnostics.sh` | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/optional-access.sh`, `cdp-diagnostics.sh` | new | 1 | request, use and remove permissions; bodies, emulation, metrics | expected |
| `extension/manifest.json` | edit | 2 to 9 | `optional_permissions`, `side_panel`, `omnibox` | fixed |
| `host/src/config.rs` | edit | 2 to 9 | `[access]`, the limits, `[profiles.*]`, resolution, problems | fixed |
| `host/src/wire.rs` | edit | 2 | `settings` carries the profile's effective values; `settings_set` names a profile or the default; `hello` reports grants | fixed |
| `host/src/tools/args.rs`, `host/src/mcp.rs` | edit | 2 to 9 | the tools, the host-side gate, the error codes | expected |
| `extension/src/access.ts` | new | 2 | policy, grant state, the gate every new tool passes | expected |
| `extension/src/tools/` (`downloads.ts`, `cookies.ts`, `history.ts`, `bookmarks.ts`, `sessions.ts`, `profile.ts`, `archive.ts`, `windows.ts`, `ask.ts`, `tabs-extras.ts`, `extensions.ts`, `site-permissions.ts`, `privacy.ts`) | new | 2 to 8 | one file per tool | expected |
| `extension/src/page/storage.ts`, `extension/src/page/info.ts` | new | 4 | page storage and page info | expected |
| `extension/src/page/content.ts` | edit | 4 | route the two new ops | expected |
| `extension/src/network.ts` | edit | 5 | response headers | expected |
| `extension/src/diagnostics.ts` | new | 7 | bodies, metrics, console details, emulation | expected |
| `extension/src/request-control.ts` | new | 7 | DNR rules, ten at most | expected |
| `extension/src/omnibox.ts`, `extension/src/inbox.ts` | new | 6 | keyword handlers and the inbox | expected |
| `extension/src/offscreen.html`, `offscreen.ts`, `panel/`, `schedule.ts` | new | 5, 6, 9 | MHTML to text; side panel; alarms | expected |
| `extension/src/settings.ts`, `extension/src/options/page.ts` | edit | 2 to 10 | the Access section, profile picker, chips, revoke | expected |
| `extension/src/popup/` | edit | 6 | "Watch Claude" opens the panel | expected |
| `extension/build.mjs` | edit | 5, 6 | offscreen and panel entries | expected |
| `docs/book/src/guides/access.md` | new | 12 | each switch, grant and revoke, per profile | expected |
| `docs/book/src/reference/`, `SECURITY.md`, `docs/store-listing.md`, `README.md`, `plugin/skills/browser-hand/SKILL.md`, `host/src/instructions.md` | edit | 12 | words and the generated reference | expected |

*Reused, not rewritten:*

- `host/src/config.rs` `take`, `problems`, `reset`, `folder_problem_in`: the
  new keys parse, validate and reset through them; the version stays 1 (new
  keys default off).
- `extension/src/sites.ts` `gate` and `SiteRules`: blocked sites hide their
  history, bookmarks, sessions, cookies, downloads and bodies too; no second
  matcher.
- `extension/src/site-rules.ts` `sessionRules`: request control extends the
  same DNR session-rule code.
- `extension/src/network.ts` `redactUrl` and `SECRET_KEY`: every new URL,
  header and body field is redacted by them.
- `extension/src/page/console.ts` `ConsoleBuffer`: console details add stack
  and source to it; no second buffer.
- `extension/src/debugger.ts`: bodies, emulation and metrics attach and
  detach through it, so the idle detach still applies.
- `extension/src/settings.ts` port and `settings_set`: the Access section
  saves through them.
- `host/src/tools/images.rs` `save`: writes the archive into the folder.
- Plan 17's replay and audit: schedules and the omnibox call the first; every
  new tool writes the second.
- Searched for `optional_permissions`, history, bookmarks, sessions, alarms,
  omnibox, `contentSettings` and `management` code in `extension/src` and
  `host/src`: none.

## Contract

Binding; every other name here is a suggestion.

```toml
[access]            # the default for every profile; all false
downloads = false
history = false
bookmarks = false
sessions = false
cookies = false
profile_info = false
page_capture = false
page_storage = false
page_info = false
response_headers = false
response_bodies = false
request_control = false
emulation = false
performance = false
console_details = false
tabs_extras = false
windows = false
extensions = false
extensions_write = false
site_permissions = false
site_permissions_write = false
privacy = false
privacy_write = false
notifications = false
side_panel = false
idle = false
omnibox = false
schedules = false

[windows]
allow_focus = false         # Claude may bring a window to the front

[idle]
quiet_s = 5                 # 1 to 60, used when access.idle is on

[history]
max_days = 30               # 1 to 365, the furthest back a search may go
max_results = 50            # 1 to 200

[page]
storage_values = false      # page_storage returns values, still masked

[bodies]
max_kb = 64                 # 1 to 512, per response body

[capture]
page_folder = ""            # "" means capture.gif_folder

# One table per profile, holding only what differs from the above.
[profiles."chrome:Profile 1".access]
history = true
[profiles."chrome:Profile 1".history]
max_days = 7
```

A profile's value for a key is its own if set, else the default above, else
the built-in `false`. A key under `[profiles."<name>"]` for a profile that is
not installed is kept, shown as "profile not found" with a Remove button, and
ignored.

Wire, owned by `host/src/wire.rs` and held by `host/tests/wire.rs`:
`settings` carries the receiving profile's effective values and its profile
name; `settings_set` carries a profile name or none (the default); `hello`
carries `grants`, the permissions the profile holds. The host checks the
effective policy for the selected profile before it forwards a call, and the
extension checks it again; either one fails the call.

Tools (arguments, then reply; all fail `access_off`, `permission_missing`
or `confirm_unavailable` as below):

| Tool | Arguments | Reply |
| --- | --- | --- |
| `downloads` | `action` `list` or `wait`, `name_contains`, `since_s`, `timeout_s` (1 to 120, default 30) | items with `id`, `name`, `path`, `bytes`, `mime`, `state`, `host`; no file contents |
| `history_search` | `text`, `days` (1 to `max_days`), `max_results` | `title`, `url`, `last_visit`, `visits` |
| `bookmarks_search` | `query`, `max_results` | `title`, `url`, `folder` |
| `sessions` | `action` `recent`, `devices` or `reopen`, `id` | recently closed tabs and windows and other devices' tabs (title, url, device name); `reopen` opens that URL in Claude's tab group, never in the person's window |
| `cookies_status` | `tabId` | `name`, `domain`, `path`, `secure`, `http_only`, `same_site`, `session`, `expires`; never `value` |
| `profile_info` | none | `email`, `profile` (never written to the audit log) |
| `save_page` | `tabId`, `text` | `{path, bytes, text?}` |
| `page_storage` | `tabId`, `area` `local` or `session`, `action` `keys` or `get`, `key` | key names and sizes; `get` and values only when `page.storage_values` is on, and values for keys matching `SECRET_KEY` or shaped like a token are `REDACTED` |
| `page_info` | `tabId`, `what` `meta`, `jsonld`, `forms`, `links`, `images` or `timing` | meta and Open Graph; JSON-LD; forms as field names, types, labels and the action host (never values); links and images with text, `alt` and size, queries redacted; navigation and resource timing and Web Vitals |
| `read_network_requests` | adds `headers` | response headers with `Set-Cookie`, `Authorization` and `Cookie` removed |
| `network_bodies` | `tabId`, `action` `arm`, `list` or `get`, `request_id`, `url_contains` | bodies of requests made after `arm`, cut to `bodies.max_kb`, secret fields masked |
| `request_control` | `tabId`, `action` `add`, `list` or `clear`, rule `{url_pattern, kind: block, redirect or set_header, ...}` | rule ids; at most ten; never `Cookie` or `Authorization`; never a blocked site |
| `emulate` | `tabId`, `width`, `height`, `scale`, `mobile`, `geolocation`, `locale`, `timezone`, `color_scheme`, `offline`, `throttle`, `reset` | what is set; undone at session end |
| `performance_metrics` | `tabId` | heap, nodes, layout and style counts, task duration |
| `read_console_messages` | adds `details` | stack, source and line, CSP and deprecation messages |
| `tab_actions` | `tabId`, `action` `zoom_get`, `zoom_set`, `mute`, `unmute`, `duplicate`, `discard` or `reload`, `bypass_cache`, `zoom` | state; only Claude's tabs; `tabs_context` also reports audible, muted, zoom and language |
| `windows` | `action` `list`, `arrange` or `focus`, `windowId`, `left`, `top`, `width`, `height`, `state` | only browser-hand windows |
| `extensions` | `action` `list`, `get`, `enable` or `disable`, `id` | name, version, enabled, permissions, install type; writes confirm; never itself or an admin-installed one |
| `site_permissions` | `action` `get` or `set`, `url`, `type`, `setting` | the setting; `set` confirms and only to `ask` or `block` |
| `privacy_settings` | `action` `get` or `set`, `name`, `value` | the value and who controls it; `set` confirms and only to values on the allow-list |
| `ask_user` | `question` (200 characters), `yes`, `no`, `timeout_s` (5 to 300, default 60) | `yes`, `no` or `timeout` |
| `inbox` | `action` `list` or `take`, `id` | notes typed with `bh ask`, 20 at most |
| `schedules_list` | none | `id`, `recording`, `when`, `repeat`, `last_run`, `state` (`ok`, `failed`, `missed`) |

- URLs in `history_search`, `bookmarks_search`, `sessions` and `downloads`
  have their query and fragment removed. Results for a blocked site are left
  out.
- Error codes: `access_off`, `permission_missing` (message: "Settings,
  Access, Grant"), `confirm_unavailable` (a write with `notifications` off
  or not granted), `declined` (the person said no), `not_yours` (a window or
  tab outside browser-hand), `person_active`, `stopped`, `busy`.
- Omnibox: keyword `bh`; `bh <recording name>` replays, `bh ask <text>` adds
  a note (500 characters), `bh stop` stops; suggestions list recordings.

Owner: this repository. Held by `host/tests/docs.rs` (the generated tool and
settings reference), `host/tests/wire.rs` and the extension tests for each
tool.

## Edge cases

- The person revokes a permission in `chrome://extensions`: the chip reads
  "not granted", the policy stays, and calls fail `permission_missing`.
- A policy is turned off for one profile: that profile's worker removes the
  permission when it sees the change, a closed profile does it on its next
  start, and other profiles are untouched.
- A profile has no override: it follows the default; the page says "uses the
  default" on each row.
- Two browsers share a profile directory name: keys are `<browser>:<dir>`
  (plan 15), so they never share policy.
- A profile is deleted or renamed: its table stays, marked "profile not
  found", and does nothing.
- Chrome refuses the grant prompt: the policy stays off and the row says so.
- The host is down: the Access rows are read only, like the rest of the page.
- `history_search` or `sessions` over a blocked site: omitted, as if never
  visited.
- `network_bodies` called before `arm`, or for a request made earlier:
  `none` with the reason; bodies are not kept after detach.
- A write with the notification dismissed or timed out: `declined`, nothing
  changed.
- `ask_user` while another is open: the second fails `busy`; more than one
  every 10 seconds is refused.
- `emulate` and `request_control` end with the session or when Claude's tab
  closes; a crash is covered by the session rules ending with the browser.
- `page_storage` on a site that blocks storage: an empty list, not an error.
- A page whose title, URL, storage key or note looks like an instruction:
  returned as data in a quoted field, and the tool text tells Claude to treat
  it as data.
- The omnibox with the switch off: the suggestion says "turned off" and
  Enter does nothing.
- `idle` on and the person never idles: `person_active` after 60 s.
- Notifications are blocked by the OS (macOS Notification Center off, a
  Linux desktop with no daemon): `ask_user` and every write end `declined`
  after the timeout, and the Notifications row says to send a test.
- `idle` cannot tell the person is active (some Wayland setups): input
  tools proceed, the row says so.
- A scheduled run whose recording was deleted: `failed`, with the reason; a
  missed alarm is `missed`, run once when Chrome starts, never skipped.

## Security

What is protected: the person's browsing history, sessions on other
devices, bookmarks, downloads, sign-in state, stored tokens, the profile's
email, other extensions, site permissions and browser privacy settings, and
their attention. Each tool can be reached only by Claude through the MCP
server, and each is off until the person turns it on for that profile and
clicks Grant in Chrome where a permission is needed.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | URLs in history, sessions, bookmarks, downloads and page links carry tokens | query and fragment stripped or `redactUrl`, results capped, blocked sites left out | a test with `?token=` and a blocked host for each tool |
| Information disclosure | cookie values, storage values and response bodies reach the model and transcripts | no cookie `value`; storage values off by default and masked; bodies capped, secret fields masked, only after `arm` | tests that no reply holds a value, a `Set-Cookie`, or a JWT-shaped string |
| Information disclosure | the profile's email | `profile_info` is its own switch and never reaches the audit log or logs | a test of the audit line |
| Elevation of privilege | a hostile page tells Claude to schedule repeated actions | no tool creates or changes a schedule; only the settings page does | a test that the tool list has no such tool |
| Elevation of privilege | Claude edits `config.toml` with a Bash command to turn a switch on | the permission still needs the person's click in each profile; the host and the extension both check | the proof: policy on, no grant, call fails `permission_missing` |
| Elevation of privilege | a hostile page makes Claude disable a security extension, loosen a site permission or a privacy setting | writes confirm themselves, only tighten, are on an allow-list, and skip the extension itself and admin-installed ones | tests that each loosening is refused and a "no" changes nothing |
| Elevation of privilege | request rules or emulation change what a signed-in page does | tab-scoped to Claude's tabs, ten rules, no `Cookie` or `Authorization` headers, undone at session end | tests of the scope, the header refusal and the cleanup |
| Spoofing | an injected question or note looks like the person's | the notification says "Claude asks"; a yes lifts no blocked, read-only or allow rule; inbox notes come only from the omnibox | a test that a yes unblocks nothing, and that a page cannot add a note |
| Denial of service | notification spam, body or rule floods | one open question, one every 10 s; body and rule caps | tests of the limits |
| Tampering | the policy is on but Chrome's grant is gone, or one profile's policy applied to another | the gate checks `permissions.contains` on every call; policy is read per profile | tests with the grant removed, and two profiles with different policy |
| Repudiation | a call nobody can trace | plan 17's audit line for every new tool (tool, action, result; never a query, URL, cookie, key, body or text) | the audit test with each tool |

Data: nothing new is stored except schedules and inbox notes in the
profile's `storage.local`. History, session, bookmark, cookie, storage and
body reads are never written to disk or to the audit log. Archives are
written only to `capture.page_folder`, with the folder checks
`folder_problem_in` already does. Secrets: none. Logged: tool, action,
result, time. Checklist: OWASP Top 10 for LLM Applications (prompt
injection, excessive agency) and the Chrome extension guidance on optional
permissions.

## Rollback

Settings keys default off and the version stays 1, so an older host ignores
them. Removing a capability: delete its tool and key, drop its entry from
`optional_permissions`, and the next load removes the permission. Archives
and downloads already on disk stay. The `[profiles.*]` tables can be deleted
by hand; every profile then follows the defaults.

## Open decisions

- Whether `sidePanel`, `offscreen`, `management`, `contentSettings`,
  `privacy` and `sessions` accept `optional_permissions`: default, yes; if
  the proof shows a manifest error, that one joins the required list, is
  gated by the policy only, and a `Landed` note says so.
- Whether the Access switches save at once or join the page's draft:
  default, at once, because the grant click must stay inside one gesture.
- Whether httpOnly cookies appear in `getAll`: default, listed with
  `http_only: true`; the proof checks.
- Whether a DNR `data:` redirect can mock a body: default, no `mock` kind
  ships unless the proof passes.
- Which `privacy` settings and values are on the tighten-only allow-list:
  default, `thirdPartyCookiesAllowed` to false, `doNotTrackEnabled` to
  true, `webRTCIPHandlingPolicy` to a stricter value; the list is a table
  in `privacy.ts` and each entry has a test.

## Platforms

Linux and macOS are both built and walked in Phase 11, on the browsers the
host already finds (Chrome, Chromium, Brave, Edge, Vivaldi). Windows stays
as plan 16 left it: no code here is Windows-only, and `make windows` keeps
compiling it; it is not walked.

| Piece | Linux | macOS | What the plan does |
| --- | --- | --- | --- |
| Notifications (`ask_user`, confirmed writes) | needs a notification daemon on the desktop; headless has none | Chrome must be allowed under System Settings, Notifications, and alerts (not banners) show buttons; unverified | the Notifications row has "Send a test notification"; with no answer a write is `declined`; the proof records both |
| Side panel, omnibox, popup | work; opened by a click or shortcut | the same | no difference expected; walked |
| `idle` | Wayland may never report idle (unverified) | works | if `queryState` never leaves `active` in the proof, the row says "not reliable on this system" and input tools do not wait |
| `sessions` devices | needs a signed-in, synced profile | the same | an empty list with the reason, never an error |
| Paths (`page_folder`, downloads) | `~` and `/` | `~` and `/` | `expand` in `config.rs` already handles both; replies carry the OS's own path |
| Profile names | `<browser>:<dir>` from each browser's data dir | the same | plan 15's names, unchanged |
| Debugger bar, DNR, `pageCapture`, cookies, history, bookmarks | the same on both | the same | no platform code |

## Risks

- A grant per profile is friction: the chips and **Grant all** keep it to
  one click per capability per profile.
- `alarms` fire only while Chrome runs: missed runs are shown, never hidden.
- Twenty-odd tools add to the prompt the server sends; `instructions.md`
  stays short, each description is one sentence, and the switches keep most
  tools out of `tools/list` for a profile that has them off.
- Debugger tools show Chrome's debugging bar while they run; the reading
  tools stay free of it.
- Chrome may change or withdraw an API (`contentSettings`, `privacy`); a
  failed call returns Chrome's words, and the row's description says what it
  needs.

## Declined

- Required permissions (decision 1): a held permission cannot be revoked.
- An OS scheduler and a daemon (decision 2): outside the one switch, or an
  idle cost.
- CDP snapshots and cookies for plain reads (decision 3): attach the
  debugger.
- `tabCapture` (decision 3): Claude cannot start it.
- An in-page overlay and a side panel alone (decision 4): the page can draw
  or click the first, and `sidePanel.open()` cannot open the second.
- CDP `Fetch` for request control (decision 6): slower and broader than DNR.
- Switch-only and ask-first writes (decision 7): a page or a skipped call
  gets past them.
- Starting `claude -p` from the omnibox (decision 8): a hostile page could
  trigger it, and it starts a process the person did not.
- Per-profile `storage.local` policy and one file per profile (decision 9):
  the host could not enforce the first; the second is many files to keep in
  step.
- Clipboard access: asked to leave out.
- A Claude tool to create schedules: a hostile page could plant recurring
  actions.
- Disabling or enabling the extension itself, and loosening any site
  permission or privacy setting: the confirmation does not make them safe.

## What the tests hold

The two gates refuse with `access_off` and `permission_missing` for every
tool and for the right profile only; no reply carries a cookie value, a
storage value by default, a `Set-Cookie`, a URL query or a blocked site's
results; the tool list has no schedule-creating tool; a yes from `ask_user`
unblocks nothing; every write confirms, tightens only and changes nothing on
a no; request rules and emulation stay on Claude's tabs and end with the
session; the settings round trip keeps the new keys and the profile tables,
resets them, resolves defaults and overrides, and rejects bad values; the
generated reference matches the host.

## Follow-ups

- The existing settings (pace, sites, capture, debugger) stay global; making
  them per profile is the same override mechanism and a later plan.
- An OS scheduler as a second runner for schedules when Chrome is closed.
- `topSites`, `readingList`, `system.display`, closed shadow roots, frames by
  id, PDF text, authenticated `fetch` and text-to-speech were considered and
  are not here; each needs its own plan and `## Security` table.
- A marketplace entry and Windows verification belong to `v0.2.0`
  (`docs/releases.md`).

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove the permissions and the debugger reads (needs you: click Grant once, on a Mac too)

- [ ] `scripts/prove/optional-access.sh` loads the extension in Chrome for
  Testing with `downloads` in `optional_permissions`, opens the options page,
  requests it from a click, uses `chrome.downloads`, removes it, and prints
  `PASS`; it also records whether `sidePanel`, `offscreen`, `management`,
  `contentSettings`, `privacy`, `sessions` and `identity.email` load as
  optional, whether `getAll` returns httpOnly cookies, and the cost of one
  `permissions.contains`.
- [ ] `scripts/prove/cdp-diagnostics.sh` attaches to a page, reads one
  response body, sets and resets an emulation, reads `Performance.getMetrics`,
  and reads a console stack trace, then prints `PASS`; it also records
  whether a DNR redirect to a `data:` URL mocks a body.
- [ ] Both scripts run on Linux headless and on a Mac, and record whether
  notifications can be shown and `idle` ever leaves `active` on each (the
  Platforms table's unverified cells).
- [ ] Check: both scripts exit 0 on Linux; the answers go into
  `## Open decisions` and `## Platforms` as `Landed` lines.

### Phase 2: the rough cut, one switch, one profile at a time, and downloads (needs you: try it)

- [ ] `[access]` with `downloads`, `[profiles."<name>".access]` overrides,
  resolution (own, default, `false`), parsing, validation and reset in
  `host/src/config.rs`, the wire changes in `host/src/wire.rs`, and the
  regenerated TypeScript types, pinned by config round-trip tests, a
  resolution test with two profiles, and `host/tests/wire.rs`.
- [ ] The host-side gate in `host/src/mcp.rs` and the extension gate in
  `extension/src/access.ts`: a call passes only with the profile's policy on
  and the permission held, else `access_off` or `permission_missing`;
  `permissions.onRemoved` updates the state; a policy turned off removes the
  permission; `hello` reports grants. Pinned by gate tests for each outcome
  and for profile A on, profile B off.
- [ ] The `downloads` tool (`list`, `wait`) with URL stripping, pinned by
  tests for the reply shape and the stripped query.
- [ ] The settings page's Access section with the profile picker ("This
  profile", "Default for every profile", each other profile), the downloads
  row (a switch, one plain sentence of what Claude can then do, a chip
  `granted` or `Grant`, and "uses the default"), Grant calling
  `permissions.request` inside the click (expected in
  `extension/src/options/page.ts`). If a board is missing in the Penpot file
  "Settings", it is drawn there first and exported to `design/`.
- [ ] Check: `make check` passes, and with the host and extension built,
  `list_profiles` then `downloads` fails `access_off`.
- [ ] You try it, with two profiles: in Settings turn Downloads on for one
  and click Grant, leave the other off, ask Claude to download a file in each
  and wait for it, then turn it off and ask again. Say whether the wording,
  the picker and the click feel right; what you want changed goes into the
  phases below.

### Phase 3: browser data (history, bookmarks, sessions, cookies, profile)

- [ ] `history_search`, `bookmarks_search` and `sessions` (`recent`,
  `devices`, `reopen` into Claude's tab group) (expected in
  `extension/src/tools/history.ts`, `bookmarks.ts`, `sessions.ts`) with the
  `[history]` limits,
  query and fragment stripped, blocked sites left out, pinned by tests for a
  `?token=` URL, a blocked host, the caps, and `reopen` never touching the
  person's window.
- [ ] `cookies_status` with no value and `profile_info` (expected in
  `extension/src/tools/cookies.ts`, `profile.ts`) with the email kept out of
  the audit line, pinned by tests of the reply fields and the audit
  line.
- [ ] Their rows on the settings page (a row each, with the history limits);
  check: `make check` passes and the tool list shows the tools for a profile
  with them on.

### Phase 4: page data from content scripts

- [ ] `page_storage` (`keys` and, with `page.storage_values`, masked `get`)
  and `page_info` (`meta`, `jsonld`, `forms`, `links`, `images`, `timing`
  with Web Vitals) in `extension/src/page/storage.ts`, `info.ts` and
  `content.ts`, pinned by jsdom tests: no form value, a JWT-shaped value
  masked, a `?token=` link redacted, JSON-LD parsed.
- [ ] Their rows and the `page.storage_values` switch; check: `make check`
  passes.

### Phase 5: tabs, windows, headers and page archives

- [ ] `tab_actions` and the extra fields on `tabs_context` (zoom, mute,
  duplicate, discard, reload with cache bypass, audible, language), only on
  Claude's tabs, pinned by `not_yours` tests.
- [ ] `read_network_requests` with `headers` (`Set-Cookie`, `Authorization`
  and `Cookie` removed) in `extension/src/network.ts`, pinned by a test with
  each of the three.
- [ ] `save_page` through `pageCapture`, the blob sent to the host and
  written to `capture.page_folder`, and with `text: true` parsed in an
  offscreen document; and the `windows` tool for browser-hand windows with
  `focus` behind `windows.allow_focus`, pinned by a fixture MHTML and
  `not_yours` and `access_off` tests.
- [ ] Their rows; check: `make check` passes.

### Phase 6: asking you, the side panel, the omnibox and idle

- [ ] `ask_user` with the notification, two buttons, one open question and
  the 10 s limit, pinned by tests for yes, no, timeout, `busy`, and a yes
  that unblocks nothing.
- [ ] The side panel page showing Claude's current step, the open question
  and a stop button; "Watch Claude" in the popup opens it; stop makes every
  call fail `stopped` until the person resumes, pinned by tests.
- [ ] The omnibox keyword `bh` (replay by name, `ask`, `stop`) and the
  `inbox` tool, with the switch gating every handler, pinned by tests: off
  does nothing, a note is cut at 500 characters, a page cannot add one.
- [ ] `idle`: with `access.idle` on, input tools wait for `idle.quiet_s` of
  quiet, then fail `person_active` after 60 s, pinned by a test with a fake
  state.
- [ ] Their rows (Notifications with "Send a test notification", Side
  panel, Omnibox, Idle with "not reliable on this system"); check: `make
  check` passes.

### Phase 7: the debugger tools

- [ ] `network_bodies` (`arm`, `list`, `get`), `performance_metrics`,
  `emulate` and `read_console_messages` with `details`, through
  `extension/src/debugger.ts` and `diagnostics.ts`, with the bodies capped by
  `bodies.max_kb`, secret fields masked, emulation undone at session end, and
  the idle detach unchanged; pinned by tests with a fake debugger.
- [ ] `request_control` (`block`, `redirect`, `set_header`, and `mock` only
  if Phase 1 passed) as DNR session rules on Claude's tab ids, ten at most,
  never `Cookie` or `Authorization`, never a blocked site, cleared at session
  end, pinned by tests of each refusal and the cleanup.
- [ ] Their rows (Response headers, Response bodies with its limit, Request
  control, Emulation, Performance, Console details); check: `make check`
  passes, and the debugger bar shows only while one of them runs.

### Phase 8: browser control with confirmed writes

- [ ] `extensions` (`list`, `get`, `enable`, `disable`), `site_permissions`
  (`get`, `set` to `ask` or `block`) and `privacy_settings` (`get`, `set` on
  the allow-list) (expected in `extension/src/tools/extensions.ts`,
  `site-permissions.ts`, `privacy.ts`), each write asking through the notification and failing
  `confirm_unavailable` without one, never touching the extension itself or
  an admin-installed one, pinned by tests that every loosening is refused,
  a "no" changes nothing and an off switch refuses.
- [ ] Their rows, each read switch with a separate write switch marked
  "asks you each time"; check: `make check` passes.

### Phase 9: schedules (needs plan 17's replay)

- [ ] Schedules made on the settings page (a recording, a time, a repeat),
  kept in the profile's `storage.local`, fired by `alarms`, and run by the
  host through plan 17's replay; `schedules_list` shows each with `ok`,
  `failed` or `missed`; no tool creates one, pinned by tests for a due
  alarm, a missed one and the absent tool.
- [ ] Check: `make check` passes, and a headless proof schedules a
  recording one minute ahead and sees it run.

### Phase 10: revoke, copy and the page as a whole

- [ ] **Turn everything off** (this profile, and for every profile),
  **Grant all**, **Copy from another profile**, **Reset to the default**, the
  "profile not found" rows with Remove, and the grant state of each connected
  profile, in `extension/src/options/page.ts`, pinned by page tests.
- [ ] Check: `make check` passes, and headless screenshots of the Access
  section in light and dark show every group, row, chip and the picker (the
  `knowledge` settings-page preview); the Penpot boards are exported to
  `design/`.

### Phase 11: the walk on Linux and macOS (needs you: a Mac and a Linux desktop)

- [ ] On Linux with Chrome and one other Chromium browser, and on macOS with
  Chrome: with two profiles that have different switches, run every tool
  that is on in each (headless Chrome for Testing covers all but the
  notification, side panel and omnibox; those are watched by hand), then
  press "Send a test notification" and answer one `ask_user` and one write
  with its buttons. Write what each system showed under `## Verified`, and
  every difference into `docs/testing.md` § Platforms.
- [ ] Check: `make check` and `make windows` pass, so no Windows build broke.

### Phase 12: docs, the plugin's words and the proofs

- [ ] `docs/book/src/guides/access.md` (each switch, grant and revoke, per
  profile), the generated settings and tools reference
  (`UPDATE_DOCS=1 cargo test --test docs`), the README's Settings paragraph,
  `host/src/instructions.md`, `plugin/skills/browser-hand/SKILL.md`,
  `SECURITY.md` scope and `docs/store-listing.md` reasons for each
  permission.
- [ ] `scripts/prove/` gains one headless proof per tool that can run
  without a person; `docs/testing.md` lists the ones that need you.
- [ ] Check: `make check` passes and `sh scripts/check-docs.sh` prints PASS.

### Phase 13: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

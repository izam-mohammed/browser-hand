# Claude can use downloads, history, bookmarks, cookie status, page archives and alerts, each one switched on by you and revocable

## The ask

"A new plan with everything in the worth-adding list, with bookmarks and
history, no clipboard, windows and offscreen, and update each thing's access
revoke or the necessary updates in settings." The list: `downloads`, a side
panel, cookies (read only), alarms with scheduled replays, page capture,
notifications with an `ask_user` pause, `idle`; plus history, bookmarks,
`windows` and `offscreen`.

Read from the tree: the manifest holds ten permissions, all required
(`extension/manifest.json`); every setting is a key in `config.toml`, owned by
the host and shown on one page (`host/src/config.rs`,
`extension/src/settings.ts`, `extension/src/options/page.ts`); `chrome.windows`
and `chrome.offscreen` are documented but only `windows` is used
(`resize_window`). Plan 17 (PR `#59`) adds `sites.allowed`, `audit.*`,
`capture.save_screenshots` and `browser-hand replay`, and this plan builds on
all four.

Built so far: `docs/built/BUILT-2026-11-20-1956.md` (plans 17 and 18 are
open PRs, not built).

## Constraints

- No clipboard access (asked).
- "update each thing's access revoke": every new capability can be turned off
  from the settings page, and off must really take the permission away.
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

## The decision

- D1: new APIs go in `optional_permissions`; `[access]` holds one boolean per
  capability, default `false`; a policy on plus no grant in this profile is
  `permission_missing`.
- D2: schedules are made on the settings page only and stored in the
  extension's `storage.local`; an alarm tells the host to run the plan 17
  replay.
- D3: `save_page` uses `pageCapture` and `cookies_status` uses `cookies`.
- D4: `ask_user` sends a notification and waits for a button.
- New tools: `downloads`, `cookies_status`, `history_search`,
  `bookmarks_search`, `save_page`, `ask_user`, `windows`, `schedules_list`.
- `idle`: with `access.idle` on, input tools wait until the machine has had
  no input for `idle.quiet_s`, up to 60 s, then fail `person_active`.
- `offscreen`: one offscreen document (reason `DOM_PARSER`) turns a saved
  MHTML page into text for `save_page` with `text: true`.
- `windows`: lists and arranges only windows holding a browser-hand tab group;
  bringing one to the front needs `windows.allow_focus`.
- No clipboard.
- No lanes: every part edits `config.rs`, `mcp.rs`, `args.rs` and the
  settings page, so the files are not disjoint.
- Permissions added to the manifest as optional: `downloads`, `cookies`,
  `history`, `bookmarks`, `pageCapture`, `notifications`, `sidePanel`,
  `alarms`, `idle`, `offscreen`. No new host, secret or Rust or npm package.

Standards: `docs/standards.md` (format, lint, types, tests, coverage floors,
audit, secrets, docs, site), through `make check`.

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| Optional permissions and the eleven APIs | `docs/external/chrome-extension-apis.md` § Optional access | `scripts/prove/optional-access.sh` | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/optional-access.sh` | new | 1 | request, use and remove one permission | expected |
| `extension/manifest.json` | edit | 2 to 6 | `optional_permissions`, `side_panel` | fixed |
| `host/src/config.rs` | edit | 2 to 6 | `[access]`, `[windows]`, `[idle]`, `capture.page_folder`, `[history]` | fixed |
| `host/src/tools/args.rs`, `host/src/mcp.rs` | edit | 2 to 6 | the eight tools, `access_off` and `permission_missing` | expected |
| `extension/src/access.ts` | new | 2 | policy, grant state, the gate every new tool passes | expected |
| `extension/src/tools/` (`downloads.ts`, `cookies.ts`, `history.ts`, `bookmarks.ts`, `archive.ts`, `windows.ts`, `ask.ts`) | new | 2 to 5 | one file per tool | expected |
| `extension/src/offscreen.html`, `offscreen.ts` | new | 4 | MHTML to text | expected |
| `extension/src/panel/` | new | 5 | the side panel page | expected |
| `extension/src/schedule.ts` | new | 6 | alarms, list, missed runs | expected |
| `extension/src/settings.ts`, `extension/src/options/page.ts` | edit | 2 to 7 | the Access section, revoke all, grant chips | expected |
| `extension/src/popup/` | edit | 5 | "Watch Claude" opens the panel | expected |
| `extension/build.mjs` | edit | 4, 5 | the offscreen and panel entries | expected |
| `docs/book/src/guides/access.md` | new | 8 | what each switch gives, grant and revoke | expected |
| `docs/book/src/reference/`, `SECURITY.md`, `docs/store-listing.md`, `README.md`, `plugin/skills/browser-hand/SKILL.md`, `host/src/instructions.md` | edit | 8 | words and the generated reference | expected |

*Reused, not rewritten:*

- `host/src/config.rs` `take`, `problems`, `reset`, `folder_problem_in`: the
  new keys parse, validate and reset through them, version stays 1 (new
  keys default off).
- `extension/src/sites.ts` `gate` and `SiteRules`: blocked sites hide their
  history, bookmarks, cookies and downloads too; no second matcher.
- `extension/src/settings.ts` port and `settings_set`: the Access section
  saves through them.
- `host/src/tools/images.rs` `save`: writes the archive into the folder
  (the plan 17 screenshot folder logic).
- Plan 17's replay and audit: schedules call the first; the audit line of
  every new tool is the second.
- Searched for an existing permission request, `optional_permissions`,
  history, bookmarks or alarms code in `extension/src` and `host/src`:
  none.

## Contract

Binding; every other name here is a suggestion.

```toml
[access]            # one switch per capability, all false by default
downloads = false
cookies = false
history = false
bookmarks = false
page_capture = false
notifications = false
side_panel = false
schedules = false
idle = false

[windows]
allow_focus = false         # Claude may bring a window to the front

[idle]
quiet_s = 5                 # 1 to 60, used when access.idle is on

[history]
max_days = 30               # 1 to 365, the furthest back a search may go
max_results = 50            # 1 to 200

[capture]
page_folder = ""            # "" means capture.gif_folder
```

Tools (arguments, then reply):

- `downloads`: `action` `list` or `wait`, optional `name_contains`,
  `since_s`, `timeout_s` (1 to 120, default 30); items with `id`, `name`,
  `path`, `bytes`, `mime`, `state`, `host`. No URL query, no file contents.
- `cookies_status`: `tabId`; items with `name`, `domain`, `path`, `secure`,
  `http_only`, `same_site`, `session`, `expires`. Never `value`.
- `history_search`: `text`, `days` (1 to `max_days`, default 1),
  `max_results`; items with `title`, `url`, `last_visit`, `visits`.
- `bookmarks_search`: `query`, `max_results`; items with `title`, `url`,
  `folder`.
- `save_page`: `tabId`, optional `text` (bool); `{path, bytes, text?}`.
- `ask_user`: `question` (200 characters at most), optional `yes`, `no`
  labels, `timeout_s` (5 to 300, default 60); `yes`, `no` or `timeout`.
- `windows`: `action` `list`, `arrange` or `focus`, with `windowId`, `left`,
  `top`, `width`, `height`, `state`; only browser-hand windows.
- `schedules_list`: no arguments; items with `id`, `recording`, `when`,
  `repeat`, `last_run`, `state` (`ok`, `failed`, `missed`).
- URLs in `history_search`, `bookmarks_search` and `downloads` have their
  query and fragment removed. Results for a blocked site are left out.
- Error codes: `access_off` (the key is false), `permission_missing` (key
  true, not granted in this profile; the message says "Settings, Access,
  Grant"), `not_yours` (a window outside browser-hand), `person_active`.

Owner: this repository. Held by `host/tests/docs.rs` (the generated tool and
settings reference) and by the extension tests for each tool.

## Edge cases

- The person revokes a permission in `chrome://extensions`: the chip reads
  "not granted", the policy stays, and calls fail `permission_missing`.
- A policy is turned off in one profile's page: every profile's worker
  removes the permission when it sees the settings change; a profile that is
  closed does it on its next start.
- Chrome refuses the grant prompt: the policy stays off and the row says so.
- The host is down: the Access rows are read only, like the rest of the page.
- `history_search` over a blocked site: omitted, as if never visited.
- `ask_user` while another is open: the second fails `busy`; more than one every
  10 seconds is refused.
- A scheduled run whose recording was deleted: `failed`, with the reason.
- A missed alarm: listed as `missed`, run once when Chrome starts, never
  silently skipped.
- `windows` `focus` with `allow_focus` false: `access_off`.
- `idle` on and the person never idles: `person_active` after 60 s, never an
  endless wait.
- A page whose title or URL looks like an instruction, in a history or
  bookmark result: returned as data in a quoted field, and the tool text
  tells Claude to treat it as data.

## Security

What is protected: the person's browsing history, bookmarks, downloaded
files, sign-in state and attention. Each tool can be reached only by Claude
through the MCP server, and each is off until the person turns it on and
clicks Grant in Chrome.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | history, bookmarks and downloads URLs carry tokens in the query | query and fragment stripped, results capped, blocked sites left out | a test with a URL holding `?token=` and a blocked host |
| Information disclosure | cookie values reach the model and transcripts | `cookies_status` returns no value, ever | a test that the reply has no `value` field |
| Elevation of privilege | a hostile page tells Claude to schedule repeated actions | no tool creates or changes a schedule; only the settings page does | a test that the tool list has no such tool |
| Elevation of privilege | Claude edits `config.toml` with a Bash command to turn a switch on | the permission still needs the person's click in each profile (`permissions.request` needs a gesture) | the proof script: policy on, no grant, call fails `permission_missing` |
| Spoofing | an injected question in `ask_user` looks like it came from the person | the notification says "Claude asks", the answer only returns yes or no and never lifts a blocked, read-only or allow rule | a test that a yes does not unblock a blocked site |
| Denial of service | notification spam | one open question, one every 10 s | a test of the rate limit |
| Tampering | the policy is on in config but Chrome's grant is gone | the gate checks `permissions.contains` on every call | a test with the grant removed mid-session |
| Repudiation | a call nobody can trace | plan 17's audit line for every new tool (tool, action, ok; never a query, URL, cookie or text) | the audit test with each tool |

Data: nothing new is stored except schedules in `storage.local`. History,
bookmark and cookie reads are never written to disk or to the audit log.
Archives are written only to `capture.page_folder` by the host, with the
folder checks `folder_problem_in` already does. Secrets: none. Logged: tool,
action, result, time. Checklist: OWASP Top 10 for LLM Applications (prompt
injection, excessive agency) and the Chrome extension security guidance on
optional permissions.

## Rollback

Settings keys default off and the version stays 1, so an older host ignores
them. Removing a capability: delete its tool and key, drop its entry from
`optional_permissions`, and the next load removes the permission. Archives
and downloads already on disk stay.

## Open decisions

- Whether `sidePanel` and `offscreen` accept `optional_permissions`: default,
  yes; if the proof shows a manifest error, they join the required list and
  are gated by the policy only, and the plan says so in a `Landed` note.
- Whether the Access toggles save at once or join the page's draft: default,
  at once, because the grant click must stay inside one gesture.
- Whether httpOnly cookies appear in `getAll`: default, the tool lists them
  with `http_only: true`; the proof checks.

## Risks

- A grant per profile is friction: the chips and a "Grant all" button keep it
  to one click per capability per profile.
- `alarms` fire only while Chrome runs: missed runs are shown, never hidden.
- Eight tools add to the prompt the server sends; `instructions.md` stays
  short and each description is one sentence.

## Declined

- Required permissions (decision 1): a held permission cannot be revoked.
- An OS scheduler and a daemon (decision 2): outside the one switch, or an
  idle cost.
- CDP snapshots and cookies (decision 3): attach the debugger.
- `tabCapture` (decision 3): Claude cannot start it; a person must invoke
  the extension.
- An in-page overlay and a side panel alone (decision 4): the page can draw
  or click the first, and `sidePanel.open()` cannot open the second.
- Clipboard access: asked to leave out.
- A Claude tool to create schedules: a hostile page could plant recurring
  actions.

## What the tests hold

The gate refuses with `access_off` and `permission_missing` for every tool;
no reply carries a cookie value, a URL query or a blocked site's results;
the tool list has no schedule-creating tool; a yes from `ask_user` unblocks
nothing; the settings round trip keeps the new keys, resets them and rejects
bad values; the generated reference matches the host.

## Follow-ups

- An OS scheduler as a second runner for schedules when Chrome is closed.
- A marketplace entry and Windows verification belong to `v0.2.0`
  (`docs/releases.md`).

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove optional permissions (needs you: click Grant once)

- [ ] `scripts/prove/optional-access.sh` loads the extension in Chrome for
  Testing with `downloads` in `optional_permissions`, opens the options page,
  requests it from a click, uses `chrome.downloads`, removes it, and prints
  `PASS`; it also records whether `sidePanel` and `offscreen` load as
  optional, whether `getAll` returns httpOnly cookies, and the cost of one
  `permissions.contains`.
- [ ] Check: the script exits 0; the three answers go into
  `## Open decisions` and `## Resource budget` notes as `Landed` lines.

### Phase 2: the rough cut, one switch and downloads (needs you: try it)

- [ ] `[access]` with `downloads`, parsed, validated and reset through
  `config.rs`, with the TypeScript types regenerated (expected in
  `host/src/config.rs`), pinned by config round-trip tests.
- [ ] The gate (expected in `extension/src/access.ts`): a tool call passes
  only with the policy on and the permission held, else `access_off` or
  `permission_missing`; `permissions.onRemoved` updates the state; a policy
  turned off removes the permission. Pinned by gate tests for each outcome.
- [ ] The `downloads` tool (`list`, `wait`) with URL stripping, in
  `extension/src/tools/downloads.ts`, `host/src/mcp.rs` and `args.rs`,
  pinned by tests for the reply shape and the stripped query.
- [ ] The settings page's Access section with the downloads row: a switch,
  one plain sentence of what Claude can then do, a chip (`granted in this
  profile` or `Grant`), and Grant calling `permissions.request` inside the
  click (expected in `extension/src/options/page.ts`). If a board is missing
  in the Penpot file "Settings", it is drawn there first and exported to
  `design/`.
- [ ] Check: `make check` passes, and with the host and extension built,
  `list_profiles` then `downloads` fails `access_off`.
- [ ] You try it: open Settings, turn Downloads on and click Grant, ask
  Claude to download a file and wait for it, then turn it off and ask again.
  Say whether the wording and the click feel right; what you want changed
  goes into the phases below.

### Phase 3: history, bookmarks and cookie status

- [ ] `history_search` and `bookmarks_search` with `[history]` limits, query
  and fragment stripped, blocked sites left out (expected in
  `extension/src/tools/history.ts`, `bookmarks.ts`), pinned by tests for the
  stripped `?token=` URL, the blocked host and the caps.
- [ ] `cookies_status` returning no value (expected in
  `extension/src/tools/cookies.ts`), pinned by a test that no reply field is
  `value`.
- [ ] Their three rows on the settings page, with the history limits; check:
  `make check` passes and the tool list shows the three tools.

### Phase 4: page archives and windows

- [ ] `save_page` through `pageCapture`, the blob sent to the host and
  written to `capture.page_folder`, and with `text: true` parsed to text in
  an offscreen document (expected in `extension/src/tools/archive.ts`,
  `offscreen.ts`, `host/src/tools/images.rs`), pinned by a test on a fixture
  MHTML.
- [ ] The `windows` tool, limited to browser-hand windows, with `focus`
  behind `windows.allow_focus` (expected in `extension/src/tools/windows.ts`),
  pinned by `not_yours` and `access_off` tests.
- [ ] Their rows (Page capture, and a Windows focus switch) on the settings
  page; check: `make check` passes.

### Phase 5: asking you, the side panel and idle

- [ ] `ask_user` with the notification, two buttons, one open question and
  the 10 s limit (expected in `extension/src/tools/ask.ts`), pinned by tests
  for yes, no, timeout, `busy`, and a yes that unblocks nothing.
- [ ] The side panel page showing Claude's current step, the open question
  and a stop button; "Watch Claude" in the popup opens it; stop makes every
  tool call fail `stopped` until the person resumes (expected in
  `extension/src/panel/`, `extension/src/popup/`), pinned by tests.
- [ ] `idle`: with `access.idle` on, input tools wait for `idle.quiet_s` of
  quiet, then fail `person_active` after 60 s (expected in
  `extension/src/tools/` or `input.ts`), pinned by a test with a fake state.
- [ ] Their rows (Notifications, Side panel, Idle) on the settings page;
  check: `make check` passes.

### Phase 6: schedules (needs plan 17's replay)

- [ ] Schedules made on the settings page (a recording, a time, a repeat),
  kept in `storage.local`, fired by `alarms`, and run by the host through
  plan 17's replay; `schedules_list` shows each with `ok`, `failed` or
  `missed`; no tool creates one (expected in `extension/src/schedule.ts`),
  pinned by tests for a due alarm, a missed one and the absent tool.
- [ ] Check: `make check` passes, and a headless proof schedules a
  recording one minute ahead and sees it run.

### Phase 7: revoke, drift and the page as a whole

- [ ] **Turn everything off** on the settings page turns every switch off and
  removes every permission in this profile at once; a drifted row (policy on,
  grant gone) reads "not granted" with Grant; **Grant all** asks for the
  switched-on ones in one click (expected in `extension/src/options/page.ts`),
  pinned by page tests.
- [ ] Check: `make check` passes, and headless screenshots of the Access
  section in light and dark show every row and chip (the `knowledge`
  settings-page preview); the Penpot boards are exported to `design/`.

### Phase 8: docs, the plugin's words and the proofs

- [ ] `docs/book/src/guides/access.md` (what each switch gives, how to grant
  and revoke), the generated settings and tools reference
  (`UPDATE_DOCS=1 cargo test --test docs`), the README's Settings paragraph,
  `host/src/instructions.md`, `plugin/skills/browser-hand/SKILL.md`,
  `SECURITY.md` scope and `docs/store-listing.md` reasons for each permission.
- [ ] `scripts/prove/` gains one headless proof per tool that can run
  without a person; `docs/testing.md` lists the ones that need you.
- [ ] Check: `make check` passes and `sh scripts/check-docs.sh` prints PASS.

### Phase 9: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

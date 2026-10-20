# a person records what they do in Chrome, and Claude reads and replays the steps

## The ask

"I want record action. If I am doing something with Claude and in the
extension side I clicked record, it has to record what I am doing." Asked
18/10/2026; the person then said they mean steps, not video.

So: a Record control in the browser that the person presses, not Claude.
While it is on, the extension writes down what the person does in that
window (clicks, what they typed, keys like Enter, page loads) as steps that
name each element the way a person would ("button 'Save'"). Claude can list
recordings, read one, and replay it through the same humane input it already
uses. Today the extension has no browser UI at all (`extension/manifest.json`
has no `action`), and the only recording is `gif_creator`, which records
Claude's own actions as frames (`host/src/gif.rs`).

## Constraints

- Started by the person, in the browser. Claude has no tool to start it.
- "No need for any interface in browser" (the original ask, 17/10/2026): the
  Record button is the one exception the person asked for; nothing else is
  added to the page.
  > Amended by `06-settings.md`: the settings page is a second exception,
  > an extension page reached from Chrome's menus; it adds nothing to web
  > pages and holds no Record control.

## Alternatives

### Decision 1: how the person starts and stops recording (two-way door)

Something in the browser has to take the press and show that recording is
on.

Searched 18/10/2026: "chrome extension action onClicked badge",
"chrome.commands suggested_key"; read the `chrome.action` and
`chrome.commands` references (`docs/external/chrome-extension-apis.md`
§ chrome.action, § chrome.commands).

| Must | Toolbar button and shortcut | Shortcut only | Button on the settings page | `recording_start` tool |
| --- | --- | --- | --- | --- |
| The person starts it from the browser | yes | yes | yes | no (Claude starts it) |
| Shows that it is on while it is on | yes (badge) | no (nothing visible) | only on that page | no |
| **Survives** | **yes** | no | **yes** | no |

| Criterion | Weight | Toolbar button and shortcut | Settings-page button |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 2 |
| Reliability | 30 | 4 | 4 |
| Visible state | 30 | 5 | 2 |
| **Weighted total** | **100** | **4.70** | **2.60** |

Evidence, sensitivity and risk: `docs/research/05-record-steps.md`
§ Decision 1.

**Chosen: the toolbar button (`action`, no popup) plus an `Alt+Shift+R`
shortcut.** Revisit if the person wants a pause, which needs a popup.

### Decision 2: where recordings are kept (two-way door)

Steps arrive in the extension. Something has to hold them until Claude asks,
across a stopped service worker and a restarted Claude Code.

Searched 18/10/2026: "chrome.storage.local quota unlimitedStorage",
"native messaging host push message to host"; read the storage reference
and `docs/protocol.md`.

| Must | `chrome.storage.local`, read by a call | Host writes files from a new push frame | MCP server memory |
| --- | --- | --- | --- |
| Kept when recorded before Claude Code starts | yes | yes | no (the server is Claude's child) |
| Kept when the service worker stops | yes | yes | yes |
| **Survives** | **yes** | **yes** | no |

| Criterion | Weight | `storage.local` | Host files |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 4 |
| Reliability | 35 | 5 | 3 |
| Compatibility | 25 | 5 | 3 |
| **Weighted total** | **100** | **5.00** | **3.40** |

Evidence, sensitivity and risk: `docs/research/05-record-steps.md`
§ Decision 2.

**Chosen: `chrome.storage.local`, under `rec:<id>` keys, read through new
tools, with `"unlimitedStorage"` (no install warning) and a 50 MB budget of
its own (Edge cases).** Revisit if recordings need to be read with Chrome
closed.

### Decision 3: the step format (two-way door)

Claude reads the steps and replays them; the format decides what a step can
say.

Searched 18/10/2026: "Chrome DevTools Recorder JSON format selectors",
"Playwright codegen locators", "rrweb"; read `@puppeteer/replay`'s
`Schema.ts` (`docs/external/puppeteer-replay.md`).

| Must | DevTools Recorder `UserFlow` | Own format | Playwright script |
| --- | --- | --- | --- |
| Data Claude can read and browser-hand can replay | yes | yes | yes (as code) |
| More than one way to find each element | yes | yes | no (one locator) |
| **Survives** | **yes** | **yes** | no |

| Criterion | Weight | `UserFlow` | Own format |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 3 | 4 |
| Replay fidelity | 35 | 5 | 5 |
| Compatibility | 25 | 5 | 1 |
| **Weighted total** | **100** | **4.20** | **3.60** |

Evidence, sensitivity and risk: `docs/research/05-record-steps.md`
§ Decision 3.

**Chosen: `UserFlow` steps, with `meta` alongside.** Revisit if Claude reads
JSON more often than text.

### Decision 4: how a step names its element (two-way door)

Replaying by position breaks on any layout change; replaying by name does
not.

Searched 18/10/2026: "DevTools Recorder selector types aria pierce";
`docs/external/puppeteer-replay.md` § Selectors.

| Must | Several selectors, ARIA first | One CSS path | Coordinates only |
| --- | --- | --- | --- |
| Still finds the element after a small layout change | yes | yes | no |
| **Survives** | **yes** | **yes** | no |

| Criterion | Weight | Several selectors | One CSS path |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 4 | 5 |
| Reliability | 40 | 5 | 2 |
| Privacy | 20 | 3 | 4 |
| **Weighted total** | **100** | **4.20** | **3.60** |

Evidence, sensitivity and risk: `docs/research/05-record-steps.md`
§ Decision 4.

**Chosen: `aria/`, then `text/`, then CSS (id, `name`, `data-testid`, then
path), then `xpath/`, with `pierce/` inside shadow roots.** Revisit if
replays miss on a site that has test ids.

### Decision 5: which tabs are recorded (two-way door)

Searched 18/10/2026: "chrome tabs openerTabId popup window"; the
`chrome.tabs` notes in `docs/external/chrome-extension-apis.md`.

| Must | The window, and windows it opens | The one tab | Every tab in the profile |
| --- | --- | --- | --- |
| Follows a link that opens a new tab | yes | no | yes |
| **Survives** | **yes** | no | **yes** |

| Criterion | Weight | The window | Every tab |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 4 |
| Completeness | 30 | 4 | 5 |
| Privacy | 30 | 5 | 2 |
| **Weighted total** | **100** | **4.70** | **3.70** |

Evidence: `docs/research/05-record-steps.md` § Decision 5.

**Chosen: the window where Record was pressed, plus popups and windows
opened from its tabs (`openerTabId`).** Revisit if the person works across
two windows.

### Decision 6: telling the person's steps from Claude's (two-way door)

Input Claude sends through the debugger reaches pages as trusted events
(`scripts/prove/cdp-input.sh`), so `isTrusted` cannot tell them apart.

Searched 18/10/2026: "CDP Input.dispatchMouseEvent isTrusted";
`docs/external/chrome-debugger-cdp.md` § isTrusted of CDP input.

| Must | Mark the tab while Claude acts | `event.isTrusted` | Do not separate |
| --- | --- | --- | --- |
| Tells the two apart | yes | no | no |
| **Survives** | **yes** | no | no |

**Chosen: the service worker marks a tab busy while `Input` acts on it, and
steps arriving in that span get `actor: "claude"`.** No weighted table: one
option survives. Revisit if a person clicks during Claude's action and the
step is mislabelled.

## The decision

A toolbar button (Decision 1) starts recording for its window (Decision 5).
The content script listens in the capture phase and sends steps in
`UserFlow` shape (Decision 3) with several selectors each (Decision 4); the
service worker tags Claude's own (Decision 6) and keeps them in
`chrome.storage.local` (Decision 2). Claude reads them through new MCP tools,
and replays with the humane input that exists.

New permissions: the `action` and `commands` manifest keys, and
`"unlimitedStorage"`, which shows no install warning
(`docs/external/chrome-extension-apis.md` § `unlimitedStorage` permission):
20 recordings of 5,000 steps outgrow the 10 MB `QUOTA_BYTES`. New dependencies: none. `all_frames: true` on the
isolated content script, so frames are recorded (Phase 3).

Standards: `docs/standards.md` (types, vitest, cargo test, build, through
`npm --prefix extension test && cargo test --manifest-path host/Cargo.toml
&& sh scripts/build.sh`).

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| `chrome.action`, `chrome.commands`, capture-phase listeners | `docs/external/chrome-extension-apis.md` | `scripts/prove/record-capture.sh` | none |
| DevTools Recorder format | `docs/external/puppeteer-replay.md` | `scripts/prove/record-capture.sh` (the proof writes its steps in this shape) | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/record-capture.sh`, `scripts/prove/record-capture/` | new | 1 | the proof | expected |
| `extension/manifest.json` | edit | 2, 3 | `action`, icons, `commands`, `all_frames`, `unlimitedStorage` | expected |
| `extension/icons/` | new | 2 | idle and recording PNGs, 16 and 32 px; `06-settings.md` adds 48 and 128 px | expected |
| `extension/src/recorder.ts` | new | 2 | state, badge, window scope, storage, actor marks | expected |
| `extension/src/page/record.ts` | new | 2 | listeners, masking, selectors | expected |
| `extension/src/page/content.ts` | edit | 2 | `record_start` and `record_stop` ops | expected |
| `extension/src/background.ts` | edit | 2 | button, tools, busy marks around `Input` | expected |
| `host/src/mcp.rs`, `host/src/tools/args.rs` | edit | 2, 4 | the recording tools | expected |
| `host/src/instructions.md`, `plugin/skills/browser-hand/SKILL.md` | edit | 2, 4 | when to use recordings | expected |
| `docs/protocol.md` | edit | 2 | tool names under Compatibility | fixed |
| `extension/test/record.test.ts` | new | 2-3 | recorder tests | expected |
| `host/tests/mcp.rs` | edit | 2-4 | tool tests | expected |
| `README.md` | edit | 2 | how to record | expected |

*Reused, not rewritten:*

- `extension/src/page/walker.ts` `roleOf`, `nameOf`: the ARIA role and
  name for `aria/` selectors.
- `extension/src/page/find.ts` `find`: resolves `aria/` and `text/`
  selectors on replay.
- `extension/src/input.ts` `Input`: replay clicks and types through it, at
  the person's pace setting.
- `extension/src/tabs.ts` `GroupStore` pattern: state in
  `chrome.storage.session` so it survives the worker stopping.
- Searched for an existing step recorder, selector builder or event log in
  `extension/src` and `host/src`: only `gif.rs` records, and it records
  frames of Claude's actions, not steps.

## Contract

New MCP tools; the call frames and errors are those of `docs/protocol.md`.

```text
recording_list    {}                                  -> text, newest first:
                  "<id>  <title>  <started, local>  <n> steps  <state>"
recording_get     { id?: string, format?: "text" | "devtools" }
                  id defaults to the newest; "text" (default) is one line per
                  step: "<n>. [<actor>] <type> <aria or first selector> <value>"
                  "devtools" is the UserFlow JSON alone
recording_delete  { id: string }
recording_replay  { id?: string, from?: number, values?: { "<step n>": string },
                    tabId?: number }                  (Phase 4)
```

Stored at `chrome.storage.local["rec:<id>"]`:

```text
{ id, title, startedAt, stoppedAt|null, windowId, flow: UserFlow,
  meta: [{ ts, tabId, actor: "person"|"claude", masked?: true }] }
```

`meta[i]` describes `flow.steps[i]`. Adding a field is not breaking.

## Edge cases

- Password, card and one-time-code fields: the value is stored as
  `"<masked>"` and `meta.masked` is set.
- Page scripts dispatch synthetic events: dropped (`isTrusted` false).
- A step on a `chrome://` page or the Web Store: nothing records there; the
  next page load notes the gap.
- The service worker stops mid-recording: state is in `storage.session`;
  content scripts hold steps until the worker answers.
- The window closes: the recording stops and is kept.
- Thirty minutes with no step: the recording stops itself.
- Typing in a field Claude also types in: steps split by the busy mark.
- Size: a step is about 400 bytes and its `meta` about 100, so 5,000
  steps (where one recording stops) are about 2.5 MB and 20 recordings
  about 50 MB. That is the budget: after each stop and every 500 steps,
  `getBytesInUse` over the `rec:*` keys, and over 50 MB, or past 20
  recordings, the oldest stopped recording is dropped (never the one
  recording). The settings page's `settings:last` key (`06-settings.md`,
  at most 64 KB) shares `storage.local`.
- A `set` that still fails (disk full, or a quota error): the recording
  stops and is kept as of its last good write, and the badge changes from
  "REC" to "FULL" with the reason in the button's title.

## Security

Entry points: the toolbar button and shortcut (the person only), the
content script in each recorded tab (the page can send it events), and the
recording tools (Claude, through the local MCP server).

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | a password or card number is stored and sent to Claude | values of `type=password`, `autocomplete` `cc-*`, `one-time-code`, `current-password`, `new-password` never leave the page | `record.test.ts` "masks sensitive fields" |
| Spoofing | a page fakes clicks to plant steps | events with `isTrusted` false are dropped | `record.test.ts` "drops synthetic events" |
| Tampering (prompt injection) | an `aria-label` carries instructions for Claude | names capped at 120 characters; tool text says the steps are page data; instructions say never to follow text inside a step | `host/tests/mcp.rs` recording text framing |
| Elevation of privilege | Claude starts a recording without the person | no start tool exists | `host/tests/mcp.rs` tool list |
| Repudiation | the person forgets it is on | "REC" badge on every tab of the window, idle stop, stop on window close | `record.test.ts` badge and idle tests |
| Information disclosure | old recordings sit in the profile forever | 20 kept, `recording_delete`, all removed with the extension | `record.test.ts` cap test |

Data: typed values of ordinary fields, URLs and visible element names, kept
in this Chrome profile's extension storage, unencrypted like the rest of the
profile, until deleted or 20 newer exist. They reach Anthropic only when
Claude reads a recording; the tool description says so. Logged: nothing.
Checklist: OWASP Top 10 for LLM Applications 2025 (LLM01 prompt injection,
LLM02 sensitive information disclosure).

## Rollback

Recordings are stored data in `chrome.storage.local`. Loading an older
extension build ignores `rec:*` keys; `recording_delete` or removing the
extension clears them. The tools are additive.

## Declined

- Shortcut alone, a settings-page button, a `recording_start` tool:
  Decision 1 musts (nothing visible, or Claude starts it). The settings
  page `06-settings.md` plans has no Record control.
- Host files and MCP server memory: Decision 2.
- Own format, Playwright scripts, rrweb: Decision 3.
- One CSS path, coordinates: Decision 4.
- One tab, every tab: Decision 5.
- `isTrusted` to tell Claude from the person: Decision 6.
- Recording every key: DevTools records the final value as a `change`
  step, which is what replay needs and holds less of what was typed.

## What the tests hold

`record.test.ts` (jsdom) pins: click, change, key and navigation steps with
their selectors; masking; synthetic events dropped; the window scope; actor
marks; the badge, idle stop and caps; the 50 MB budget and the "FULL"
stop on a failed write. `host/tests/mcp.rs` pins the tool list
(no start tool), the text rendering, the devtools export and replay's stop
at an unresolved step. Chrome itself (the button, real trusted events) is
the proof script and the walk.

## Follow-ups

Channels to tell Claude when a recording stops, a screenshot per step, and
blocked sites (planned in `06-settings.md` Phase 4):
`docs/research/05-record-steps.md` § Follow-ups.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove the button and capture (needs you at Chrome)

- [ ] `scripts/prove/record-capture.sh` loads a proof extension kept in
  `scripts/prove/record-capture/` (no project code) with an `action` button
  and a capture-phase content script, per `docs/external/chrome-extension-apis.md`
  § chrome.action; the person clicks the button and a test page's button
  and types in its field, the script then sends one debugger click, and it
  prints `PASS` when `onClicked` fired, the badge was set, and all three
  events arrived with their ARIA names and `isTrusted` true; it writes them
  as `UserFlow` steps per `docs/external/puppeteer-replay.md`.
- [ ] Check: the script exits 0 and prints `PASS`; a debugger click arriving
  untrusted reopens Decision 6.

Written 20/10/2026; not run yet, needs the person at Chrome. The proof
extension reports to a local server the script runs (`serve.py` on
127.0.0.1:8765, which also serves the test page) instead of a native echo
host, so it needs no `key`, no host manifest and no `--install` step.

### Phase 2: the rough cut (needs you: try it)

- [x] The toolbar button starts and stops a recording of its window, with
  "REC" on every tab's badge (expected in `extension/src/recorder.ts` and
  `extension/manifest.json`), pinned by `extension/test/record.test.ts`.
  Landed 20/10/2026: one recording at a time; the button in any window stops
  it. The badge is set per tab and set again on each load. Icons are
  `extension/icons/{idle,rec}-{16,32}.png`.
- [x] Clicks, `change` values, Enter, Tab and Escape, and page loads become
  `UserFlow` steps with `aria/`, `text/`, CSS and `xpath/` selectors;
  sensitive fields masked and synthetic events dropped (expected in
  `extension/src/page/record.ts`), pinned by `record.test.ts`.
  Landed 20/10/2026: page loads are recorded by the service worker from
  `webNavigation.onCommitted`: a load right after a click, change or keyUp
  becomes that step's `assertedEvents`, others a `navigate` step. Enter
  takes the field's value first, so a submit never loses it. jsdom cannot
  make a trusted event, so `Capture` takes the trust test as an argument.
- [x] Steps are stored under `rec:<id>` with `meta`, and the oldest beyond
  20 recordings dropped (expected in `extension/src/recorder.ts`), pinned by
  `record.test.ts`.
  Landed 20/10/2026: an index of summaries sits in `storage.local` under
  `recordings` so listing never reads every recording; steps are written
  500 ms after the last one, and at once on stop.
- [x] `recording_list` and `recording_get` (text and devtools) answer from
  the profile that recorded (expected in `host/src/mcp.rs` and
  `extension/src/background.ts`), pinned by `host/tests/mcp.rs`; the tool
  names added to `docs/protocol.md`, `host/src/instructions.md` and the
  skill, and "how to record" to `README.md`.
  Landed 20/10/2026: the extension answers with the stored JSON and the
  server renders it, in the new `host/src/tools/recording.rs` (not in the
  plan's table). `docs/protocol.md` lists the tools under Compatibility.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 20/10/2026: 107 extension tests and every host test pass; of
  `scripts/build.sh` the build steps ran (`cargo build --release`,
  `npm --prefix extension run build`) but not its `install`, which writes
  under `~/Library` and was left for the person.
- [ ] You try it: reload the extension, pin its button, press it, do a short
  task (search, open a result, fill a form field), press it again, then ask
  Claude "what did I just record?". Say whether the steps read the way you
  did them. What you want changed goes into the phases below.

### Phase 3: the rest of capture

- [x] `Alt+Shift+R` toggles recording (`commands`), and double clicks,
  scrolls (sampled), select boxes and `contenteditable` text record (expected
  in `extension/src/page/record.ts`), pinned by `record.test.ts`.
  Landed 20/10/2026: a double click replaces its two clicks in the
  recorder; scrolls are one step per gesture, 400 ms after it settles;
  `contenteditable` text is taken when focus leaves. The shortcut has no
  test of its own (it calls the same `toggle` as the button).
- [x] Popups and windows opened from recorded tabs join the recording;
  frames record with their `frame` path once `all_frames` is on; shadow DOM
  gives `pierce/` selectors (expected in `extension/src/recorder.ts`),
  pinned by `record.test.ts`.
  Landed 20/10/2026: windows join through `tabs.onCreated`'s `openerTabId`
  and `webNavigation.onCreatedNavigationTarget`. Each frame's content
  script works out its own `frame` path (`framePath` in
  `extension/src/page/record.ts`, where the selectors also live).
- [x] Steps made while Claude's `Input` acts on a tab get `actor: "claude"`,
  and `recording_get` hides them unless asked (expected in
  `extension/src/background.ts`), pinned by `record.test.ts`.
  Landed 20/10/2026: `Recorder.busy` holds the mark, with a 300 ms tail for
  events still in flight; `background.ts` wraps `computer` and replay in
  it. Hiding happens in the server (`host/src/tools/recording.rs`), pinned
  by `host/tests/mcp.rs`.
- [x] The recording stops after 30 idle minutes, on window close and at
  5,000 steps, survives the service worker stopping, and `recording_delete`
  removes one (expected in `extension/src/recorder.ts`), pinned by
  `record.test.ts` and `host/tests/mcp.rs`.
  Landed 20/10/2026: the idle stop is a timer re-armed on each step and a
  check on every event, so no `alarms` permission; a recording still
  being made cannot be deleted.
- [x] The 50 MB budget drops the oldest stopped recording, and a failed
  `set` stops the recording, keeps it and shows "FULL" (expected in
  `extension/src/recorder.ts`), pinned by `record.test.ts` "storage
  budget" with a stubbed `getBytesInUse` and a rejecting `set`.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 20/10/2026: 107 extension tests and every host test pass; of
  `scripts/build.sh` the build steps ran (`cargo build --release`,
  `npm --prefix extension run build`) but not its `install`, which writes
  under `~/Library` and was left for the person.

### Phase 4: replay

- [x] `recording_replay` runs a recording's steps in a tab through `Input`
  at the person's pace, finding each element by its selectors in order,
  with `values` replacing a step's typed value and `from` resuming at a step
  (expected in `host/src/mcp.rs` and `extension/src/background.ts`), pinned
  by `host/tests/mcp.rs`.
  Landed 20/10/2026: the server walks the steps and sends each to the
  extension's `replay_step`, in `extension/src/replay.ts` (pinned too by
  `record.test.ts`). A key is pressed at its `keyUp`, `setViewport` is
  skipped, a change types over the field after select-all, and every step
  replays, Claude's included. Steps inside frames stop the replay: it
  reaches the top frame only for now.
- [x] Replay stops at the first step it cannot find and returns the step,
  the selectors tried and a screenshot (expected in
  `extension/src/background.ts`), pinned by `host/tests/mcp.rs`; the
  instructions and skill say when to replay and when to read and act.
  Landed 20/10/2026: an element gets 5 s to appear; any failing step stops
  the replay, as does a masked value with no `values` for it, before
  acting. The server takes the screenshot through `computer`.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 20/10/2026: 107 extension tests and every host test pass; of
  `scripts/build.sh` the build steps ran (`cargo build --release`,
  `npm --prefix extension run build`) but not its `install`, which writes
  under `~/Library` and was left for the person.

### Phase 5: the walk (needs you at Chrome)

- [ ] In two profiles: record a real task with a login form (the password
  shows as `<masked>`), a link that opens a new tab and a typed search;
  replay it with one value changed; a `## Verified` section in this plan
  records the date, what was recorded, what replayed and any step that
  missed.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.

### Phase 6: open the PR

- [x] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

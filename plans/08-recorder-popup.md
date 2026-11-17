# the toolbar button opens a small screen to start a recording and look back at old ones, and stops a recording with one click

## The ask

The person, 21/10/2026: "if i click the extension button, then it should not
record immediately, it have to have a small screen there which is having a
starting button to record. and if it is recording and clicked that button,
then it is fair to stop recording immediately. have option to see the
existing recordings also in that page and show the actions. ... in that
screen, have option to goto the settings as well."

Today the toolbar button has no popup (`extension/manifest.json` `action`
holds only a title and icons), so `chrome.action.onClicked` fires and
`Recorder.toggle` in `extension/src/recorder.ts` starts or stops at once
(`plans/05-record-steps.md` Decision 1). One recording runs at a time, and
the button in any window stops it. `Alt+Shift+R` calls the same `toggle`.

So, once this lands:

- Not recording, a click opens a popup about 360 px wide: a "Start
  recording" button that records the window the popup was opened over, the
  profile's recordings newest first (title, start time, step count), a way
  into one recording's steps, and a link to the settings page.
- One recording's steps read as the lines `recording_get` gives Claude
  (`host/src/tools/recording.rs` `step_line`), passwords as `<masked>`, with
  a back control.
- Recording, a click stops at once and no popup opens.

## Constraints

- "it should not record immediately": a click when idle never starts a
  recording by itself.
- "if it is recording and clicked that button, then it is fair to stop
  recording immediately": no popup and no confirm while recording.
- Nothing is added to web pages (`plans/05-record-steps.md` § Constraints).

## Alternatives

### Decision 1: how one button opens a popup when idle and stops when recording (two-way door)

`onClicked` "will not fire if the action has a popup", so the popup has to
be switched off while recording and back on after.

Searched 21/10/2026: "chrome.action.setPopup empty string onClicked",
"chrome extension action.setPopup popup per tab", "chrome.action.openPopup
version"; read the `chrome.action` reference (updated 11/09/2026), MDN
`action.setPopup`, and the popup guide, now in
`docs/external/chrome-extension-apis.md` § chrome.action.

| Must | Global `setPopup` switch | Per-tab `setPopup` on recorded windows | Popup always, with a Stop button | No default popup, `openPopup` from `onClicked` |
| --- | --- | --- | --- | --- |
| A click while recording stops with no popup | yes | yes | no (a popup opens) | yes |
| Works on Chrome 120 (`minimum_chrome_version`) | yes | yes | yes | no (`openPopup` is 127+) |
| **Survives** | **yes** | **yes** | no | no |

| Criterion | Weight | Global switch | Per-tab switch |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 3 |
| Reliability | 35 | 5 | 3 |
| Compatibility with today's button | 25 | 5 | 4 |
| **Weighted total** | **100** | **5.00** | **3.25** |

- Global efficiency 5: one `setPopup` call at start and one at stop. Per-tab
  3: a call for every tab of every recorded window, and again for each new
  tab and window that joins.
- Global reliability 5: one recording at a time, so one global value says
  it all. Per-tab 3: MDN says a tab's popup resets when the tab navigates,
  the Chrome page is silent, and a tab that joins races its first click.
- Compatibility: today the button in any window stops the recording; the
  global switch keeps that. Per-tab would open the popup in other windows,
  where Start has to refuse while a recording runs.

Sensitivity: per-tab only wins if several recordings may run at once, which
plan 05 rules out. Risk: the global value is lost when the service worker
stops, or a tab-specific popup set elsewhere overrides it; Phase 1's proof
checks both, and the worker sets the popup again from `rec:active` each
time it wakes.

**Chosen: the global switch, `setPopup({ popup: "" })` at start and
`setPopup({ popup: "popup.html" })` at every stop.** Revisit if two
recordings may run at once.

### Decision 2: what `Alt+Shift+R` does (two-way door)

Searched 21/10/2026: "chrome commands _execute_action onCommand"; read the
`chrome.commands` notes in `docs/external/chrome-extension-apis.md`
§ chrome.commands ("Action commands don't dispatch `onCommand` events").

| Must | Keep `toggle-recording`, starting at once | `_execute_action`, opening the popup |
| --- | --- | --- |
| Starts and stops with no pointer | yes | yes (the chord, then Enter on Start) |
| **Survives** | **yes** | **yes** |

| Criterion | Weight | Keep `toggle-recording` | `_execute_action` |
| --- | ---: | ---: | ---: |
| Performance efficiency | 50 | 5 | 3 |
| Reliability | 30 | 5 | 4 |
| Same behaviour as the button | 20 | 3 | 5 |
| **Weighted total** | **100** | **4.60** | **3.70** |

- Efficiency: one chord against a chord and a key. The person asked about
  the click, not the shortcut; a chord is already a deliberate act.
- Reliability 4: the popup has to take focus before Enter lands.

Sensitivity: `_execute_action` wins only if matching the button outweighs
keystrokes (weight 45 or more). Risk: the person presses the chord by
accident and records; the "REC" badge shows it and the same chord stops.

**Chosen: keep `toggle-recording`; the shortcut starts and stops at once.**
The menu text says so. Revisit if the person asks for the chord to open the
popup.

### Decision 3: where the popup gets each step's text (two-way door)

The person asked to "show the actions"; Claude reads them as
`recording_get`'s lines, rendered in Rust by `step_line`.

Searched 21/10/2026: "share golden test fixtures between Rust and
TypeScript"; read `host/src/tools/recording.rs` and
`host/tests/fixtures/recordings.json`.

| Must | A TypeScript `stepLine` pinned by a shared golden file | Ask the native host to render | Show the stored JSON |
| --- | --- | --- | --- |
| Same text as `recording_get` | yes | yes | no |
| Works with the native host down (`design/settings--disconnected.png` is a real state) | yes | no | yes |
| **Survives** | **yes** | no | no |

One option survives, so no weighted table. Risk: the two renderers drift;
both test suites compare against one golden file (Contract).

**Chosen: a TypeScript `stepLine`, with
`host/tests/fixtures/recording-lines.txt` read by both `host/tests/mcp.rs`
and `extension/test/popup.test.ts`.** Revisit if the host is always up.

### Decision 4: how the popup reads and deletes recordings (two-way door)

Searched 21/10/2026: "chrome extension popup runtime.sendMessage service
worker wake"; read `Recorder` in `extension/src/recorder.ts`.

| Must | Messages to the worker's `Recorder` | The popup reads and writes `storage.local` itself |
| --- | --- | --- |
| A delete stays deleted | yes | no (`Recorder` caches the index and writes it back on its next write) |
| **Survives** | **yes** | no |

**Chosen: messages to the worker, which calls `Recorder.list`, `get`,
`remove` and a new `start`.** One survivor. Revisit if the popup needs data
the worker does not hold.

### Decision 5: deleting a recording from the popup (two-way door)

Recordings hold typed values and URLs (`plans/05-record-steps.md`
§ Security); today only Claude's `recording_delete` removes one.

Searched 21/10/2026: "undo vs confirm destructive action popup", "chrome
extension popup closes on blur"; the popup guide ("There is no way to keep
the popup open after the user has clicked away").

| Must | Delete, then confirm in place | No delete in the popup | Delete at once, Undo for 5 s |
| --- | --- | --- | --- |
| The recording in progress cannot be deleted | yes | yes | yes |
| **Survives** | **yes** | **yes** | **yes** |

| Criterion | Weight | Confirm in place | No delete | Undo |
| --- | ---: | ---: | ---: | ---: |
| Privacy | 40 | 5 | 2 | 5 |
| Reliability (no loss by accident) | 35 | 5 | 5 | 3 |
| Performance efficiency | 25 | 4 | 1 | 5 |
| **Weighted total** | **100** | **4.75** | **2.80** | **4.30** |

- Undo reliability 3: the popup closes on any click outside it, and the
  pending delete then happens with no way back.
- No delete privacy 2 and efficiency 1: the person has to ask Claude.

Sensitivity: Undo wins only with efficiency above 50. Risk: a second click
lands by reflex; the confirm button sits where Delete was not, and says
"Delete for good".

**Chosen: Delete on the steps view, then "Delete for good" in place.**
Revisit if the person wants to clear several at once.

## The decision

The manifest's `action` gets `default_popup: "popup.html"`. The recorder
switches the popup off globally at start and on at every stop (Decision 1),
so a click while recording reaches `onClicked` and stops. The shortcut
keeps toggling directly (Decision 2). The popup is plain TypeScript and DOM
like the settings page (`plans/06-settings.md` Decision 9), styled from
`theme.gen.css`. It asks the worker for the list, one recording and a
delete, and asks it to start one for the popup's own window (Decision 4).
Step lines come from a TypeScript port of `step_line` held to the Rust one
by a shared golden file (Decision 3). Delete sits on the steps view with a
confirm in place (Decision 5). The settings link calls
`chrome.runtime.openOptionsPage()`.

Design: Penpot, project `browser-hand`, file `Settings`, page `Settings`,
boards `popup--idle` (Start, recent recordings, settings link),
`popup--empty` (no recordings yet) and `popup--steps` (one recording's
steps and a back control), about 360 px wide. They are being drawn
separately and are not exported yet; Phase 1's first item lands
`design/popup--idle.png`, `design/popup--empty.png` and
`design/popup--steps.png`. Until then the phases assume the layout this
section describes. The boards show no delete or stopped-with-reason state:
the steps view's Delete uses the `danger` token, and a stop reason is a
line of `text2` under the title.

New permissions: none (`action` and `storage` exist). New dependencies:
none. New files are extension pages only.

Standards: `docs/standards.md` (types, vitest, cargo test, build, through
`npm --prefix extension test && cargo test --manifest-path host/Cargo.toml
&& sh scripts/build.sh`).

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| `chrome.action.setPopup`, `default_popup`, `windows.getCurrent` from a popup | `docs/external/chrome-extension-apis.md` § chrome.action | `scripts/prove/action-popup.sh` | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/action-popup.sh`, `scripts/prove/action-popup/` | new | 1 | the proof | expected |
| `design/popup--idle.png`, `design/popup--empty.png`, `design/popup--steps.png` | new | 1 | board exports | fixed |
| `design/README.md` | edit | 1 | the popup boards in its table | expected |
| `extension/manifest.json` | edit | 2 | `default_popup`, the button's title | expected |
| `extension/popup.html`, `extension/src/popup/popup.ts`, `extension/src/popup/page.ts`, `extension/src/popup/popup.css` | new | 2 | the popup | expected |
| `extension/src/popup/lines.ts` | new | 2 | `stepLine`, the TypeScript port | expected |
| `extension/src/recorder.ts` | edit | 2, 3 | `setPopup` in `RecorderDeps.action`, `start`, popup switching | reuse |
| `extension/src/background.ts` | edit | 2 | popup messages, popup sync on wake | reuse |
| `extension/build.mjs` | edit | 2 | the popup entry and files | reuse |
| `host/tests/fixtures/recording-lines.txt` | new | 2 | golden step lines | fixed |
| `host/tests/mcp.rs` | edit | 2 | compares `step_line` with the golden file | reuse |
| `extension/test/popup.test.ts` | new | 2-4 | popup tests | expected |
| `extension/test/record.test.ts` | edit | 2, 3 | popup switching | reuse |
| `README.md`, `plans/05-record-steps.md`, `plans/06-settings.md` | edit | 3 | how to record; amended notes | expected |

*Reused, not rewritten:*

- `extension/src/recorder.ts` `Recorder.list`, `get`, `remove`: the
  popup's data, through the worker; `toggle`'s `startNow` behind a new
  `start` that never stops.
- `extension/src/recorder.ts` `badgeTab`, `stopNow`, `full`: every stop
  path already runs through these, so the popup switch goes there once.
- `extension/src/options/page.ts` `SettingsPage`: the plain-DOM pattern,
  one `render` per view.
- `extension/src/options/theme.gen.css` from `design/theme.md`: the
  popup's colours and type, light and dark.
- `host/tests/fixtures/recordings.json`: the recordings the golden lines
  are rendered from.
- Searched `extension/src` for an existing popup, list renderer or step
  formatter in TypeScript: none; step text exists only in Rust.

## Contract

`host/tests/fixtures/recording-lines.txt`: for every recording in
`host/tests/fixtures/recordings.json`, a line `# <id>`, then one line per
step exactly as `step_line` writes it, Claude's steps included. Owned by
the host; `cargo test` and `npm --prefix extension test` both fail when
their renderer differs from it. A change to `step_line` changes this file
in the same commit.

## Edge cases

- The service worker was asleep: `runtime.sendMessage` from the popup wakes
  it; on every wake the worker sets the popup from `rec:active`.
- A recording stops itself (idle, window closed, 5,000 steps, "FULL"): the
  same stop paths set the popup back, so the next click opens it.
- "FULL": the newest recording shows its stop reason in the list.
- Start pressed on a `chrome://` page or a blocked site: it starts as the
  button does today (the gap is noted), and the popup closes.
- The popup's window is not the focused one: it records the window the
  popup belongs to (`windows.getCurrent`), not the focused one.
- No recordings: the `popup--empty` state, with Start and the settings
  link.
- A recording of 5,000 steps: the steps view renders them all in one
  scrolling list, under 600 px tall.
- Native host down: the popup still works; it reads only the profile's
  storage.

## Security

Entry points: the popup page (the person, in their own profile), and the
worker's new popup messages (start, list, get, delete).

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Elevation of privilege | a content script or page asks the worker to start a recording or delete one | popup ops accepted only when `sender.id` is ours, `sender.tab` is absent and `sender.url` is `popup.html` | `record.test.ts` "refuses popup ops from a tab" |
| Tampering (injection) | a page title or ARIA name carries markup into an extension page | titles and lines are set with `textContent`, never `innerHTML`; the default extension CSP | `popup.test.ts` "renders page text as text" |
| Information disclosure | the steps view shows a password | the stored value is already `<masked>`; `stepLine` masks on `meta.masked` too | `popup.test.ts` "masks" from the golden file |
| Repudiation | the person forgets it is recording | the "REC" badge is unchanged; a click stops | `record.test.ts` popup switching |

Data: nothing new is stored. The popup reads the recordings plan 05 keeps
and can delete them. Logged: nothing. Checklist: OWASP Top 10 2025
(Broken Access Control, Injection).

## Rollback

No stored data changes shape. An older build ignores the popup; its
`default_popup` is gone with the manifest, and the button toggles again.

## Declined

- Popup always, with a Stop button: Decision 1 must (a click while recording
  has to stop at once).
- `openPopup` from `onClicked`: Decision 1 must (Chrome 127+, minimum 120).
- Per-tab `setPopup`: Decision 1, efficiency and reliability.
- `_execute_action` for the shortcut: Decision 2, efficiency.
- Host-rendered lines and raw JSON: Decision 3 musts.
- The popup reading and writing storage itself: Decision 4 must.
- Undo instead of confirm, and no delete: Decision 5.
- Replay from the popup: not asked; replay stays Claude's tool.

## What the tests hold

`record.test.ts` pins the popup switch on every start and stop path, the
sync on wake, `start` never stopping, and the refused tab sender.
`popup.test.ts` (jsdom, like `settings.test.ts`) pins the list, the empty
state, the steps view with its back control, Start sending the popup's
window, delete with confirm, text rendered as text, and `stepLine` against
the golden file, which `host/tests/mcp.rs` also checks for `step_line`.
The real button, popup and switch are the proof and the walk.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove the popup switch, land the boards (needs you at Chrome and Penpot)

- [x] The person exports Penpot boards `popup--idle`, `popup--empty` and
  `popup--steps` (file `Settings`, page `Settings`; export needs a Penpot
  login) to `design/popup--idle.png`, `design/popup--empty.png` and
  `design/popup--steps.png`, and `design/README.md` lists them.
  Not done 21/10/2026: export needs a Penpot login. Phases 2 to 4 were built
  from the boards' shapes, text and fills, read from the file through the
  Penpot API (a `.penpot` export), not from PNGs. `design/README.md` already
  lists the three boards as not exported yet.
  Landed 17/11/2026: exported as PNGs through the Penpot API (file id
  matched `.penpot.json`), 362 px wide with the 1 px edge:
  `design/popup--idle.png`, `design/popup--empty.png`,
  `design/popup--steps.png`, listed in `design/README.md`.
- [x] `scripts/prove/action-popup.sh` loads a proof extension kept in
  `scripts/prove/action-popup/` with a `default_popup`, per
  `docs/external/chrome-extension-apis.md` § chrome.action: the popup's
  button reports `windows.getCurrent()` and sets the popup to `""`; the
  person clicks the icon (`onClicked` must fire), stops the worker from
  `chrome://serviceworker-internals`, navigates the tab and opens a new
  window, clicks again (still `onClicked`), then the worker sets
  `popup.html` and the next click opens the popup. It prints `PASS` when
  every step held.
  Written 21/10/2026, not run yet: it needs the person at Chrome. The proof
  extension reports to a local server the script runs (`serve.py` on
  127.0.0.1:8791, one JSON line per event), so it needs no `key` and no
  host manifest. The worker reports `getPopup()` each time it wakes, so the
  script can tell a value lost on the worker stop (a note, covered by the
  sync on wake) from a failed click (FAIL). The script's header lists the
  person's steps a to f.
  Headless on Chrome for Testing, 17/11/2026: the popup page opened as a tab and its button clicked over
  CDP; `onClicked` simulated with `chrome.action.onClicked.dispatch(tab)`
  only once `getPopup()` read `""`; `""` held across a worker stop (about 35 s
  idle), a tab load and a new window, and `setPopup("popup.html")` brought the
  popup back. Not shown: a real toolbar click, and that a popup opens over a
  window (a tab is not a popup). The script's "global popup value was lost"
  note fired falsely: the wake-up page counted as a popup opened at
  `clicks == 1`.
- [x] Check: the script exits 0 and prints `PASS`; a popup value lost when
  the worker stops is handled by the sync on wake in Phase 2, anything else
  reopens Decision 1.

### Phase 2: the rough cut (needs you: try it)

- [x] With no recording, the button opens `popup.html`: Start records the
  popup's window and closes the popup, the recordings list newest first
  with title, time and step count, and a Settings link calling
  `chrome.runtime.openOptionsPage()`, laid out as `design/popup--idle.png`,
  plain (expected in `extension/src/popup/`), pinned by
  `extension/test/popup.test.ts`.
  Landed 21/10/2026: `PopupPage` in `page.ts` (built once, one `render`, as
  `SettingsPage`), `popup.ts` its entry. Times read "Today 18:09",
  "Yesterday 11:20", else "2026-10-19 11:20" in local time, as the board
  has them. The Settings link also closes the popup. One addition: a popup
  that opens while a recording is on (Chrome lost the switch) sends a new
  `stop` op and closes, so that click still stops at once.
- [x] While recording, the popup is switched off globally, so a click stops
  at once; every stop path switches it back, and the worker syncs it from
  `rec:active` on wake (expected in `extension/src/recorder.ts` and
  `extension/src/background.ts`), pinned by `record.test.ts`.
  Landed 21/10/2026: `setPopup` joins `RecorderDeps.action`; `startNow`
  switches it off, `stopNow` and `full` back on, and `Recorder.syncPopup()`
  runs when `background.ts` loads. `start` returns false, and does nothing,
  when a recording is on.
- [x] Popup messages reach `Recorder` only from the popup page, never from a
  tab (expected in `extension/src/background.ts`), pinned by
  `record.test.ts` "refuses popup ops from a tab".
  Landed 21/10/2026: the check (`fromPopup`) and the ops (`popupOp`: list,
  get, delete, start, stop) are in `recorder.ts` so the tests reach them;
  `background.ts` only wires them to `runtime.onMessage`, and Start finds
  the window's active tab with `tabs.query`.
- [x] A recording opens to its steps, one `stepLine` per step with a back
  control, as `design/popup--steps.png` (expected in
  `extension/src/popup/lines.ts`), pinned by `popup.test.ts` and the
  golden `host/tests/fixtures/recording-lines.txt`, which `host/tests/mcp.rs`
  also checks.
  Landed 21/10/2026: the board draws friendlier lines ("type "hisham" in
  Username"); the popup shows `recording_get`'s lines as Decision 3 chose,
  Claude's steps included. `recordings.json` gains `rec_old`'s 4 steps
  (already in its list) so the golden file covers scroll, a blocked site,
  a shadow selector chain, a long value cut by character and a number value.
- [x] The button's title says a click opens browser-hand and the shortcut
  records; `Alt+Shift+R` still toggles (expected in
  `extension/manifest.json` and `extension/src/recorder.ts`).
  Landed 21/10/2026: "browser-hand: click to record your steps or see past
  ones (Alt+Shift+R records at once)"; the FULL title ends "Click to open
  browser-hand."
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes, and `dist/` holds
  `popup.html` and `popup.js`.
  Landed 21/10/2026: 222 extension tests and 100 host tests pass (lines:
  extension 78.4%, host 82.8%), `cargo clippy -D warnings` and
  `cargo fmt --check` are clean, and `npm run build` puts `popup.html`,
  `popup.js` and `popup.css` in `dist/`. `sh scripts/build.sh` was not run
  here, since it reloads the person's live extension; it runs after merge.
- [ ] You try it: reload the extension, click the button (the popup opens,
  nothing records), press Start, do a short task, click the button (it stops,
  no popup), click again and open the new recording. Say whether the popup
  and the steps read right. What you want changed goes into the phases
  below.

### Phase 3: the rest of the flow

- [x] No recordings shows `design/popup--empty.png`; a stopped recording
  shows its stop reason; "FULL" and the idle stop leave the popup on
  (expected in `extension/src/popup/page.ts`), pinned by `popup.test.ts`
  and `record.test.ts`.
  Landed 21/10/2026: the steps view's line under the title always says how
  it ended ("stopped by you", "stopped: its window closed"); a list row adds
  it only when the person did not stop it. A FULL wrote nothing, so `full`
  now also tries a small index-only write with the reason ("could not save:
  ..."); when that fails too, the row says "stopped".
- [x] The steps view's Delete asks "Delete for good" in place and removes
  the recording through `Recorder.remove`, then returns to the list,
  pinned by `popup.test.ts`.
  Landed 21/10/2026: Delete turns into "Keep it" in the same place, focused,
  and "Delete for good" (the `danger` fill) appears at the other end of the
  row; a refused delete shows the worker's reason and keeps the recording.
- [x] The popup works by keyboard: focus starts on Start, Tab reaches each
  recording, Enter opens it, Escape goes back, pinned by `popup.test.ts`.
  Landed 21/10/2026: every row is a button; opening one focuses Back, and
  Escape first leaves the confirm, then the steps, putting focus back on
  the row it came from.
- [x] `README.md`'s "how to record" says a click opens the popup and the
  shortcut records at once; `plans/05-record-steps.md` Decision 1 and
  `plans/06-settings.md` § Constraints get `Amended by 08-recorder-popup.md`
  notes and dated sections; `host/src/instructions.md` and the skill say the
  person starts recording from the popup.
  Landed 21/10/2026: also the README's intro and Settings section, the
  `recording_list` description, `NONE_YET` and `Recorder.get`'s error, and
  the skill's note on where Pace is set.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
  Landed 21/10/2026: as Phase 2's check; `sh scripts/build.sh` not run here.

### Phase 4: the look

- [x] The popup matches `design/popup--idle.png`, `design/popup--empty.png`
  and `design/popup--steps.png` at 360 px wide in light and dark, from
  `theme.gen.css` tokens only, and never taller than 600 px, pinned by
  `popup.test.ts` (no colour literal in `popup.css`, as `theme.test.ts`
  holds for the settings page).
  Landed 21/10/2026: matched to the boards' measures (52 px header, 44 px
  Start, 56 px rows, 16 px gutters) with no PNGs to compare against. Where
  the board uses a size with no token, the token next to it: Start's label
  is 14 px (board 15), the row chevron 24 px (board 20). The steps panel
  scrolls at 384 px so the popup stays under 600 px; a wrapped step line
  indents under its own text. "Delete for good" is `danger` with `surface`
  text (4.83:1 light, 6.42:1 dark).
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes, and headless screenshots
  of a popup preview (`KNOWLEDGE.md`, the settings preview) sit beside the
  boards for the person to compare.
  Landed 21/10/2026: tests as Phase 2's check. Headless Chrome shots of a
  preview on a fake worker (idle, empty, steps, confirm, light and dark)
  were taken and checked by eye; they are not committed, since the boards
  they sit beside are not exported yet.

### Phase 5: the walk (needs you at Chrome)

- [ ] In one profile: open the popup with no recordings, start from it,
  record across a new tab, stop with one click, open the steps (a password
  shows `<masked>`), delete one, open Settings from the popup, and start
  and stop with `Alt+Shift+R`; a `## Verified` section in this plan records
  the date and what was seen.
- [ ] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.

### Phase 6: open the PR

- [x] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.
  Landed 21/10/2026: https://github.com/izam-mohammed/browser-hand/pull/18,
  opened before phases 1, 2's try-it and 5, which need the person.

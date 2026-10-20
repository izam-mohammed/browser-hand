# Claude clicks, types, scrolls and drags in the selected profile the way a person's hands would, and sees the result in screenshots

## The ask

"I want the actions to be humane as much as possible." The tools are Claude
in Chrome's `computer` (13 actions), `resize_window`, `browser_batch` and
`upload_image`, with the same schemas
(`reference/claude-in-chrome/tools/computer.json` and siblings). Humane means
the page receives what a hand on a mouse and keyboard produces: a cursor that
travels a curved path and slows into its target, a press that is held for a
moment, keys pressed and released one by one with uneven gaps, a wheel that
turns in ticks. It does not mean taking over the user's own cursor.

Builds on `plans/01-bridge.md` and the debugger manager from
`plans/02-page-tools.md`. Research behind every default:
`docs/research/humane-input.md`.

## Alternatives

### Decision 1: what channel carries input into the page? (one-way door)

Searched 17/10/2026: "CDP Input.dispatchMouseEvent isTrusted true events
detection Runtime.enable leak anti-bot", "CDP Input.dispatchMouseEvent
event.isTrusted true puppeteer page.mouse trusted events documentation",
"playwright docs input trusted events dispatchEvent untrusted isTrusted",
"chrome.debugger attach infobar started debugging this browser
silent-debugger-extension-api flag"; read the CDP Input domain, the
chrome.debugger reference and rebrowser-patches
(`docs/external/chrome-debugger-cdp.md`, fetched 17/10/2026). Nothing beat
CDP on the musts.

| Must | CDP `Input.*` through `chrome.debugger` | Synthetic DOM events from a content script | OS-level events from the host |
| --- | --- | --- | --- |
| Page sees trusted input (`isTrusted` true) | yes per Chromium source, proved in Phase 1 | no (script-made events are untrusted by spec) | yes |
| Leaves the user's own cursor and keyboard alone | yes | yes | no (moves the real pointer, needs the window focused) |
| **Survives** | **yes** | no | no |

- Source and the unverified status of `isTrusted`:
  `docs/external/chrome-debugger-cdp.md` § isTrusted of CDP input.

Risk: the debugging bar shows in every tab while attached; the manager
detaches after 30 s idle so it closes 5 s later
(`docs/external/chrome-debugger-cdp.md` § Infobar while attached).

**Chosen: CDP `Input.dispatchMouseEvent`, `dispatchKeyEvent` and `insertText`.**
Revisit if Phase 1 shows `isTrusted` false.

### Decision 2: where is the motion generated? (two-way door)

Searched 18/10/2026: "chrome native messaging latency per message overhead
stdio high frequency messages"; read Chrome's native messaging guide. It
gives no latency figures, but every message is JSON with a length prefix
over the host's stdin and stdout, a separate process, so a per-frame message
pays that cost 60 times a second. The choice holds.

| Criterion | In the extension, next to dispatch | In the Rust host, one frame per event |
| --- | --- | --- |
| Performance efficiency | one native message per action | about 60 messages a second per move over the native port |
| Reliability | timing held by one timer loop | jitter from two process hops per event |

**Chosen: in the extension (`extension/src/humane/`).** Revisit never.

### Decision 3: what path does the cursor take? (two-way door)

Searched 17/10/2026: "minimum jerk trajectory Flash Hogan 1985",
"Fitts law mouse pointing regression constants MacKenzie 1992", "human_mouse
OR human-cursor python HumanCursor selenium bezier"; read ghost-cursor
(`spoof.ts`, `math.ts`), the WindMouse write-up at ben.land, HumanCursor and
MacKenzie's 1992 paper (`docs/research/humane-input.md` § 1).

| Criterion | Weight | Straight line, even steps | Bezier with minimum-jerk timing | WindMouse |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency | 30 | 5 | 4 | 4 |
| Fit to the ask (humane) | 40 | 1 | 4 | 4 |
| Reliability (ends on target) | 20 | 5 | 4 | 3 |
| Maintainability of the result | 10 | 5 | 4 | 3 |
| **Weighted total** | **100** | **3.40** | **4.00** | **3.70** |

- Fit: minimum-jerk speeds up and slows down like a reaching hand (Flash and
  Hogan, 1985); a straight constant-speed path is the pattern
  `docs/research/humane-input.md` § 4 lists as machine-like.
- Bezier anchors on one side, spread clamped 2 to 200 px, overshoot within
  120 px for moves of 500 px or more, then a correction: ghost-cursor's
  defaults (§ 1, Path models and Overshoot).
- WindMouse reliability 3: its random walk ends near, not on, the target and
  needs a final snap (§ 1, Path models).

**Chosen: cubic Bezier sampled by a minimum-jerk profile, with overshoot.**
Revisit if the walk shows misses on small targets.

### Decision 4: how is text typed? (two-way door)

Searched 17/10/2026: "Dhakal Oulasvirta Observations on Typing from 136
Million Keystrokes average inter-key interval WPM", "puppeteer-humanize
typeInto config mistakes delays"; read the CHI 2018 paper, the
puppeteer-humanize README and the CDP Input domain (`insertText`,
`dispatchKeyEvent`) (`docs/research/humane-input.md` § 2).

| Criterion | Per key, gaps drawn from typing research | Per key, fixed gap | `Input.insertText` for the whole string |
| --- | --- | --- | --- |
| Fit to the ask | keyDown, char, keyUp per key with uneven gaps | even gaps | one input event, no key events |
| Performance efficiency | about 0.24 s per character | set by the gap | instant |
| Reliability | fires keydown, keypress, beforeinput, input like a keyboard | same | skips key handlers some pages need |

- Gaps: mean 238.7 ms (SD 111.6), right-skewed, floor about 60 ms; hold
  116 ms (SD 23.9), from Dhakal et al., CHI 2018 (`docs/research/humane-input.md`
  § 2).
- `insertText` stays for emoji, IME text and characters with no key, the use
  CDP documents for it (§ 2, Sending keys through CDP).

**Chosen: per key with research-drawn gaps; `insertText` only for characters
with no key.** Revisit if long texts make Claude's turns too slow (`pace`,
below).

### Decision 5: how are screenshots taken? (two-way door)

Searched 17/10/2026: "chrome.tabs.captureVisibleTab
MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND", "Page.captureScreenshot background
tab chrome.debugger captureVisibleTab active tab only"; read the chrome.tabs
reference (`docs/external/chrome-extension-apis.md`, fetched 17/10/2026) and
the issue on `Page.captureScreenshot` timing out on hidden tabs.

| Criterion | CDP `Page.captureScreenshot` | `chrome.tabs.captureVisibleTab` |
| --- | --- | --- |
| Performance efficiency | no documented rate limit | 2 calls a second (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) |
| Fit to the ask | any tab in the group, `clip` for `zoom` | the active tab only |
| Reliability | reported to hang on hidden tabs (one GitHub issue) | none known |

Sources: `docs/external/chrome-extension-apis.md` § chrome.tabs and
`docs/research/humane-input.md` § 5.

**Chosen: CDP, falling back to `captureVisibleTab` when attach is refused,
with a 10 s timeout.** Revisit if hidden-tab hangs show up in the walk.

## The decision

Feature path. The extension's humane module turns each `computer` action into
a timed run of CDP events (decisions 1 to 4):

- Moves: a Bezier path, one `mouseMoved` every 16 ms (60 Hz, what pages see
  after frame alignment, `docs/research/humane-input.md` § 1 Event rate),
  duration from Fitts's law `MT = a + b log2(D/W + 1)` with W the target's
  width when a `ref` gives it, else 20 px.
- Clicks: move, a short dwell, `mousePressed`, a hold, `mouseReleased`, with
  `clickCount` 2 or 3 for double and triple clicks.
- Scroll: `mouseWheel` ticks of `deltaY` 100 (Chromium's figure for default
  settings), spaced unevenly; `scroll_to` wheels towards the element until it
  is in view and falls back to `scrollIntoView` for containers a wheel does not
  reach.
- Drag: press, a Bezier path with the button held, release.
- Keys: `cmd` maps to Meta on macOS; page zoom shortcuts are refused as the
  reference does.
- Screenshots in CSS pixels; `scale` shrinks only the returned image, and
  coordinates stay in the full frame, as the reference schema says (decision
  5). Each screenshot gets an `imageId` the MCP server keeps for 5 minutes for
  `upload_image`.

`browser_batch` runs in the Rust MCP server: items in order, stop on first
error, images interleaved, no nesting. `resize_window` uses
`chrome.windows.update`. `upload_image` sends the kept screenshot in `chunk`
frames and sets it on a file input (`ref`) or drops it at a coordinate.

A `pace` setting (`human`, the default, or `fast`) in the MCP server's
environment as `BROWSER_HAND_PACE` lets the user trade realism for speed;
`fast` keeps the same events with no travel time or gaps.

Dependencies: none new. Permissions: none beyond `plans/02-page-tools.md`.

## Security

Written 18/10/2026 from the code as built in 27b1462.

**What is protected.** The person's logged-in sessions in the selected
profile: a click or a keystroke sent through `chrome.debugger` acts as them,
with trusted events. What is on screen: a screenshot carries whatever the
tab shows, personal data included. Files: `save_to_disk` writes under
`~/Downloads/browser-hand/` (or `BROWSER_HAND_OUTPUT_DIR`), and
`upload_image` puts a screenshot into a page's file input.

**Who can reach it.**

- The MCP tools `computer`, `browser_batch`, `resize_window` and
  `upload_image`: only the Claude Code process that started `browser-hand mcp`
  over stdio, as the person's own user. Each call is a tool call the person's
  Claude Code permissions govern.
- The relay: the MCP server reaches the native host over a Unix socket in the
  per-user temp dir, the dir `0700` and the socket `0600`
  (`host/src/paths.rs`, `host/src/native_host.rs`).
- The extension: Chrome starts the native host only for the origin named in
  the host manifest's `allowed_origins`, this extension's id
  (`host/src/install.rs`).
- The page: untrusted. It cannot call the tools, but what it shows reaches
  Claude in screenshots and can try to steer what Claude does next. The trust
  boundary is the tab: every tool checks the tab is in this session's
  browser-hand group (`ownTab` in `extension/src/tabs.ts`, called from
  `extension/src/background.ts`) before it acts or captures.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Spoofing | another extension or local process poses as the host or the extension | `allowed_origins` names only this extension; socket `0600` in a `0700` dir | `host/tests/install.rs` `the_manifest_names_this_host_the_binary_and_only_our_extension`; socket modes: no test yet |
| Tampering | input lands in a tab the session does not own (the person's own tabs, another session's) | `ownTab` refuses with `no_tab` before `computer`, screenshots, `resize_window` and `upload_image` | `extension/test/tabs.test.ts` "never touches another session's tabs" and "an unknown tab id is no_tab" (through `tabs_close` and `navigate`; no test yet sends `computer` to a foreign tab) |
| Tampering | input sent to the wrong profile when several are connected | tab tools refuse to guess a profile | `host/tests/mcp.rs` `with_several_connected_profiles_tab_tools_refuse_to_guess` |
| Elevation of privilege | page text or a screenshot carries instructions that make Claude click, type or upload into the person's accounts (prompt injection) | not by this plan's code: tool results are returned as data, and each tool call goes through the person's Claude Code permissions; deliberate typos declined so no stray text is submitted | no test yet |
| Elevation of privilege | driving `chrome://` pages, other extensions or the Web Store | Chrome refuses the attach; `DebuggerManager.attach` turns it into `debugger_refused` | `extension/test/tools.test.ts` "a refused attach is debugger_refused naming the reason" (a fake refusal; the real one is Chrome's) |
| Information disclosure | screenshots of personal data kept or written out | kept in the MCP server's memory only, pruned after 5 minutes; written to disk only on `save_to_disk`; stderr logs carry errors, never image data or typed text | `host/tests/mcp.rs` `upload_image_sends_the_kept_screenshot_and_refuses_unknown_ids`; the 5-minute expiry: no test yet |
| Information disclosure | `upload_image` posts a screenshot of one site into another site's form | only an id this server issued, only into a tab the session owns; which page receives it is Claude's choice under the person's permissions | `host/tests/mcp.rs` `upload_image_sends_the_kept_screenshot_and_refuses_unknown_ids` (unknown ids refused); cross-site use: no test yet |
| Repudiation | automation in the person's browser nobody notices | Chrome's debugging bar shows while attached, left showing on purpose; tabs sit in a titled browser-hand group | `extension/test/tools.test.ts` "attaches once for several calls and detaches after the idle time"; the bar itself: seen in the Phase 5 walk |
| Denial of service | a runaway action ties up the tab | `wait` 0 to 10 s, `repeat` 1 to 100, `scroll_amount` 1 to 10 (refused by the MCP server and the extension), screenshot 10 s timeout, no nested batches; batch length is not capped | `host/tests/mcp.rs` `out_of_range_inputs_are_refused_before_reaching_the_browser` and `a_batch_cannot_nest`; `extension/test/humane.test.ts` "refuses page zoom shortcuts and bad repeats" and "wait is capped at 10 s"; screenshot timeout: no test yet |

**Data.** Screenshots and typed text may hold personal data, passwords
included when the person gives Claude one to type. Neither is logged.
Screenshots stay in memory for 5 minutes, then go; saved files stay until
the person deletes them. All transport is local (stdio, a Unix socket,
Chrome's native port), so nothing crosses the network here; what Claude
sends to the model is Claude Code's concern.

**Secrets.** None. `BROWSER_HAND_PACE` and `BROWSER_HAND_OUTPUT_DIR` are
settings, not secrets.

**Standard.** OWASP Top 10 for LLM Applications, the 2026 edition per
secondary sources (searched 18/10/2026; genai.owasp.org not yet checked):
prompt injection and excessive agency are the rows that apply. Phase 5's
review walks this table against the code.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/cdp-input.sh` | added in 27b1462, not yet run | 1 | proof driver for trusted CDP input | expected |
| `scripts/prove/cdp-input/` | added in 27b1462, not yet run | 1 | proof extension and test page, kept in the repo | expected |
| `extension/src/humane/path.ts` | new | 2 | Bezier, minimum-jerk, overshoot | expected |
| `extension/src/humane/timing.ts` | new | 2 | Fitts, typing gaps, holds, seeded random | expected |
| `extension/src/humane/params.ts` | new | 2 | every constant, with its source or "assumption" | expected |
| `extension/src/input.ts` | new | 3 | actions to CDP events | expected |
| `extension/src/screenshot.ts` | new | 4 | capture, zoom, scale | expected |
| `host/src/tools/computer.rs` | new | 3 | schema, `pace`, image ids | expected |
| `host/src/tools/batch.rs` | new | 4 | `browser_batch` | expected |
| `extension/src/debugger.ts` | edit | 3 | input and screenshot callers | reuse |

Landed 17/10/2026: both proof files were written in commit 27b1462, ahead
of Phase 1's run; the run with a person at Chrome is still open, so Phase 1
stays unticked and its builder runs and fixes these files, not new ones.

*Reused, not rewritten:* the debugger manager (`extension/src/debugger.ts`,
`plans/02-page-tools.md`); walker refs for click targets and widths
(`extension/src/page/walker.ts`); `chunk` frames and `DataTransfer` setting
for `upload_image` (`extension/src/page/forms.ts`); the echo extension and
host from `scripts/prove/chrome-bridge/` for the Phase 1 proof. Searched
for an existing path or timing helper in the tree: none.

## Open decisions

- Fitts constants: the published mouse pairs disagree (1030 ms and 96 ms/bit,
  or 108 ms and 392 ms/bit, `docs/research/humane-input.md` § 1 Duration), and
  both predict slower moves than a practised user. Default `a = 50 ms`,
  `b = 150 ms/bit`: an assumption, not a sourced figure, chosen to put an
  800 px move to a 40 px target near 0.7 s; tuned in the Phase 5 walk.
- Click dwell and hold: no research figure was found. Default dwell 60 to
  250 ms and hold 60 to 140 ms, both assumptions marked so in `params.ts`.
- The debugging bar: hidden only by launching Chrome with
  `--silent-debugger-extension-api` or a policy install. Default: leave it
  showing, as an honest sign that automation is running.

## Edge cases

- A macOS editing shortcut (`cmd+a`, `cmd+c`) sent by `dispatchKeyEvent`
  may not run the editing command; Phase 1 checks it, and if needed the key
  event carries the matching CDP `commands` entry.
- Target moves during travel (layout shift): with a `ref`, the end point is
  re-read from the element before the press.
- `wait` above 10 s and `repeat` outside 1 to 100: refused with `bad_args`, as
  the reference schema bounds them.
- A screenshot on a tab that refuses attach: `captureVisibleTab` if it is the
  active tab, else `debugger_refused`.
- An `imageId` older than 5 minutes: refused, telling Claude to take a fresh
  screenshot, as the reference does.

## Declined

- Synthetic DOM events and OS-level events (decision 1): failed musts.
- Motion generated in the host (decision 2): an event per native message.
- Straight paths and WindMouse (decision 3): lost on fit and reliability.
- Fixed-gap typing and whole-string `insertText` (decision 4).
- Deliberate typos with backspace, which keystroke research shows people
  make: a typo left in place by an early Enter would submit wrong text into
  the user's real accounts.
- `captureVisibleTab` as the main path (decision 5): active tab only, 2 a
  second.

## What the tests hold

With a seeded random source: paths start and end on their points, stay within
the spread, overshoot only past 500 px and land on target; minimum-jerk
spacing is slow at both ends; move duration grows with distance per the
Fitts constants; typing gaps match the configured mean and floor over 10,000
draws, and key presses are spaced press to press by the research inter-key
interval, hold included; each action yields the expected CDP event sequence (`input.test.ts`
with a recording fake debugger); `fast` pace yields the same events with no
delays; screenshot scaling maps coordinates back exactly; `browser_batch`
stops on the first error. The proof shows trusted input on real Chrome; the
walk shows it looks human.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove trusted CDP input (needs you at Chrome)

- [ ] `scripts/prove/cdp-input.sh` uses the proof extension and test page
  kept in the repo at `scripts/prove/cdp-input/` (no project code), which
  attaches the debugger to the test page, sends a click, a key and `cmd+a` per
  `docs/external/chrome-debugger-cdp.md` § CDP methods, reads back each
  event's `isTrusted` and whether the text got selected, and prints `PASS`
  when all are true.
- [ ] Check: the script exits 0 and prints `PASS`; a false `isTrusted`
  reopens decision 1 before Phase 2.

### Phase 2: the humane model

- [x] Paths, minimum-jerk timing, overshoot, Fitts duration, typing gaps and
  holds, all from one seeded random source and one parameter file (expected
  in `extension/src/humane/`), pinned by `extension/test/humane.test.ts`.
  Landed 17/10/2026: also `extension/src/humane/keys.ts`, the US key table and
  macOS editing commands.
- [x] Check: `npm --prefix extension test` passes.

### Phase 3: the `computer` tool acts

- [x] Every action but `screenshot` and `zoom` turns into CDP events through
  the debugger manager (expected in `extension/src/input.ts`), with schema,
  bounds and `pace` in `host/src/tools/computer.rs`, pinned by
  `extension/test/input.test.ts` and `host/tests/computer.rs`.
  Landed 17/10/2026: the action engine is `extension/src/input.ts`; schema,
  bounds and `pace` are `ComputerArgs` in `host/src/tools/args.rs` and
  `do_computer` in `host/src/mcp.rs` (no `host/src/tools/computer.rs`). Engine
  tests are in `extension/test/humane.test.ts`.
- [x] Check: `npm --prefix extension test` and `cargo test` pass.

### Phase 4: screenshots, batch, resize and image upload

- [x] `screenshot` and `zoom` with `scale` and `save_to_disk`, image ids kept
  5 minutes (expected in `extension/src/screenshot.ts`), pinned by
  `extension/test/screenshot.test.ts`.
  Landed 17/10/2026: image ids live in the MCP server
  (`host/src/tools/images.rs`), which also saves to
  `~/Downloads/browser-hand/`; scaling tests in `extension/test/tools.test.ts`.
  Whether CDP's `clip.scale` multiplies device pixels, as `screenshot.ts`
  assumes, is checked in the walk.
- [x] `browser_batch`, `resize_window` and `upload_image` (expected in
  `host/src/tools/batch.rs`), pinned by `host/tests/batch.rs`.
  Landed 17/10/2026: batch and upload are `do_batch` and `do_upload_image` in
  `host/src/mcp.rs`, pinned by `host/tests/mcp.rs` (no
  `host/src/tools/batch.rs`).
- [x] Check: `npm --prefix extension test` and `cargo test` pass.

### Phase 5: review, tune and the walk (needs you at Chrome)

- [x] Code review of this plan's diff recorded in
  `docs/research/humane-input-review.md`: findings, fixes and re-run checks,
  or an explicit no-findings result.
- [x] Walk, recorded under `## Verified`: in one profile Claude fills a login
  form on a test page by clicking and typing, scrolls a long page and drags a
  slider, while a page script logs every pointer and key event to the console;
  the log shows curved paths, uneven gaps and trusted events. Fitts constants
  and dwell defaults adjusted in `params.ts` if moves look wrong, each change
  noted.
- [x] Check: `## Verified` in `plans/03-humane-input.md` records the walk
  as `passed`, with what was seen.

### Phase 6: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

## Verified

20/10/2026, Profile 4 ("fabulate"), on a local test page with a login form,
a range slider and a 3000 px tall block, where a capture-phase script logs
every pointer, mouse, key and wheel event (`http://127.0.0.1:8765/hands.html`).
passed.

- Clicked Username, typed `izam.walk`, clicked Password, typed 8 characters,
  clicked Log in: the page showed `login izam.walk / 8 chars`.
- Every one of the 99 logged events had `isTrusted: true`.
- Moves curve: on the way to the drag start the path went through y 264 and
  then down to 286, and the drag itself bowed down to y 328 before landing on
  [344, 286]. Gaps between moves ran from 4 ms to 113 ms (median), with dwell
  pauses up to 4 s while typing.
- Key gaps were uneven, 257 ms to 667 ms, with one 1227 ms pause.
- Scroll sent 5 `wheel` events at [600, 500] with uneven gaps (80 to 200 ms).
- Drag from [70, 286] to [344, 286] took the slider from 10 to 81. In the full
  walk it missed, because the login line appears above the slider and pushes
  it down by one line; the walk's fixed coordinates were stale, the drag was
  fine. 66 px is the thumb's edge and misses, 70 px hits.
- Timing: before the fix in `input.ts`, slow Chrome event dispatch (about
  100 ms per event) stretched every move, so a 100 px move took 3 to 6 s and
  sent 82 points. After it, the same two clicks took 1.5 s and 1.1 s and sent
  19 points. `params.ts` constants were left as they are.
- Screenshot: the first one after a fresh debugger attach reported the
  viewport 56 px too tall, while Chrome's debugging bar slid in. Fixed with a
  300 ms settle wait in `screenshot.ts`.
- Default profile ("Izam"): clicks and typing on pages with a password field
  fail with `debugger_refused: ... Cannot access a chrome-extension:// URL of
  different extension`. Another extension (likely a password manager) puts a
  frame in the page. Wikipedia works in the same profile. Not fixed.

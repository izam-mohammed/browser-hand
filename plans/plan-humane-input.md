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

Builds on `plans/plan-bridge.md` and the debugger manager from
`plans/plan-page-tools.md`. Research behind every default:
`docs/research/humane-input.md`.

## Alternatives

### Decision 1: what channel carries input into the page? (one-way door)

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

| Criterion | In the extension, next to dispatch | In the Rust host, one frame per event |
| --- | --- | --- |
| Performance efficiency | one native message per action | about 60 messages a second per move over the native port |
| Reliability | timing held by one timer loop | jitter from two process hops per event |

**Chosen: in the extension (`extension/src/humane/`).** Revisit never.

### Decision 3: what path does the cursor take? (two-way door)

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

Dependencies: none new. Permissions: none beyond `plans/plan-page-tools.md`.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/cdp-input.sh` | new | 1 | proof driver for trusted CDP input | expected |
| `scripts/prove/cdp-input/` | new | 1 | proof extension and test page, kept in the repo | expected |
| `extension/src/humane/path.ts` | new | 2 | Bezier, minimum-jerk, overshoot | expected |
| `extension/src/humane/timing.ts` | new | 2 | Fitts, typing gaps, holds, seeded random | expected |
| `extension/src/humane/params.ts` | new | 2 | every constant, with its source or "assumption" | expected |
| `extension/src/input.ts` | new | 3 | actions to CDP events | expected |
| `extension/src/screenshot.ts` | new | 4 | capture, zoom, scale | expected |
| `host/src/tools/computer.rs` | new | 3 | schema, `pace`, image ids | expected |
| `host/src/tools/batch.rs` | new | 4 | `browser_batch` | expected |
| `extension/src/debugger.ts` | edit | 3 | input and screenshot callers | reuse |

*Reused, not rewritten:* the debugger manager (`extension/src/debugger.ts`,
`plans/plan-page-tools.md`); walker refs for click targets and widths
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
draws; each action yields the expected CDP event sequence (`input.test.ts`
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

- [ ] Code review of this plan's diff recorded in
  `docs/research/humane-input-review.md`: findings, fixes and re-run checks,
  or an explicit no-findings result.
- [ ] Walk, recorded under `## Verified`: in one profile Claude fills a login
  form on a test page by clicking and typing, scrolls a long page and drags a
  slider, while a page script logs every pointer and key event to the console;
  the log shows curved paths, uneven gaps and trusted events. Fitts constants
  and dwell defaults adjusted in `params.ts` if moves look wrong, each change
  noted.
- [ ] Check: `## Verified` in `plans/plan-humane-input.md` records the walk
  as `passed`, with what was seen.

### Phase 6: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

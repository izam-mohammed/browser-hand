# Evidence for plans/05-record-steps.md

Gathered 18/10/2026 while planning; the tables and choices are in the plan.

## Decision 1: how the person starts and stops recording (two-way door)

- Toolbar efficiency 5: one click from any tab; the settings page means
  switching tabs and back. Reliability 4: a shortcut another extension holds
  is not registered (`commands.getAll()` shows `""`), the button still works.
- Visible state 5: `setBadgeText` per tab puts "REC" on the icon in every
  tab of the window.

Sensitivity: only a settings page that floated over every tab would compete;
Chrome has no such surface. Risk: the button is hidden in the puzzle menu
until pinned; the walk checks the person can find it.

## Decision 2: where recordings are kept (two-way door)

- Efficiency: one in-process write per batch of steps against a port
  message plus a file append. A step is about 400 bytes, so the 10 MB quota
  holds about 25,000 steps without `unlimitedStorage`.
- Reliability 3 for files: steps made while the host is not running are lost.
- Compatibility 3: an extension-initiated frame is new to the protocol, and
  a host of today rejects it (`docs/protocol.md` § Frames). Reading through
  ordinary `call` frames adds only tools, which is not breaking.

- Quota (added 19/10/2026): `storage.local.QUOTA_BYTES` is 10,485,760
  bytes, "ignored" with `"unlimitedStorage"`, and "Updates that would cause
  this limit to be exceeded fail immediately" (storage reference, updated
  11/09/2026). The permissions list (updated 09/09/2026) shows no warning
  for `unlimitedStorage`. At about 500 bytes a step with `meta`, the caps
  (20 recordings of 5,000 steps) come to about 50 MB, five times the quota,
  so the plan asks for `unlimitedStorage` and enforces a 50 MB budget of
  its own with `getBytesInUse`. The settings page's `settings:last` (at
  most 64 KB, `plans/06-settings.md`) shares the area.

Sensitivity: host files would win only if recordings had to be read with
Chrome closed. Risk: the disk fills; recordings are capped at 50 MB and a
failed write stops the recording (Phase 3).

## Decision 3: the step format (two-way door)

- `UserFlow` efficiency 3: its JSON is wordier than a format of our own. The
  default read is a one-line-per-step text rendering, so Claude rarely pays
  for the JSON.
- Compatibility 5: the file opens in DevTools' Recorder panel and replays
  with `@puppeteer/replay`.
- rrweb records DOM snapshots for playback as video; it is not steps.

Sensitivity: an own format wins only if JSON cost were weighted above 70.
Risk: a strict reader rejects extra fields, so browser-hand's own fields
(time, tab, who acted) go in a parallel `meta` array, never on a step.

## Decision 4: how a step names its element (two-way door)

- Efficiency 4: computing the ARIA name walks a few nodes per click, using
  `roleOf` and `nameOf` that `read_page` already runs on whole pages.
- Privacy 3: `aria/` and `text/` carry visible text, which can be a person's
  name; capped at 120 characters.

Sensitivity: one CSS path wins only on pages with stable ids everywhere.
Risk: ARIA names that repeat; the CSS and XPath selectors follow as
fallbacks, in the Recorder's order.

## Decision 5: which tabs are recorded (two-way door)

- Privacy 2: every tab would record windows the person is not looking at.

## Follow-ups

- Claude Code channels could tell Claude the moment a recording stops
  (`notifications/claude/channel`), but they are a research preview needing
  `--dangerously-load-development-channels`
  (https://code.claude.com/docs/en/channels-reference, read 18/10/2026).
- A screenshot per step (`captureVisibleTab`, 2 per second) for a GIF of the
  person's recording through `gif.rs`.
- Never recording on the settings page's blocked sites: planned in
  `plans/06-settings.md` Phase 4.

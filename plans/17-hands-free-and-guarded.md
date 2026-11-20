# browser-hand replays a recording alone, guards sites by allow list, logs every call, saves screenshots on request and waits for the page

## The ask

"Have 1, 2, 3, 4, 7, but make sure 4 is optional with path and all."
The five came from the 20/11/2026 parity check, which found nothing new in
Claude in Chrome (all 20 tools identical to Claude Code 2.1.329, extension
still 1.0.107). These go past parity:

1. Replay a recording without Claude.
2. Per-site allow list.
3. An audit log of every call.
4. Screenshots saved to disk, optional, with a path.
7. A wait helper, so Claude stops guessing with `wait` seconds.

Read from the code, two of them are partly there:

- Replay: `recording_replay` (`host/src/mcp.rs`) replays a recording for
  Claude, and `recording_get` with `format: "devtools"` already exports
  DevTools Recorder JSON. What is missing is a way to run one with no model
  in the loop. `@puppeteer/replay` cannot, because it needs a debug port the
  person's own Chrome does not expose (`KNOWLEDGE.md`, `docs/external/
  puppeteer-replay.md`).
- Screenshots: `computer` takes `save_to_disk` per call and
  `host/src/tools/images.rs` `save` writes into the GIF folder
  (`capture.gif_folder`). Missing: saving every screenshot without Claude
  asking, into a folder of its own, off by default.

Built so far: `docs/built/BUILT-2026-11-14-2216.md` (plans 13 to 16 landed
since; no newer snapshot was written for this plan).

## Constraints

"make sure the 4 is optional with path and all": saving is off until the
person turns it on, and the folder is theirs to set.

## Alternatives

### Decision 1: how a recording runs without Claude (two-way door)

Searched 20/11/2026: `docs/external/puppeteer-replay.md` (read 17/11/2026),
`KNOWLEDGE.md` § Chrome for Testing, plan 14 Decision 1. Found: Puppeteer
Replay drives a browser over CDP, and the person's Chrome has no debug port.

| Must | Baseline: Claude's `recording_replay` | `browser-hand replay` CLI | Puppeteer Replay on a debug port | Runner inside the extension |
| --- | --- | --- | --- | --- |
| Runs with no model in the loop | no | yes | yes | yes |
| Runs in the person's own profile, no debug port | yes | yes | no | yes |
| **Survives** | no | **yes** | no | **yes** |

| Criterion | Weight | CLI | Extension runner |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 5 |
| Reliability | 40 | 4 | 3 |
| Same steps and stops as the Claude replay | 20 | 5 | 3 |
| **Weighted total** | **100** | **4.60** | **3.80** |

- Efficiency 5 both: no model round trip; the CLI uses the host socket the
  MCP server uses, the runner uses no hop.
- Reliability: the CLI is one process that lives until the replay ends (4);
  an MV3 service worker is dropped after about 30 s idle
  (`knowledge/chrome-for-testing.md`), which a slow replay would hit (3).
- Same steps: the CLI calls `do_recording_replay`; a runner is a second
  walker to keep in step (3).

Sensitivity: weighting reliability at 20 and efficiency at 60 leaves the
CLI ahead (4.80 against 4.60). Risk: a replay that clicks the wrong thing
acts as the person; see `## Security`.

**Chosen: the `browser-hand replay` CLI.** Revisit if the extension gets a
keep-alive that holds a worker for minutes.

### Decision 2: the shape of the site allow list (one-way door: a settings key)

Searched 20/11/2026: Chrome's declarativeNetRequest reference (priority:
the highest priority wins, an `allow` rule beats a lower-priority `block`;
`tabIds` only on session rules; 5000 dynamic and session rules at most);
`docs/external/chrome-extension-apis.md` § chrome.declarativeNetRequest.

| Must | Baseline: `sites.blocked` only | `sites.allowed` list | `sites.mode` switch | Prompt per site |
| --- | --- | --- | --- | --- |
| Restrict Claude to listed sites | no | yes | yes | yes |
| No person at the keyboard | yes | yes | yes | no (plan 14 left prompts to Claude Code) |
| An old `config.toml` keeps its meaning | yes | yes | no (a mode flips every list) | yes |
| **Survives** | no | **yes** | no | no |

One survivor, so no weighted table. Rule set: one `block` for every web URL
at priority 1, one `allow` per allowed pattern at priority 2, one `block`
per blocked pattern at priority 3, all with the group's `tabIds`: at most
`1 + 200 + 200` rules, under the 5000 cap.

Risk: an allow list that is non-empty and wrong locks Claude out of
everything; the page's `find`-style tools then say `blocked` with the host.
`blocked` wins over `allowed`.

**Chosen: `sites.allowed`.** Empty (the default) changes nothing.

### Decision 3: the audit log's format (one-way door: others will parse it)

Searched 20/11/2026: "JSON Lines vs SQLite append-only audit log". Found
trade-offs only: an append is one line write, a crash tears at most the last
line, concurrent writers need a lock; SQLite adds queries and transactions.
No benchmark compared them.

| Must | Baseline: none | JSON Lines | SQLite | Plain text |
| --- | --- | --- | --- | --- |
| Survives a crash with at most the last record lost | n/a | yes | yes | yes |
| A script can read it back | n/a | yes | yes | no |
| **Survives** | no | **yes** | **yes** | no |

| Criterion | Weight | JSON Lines | SQLite |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 4 |
| Reliability | 40 | 4 | 5 |
| Dependency surface | 20 | 5 | 2 |
| **Weighted total** | **100** | **4.60** | **4.00** |

- Efficiency: an append, no transaction or fsync per record (5); SQLite
  commits per insert (4). Measured 20/11/2026 in Phase 2: 1000 appends
  of the real line to a temp file took 12 ms (12 µs each).
- Reliability 4: the file has one writer per server and appends are
  `O_APPEND`; two servers can interleave whole lines but not tear them under
  one `write` of a small line. SQLite 5.
- Dependency: `serde_json` is in already; SQLite is a new crate (2).

Sensitivity: weighting reliability at 70 gives SQLite 4.55 to 4.30, so it
would flip. Reading the log is by `jq` and `grep`, not queries, so it holds.

**Chosen: JSON Lines.** Revisit if people want to query months of calls.

### Decision 4: where saving screenshots is configured (two-way door)

Searched 20/11/2026: `docs/book/src/guides/screenshots-and-gifs.md`,
`host/src/config.rs`, `host/src/tools/images.rs`.

| Must | Baseline: `save_to_disk` per call | Settings keys | A `path` argument on `computer` | `BROWSER_HAND_OUTPUT_DIR` alone |
| --- | --- | --- | --- | --- |
| Saves every screenshot with no Claude ask | no | yes | no | yes |
| Claude cannot choose where files land | yes | yes | no | yes |
| Off by default, on with one switch and a folder | no | yes | no | no (no switch) |
| **Survives** | no | **yes** | no | no |

One survivor. The keys are `capture.save_screenshots` (default `false`) and
`capture.screenshot_folder` (default empty, which means the GIF folder).
`save_to_disk` keeps working per call whatever the switch says.

**Chosen: two settings keys.**

### Decision 5: how Claude waits for the page (two-way door)

Searched 20/11/2026: Playwright and Puppeteer wait APIs
(`waitForFunction` polls on an interval, `raf` or `mutation`;
`waitUntil: networkidle` is a load state).

| Must | Baseline: `computer` `wait` seconds | New `wait_for` tool | A condition on `computer`'s `wait` | Claude loops on `javascript_tool` |
| --- | --- | --- | --- | --- |
| Returns when the condition holds | no | yes | yes | yes |
| One call, no model round trip per poll | yes | yes | yes | no |
| The 20 tools keep the reference's schemas | yes | yes | no | yes |
| Survives a navigation mid-wait | n/a | yes | yes | no |
| **Survives** | no | **yes** | no | no |

One survivor. The wait is polled from the extension every 250 ms
(`RESOLVE_POLL_MS`, `extension/src/replay.ts`), not by a `MutationObserver`:
a content script dies with the page on navigation, and the poll survives it.

**Chosen: a new `wait_for` tool, polled from the extension.**

## The decision

- D1: `browser-hand replay` builds a `Server` as the MCP mode does, selects
  the profile and calls the same replay Claude's tool calls.
- D2: `sites.allowed` joins `sites.blocked` and `sites.read_only`; the tool
  gate and the network rules both honour it.
- D3: `audit.enabled` (default `false`) and `audit.file`; one JSON object
  per line, written by the host for every tool call.
- D4: `capture.save_screenshots` and `capture.screenshot_folder`.
- D5: `wait_for` waits for text, a ref's presence, or a URL substring.
- New dependency, permission, host or secret: none.
- No lanes: every part edits `config.rs`, the settings page and the docs.

Standards: `docs/standards.md` (format, lint, types, tests, coverage floors,
audit, secrets, docs, site), through `make check`.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `host/src/config.rs` | edit | 1 to 3 | the new keys, parsing and problems | fixed |
| `host/src/tools/args.rs` | edit | 1 | `WaitForArgs` | expected |
| `host/src/mcp.rs` | edit | 1 to 3 | `wait_for`, screenshot save, audit calls, allow in the gate | expected |
| `extension/src/wait.ts` | new | 1 | the poll behind `wait_for` | expected |
| `extension/src/background.ts` | edit | 1, 3 | route `wait_for`, build `SiteRules` with allowed | expected |
| `host/src/audit.rs` | new | 2 | the JSON Lines writer and redaction | expected |
| `extension/src/sites.ts` | edit | 3 | the allow list in the tool gate | expected |
| `extension/src/site-rules.ts` | edit | 3 | the allow and block-all network rules | expected |
| `host/src/replay_cli.rs` | new | 4 | the `replay` and `recordings` subcommands | expected |
| `host/src/main.rs` | edit | 4 | route the two subcommands, usage text | expected |
| `extension/src/settings.ts` and its page | edit | 5 | the new rows | expected |
| `docs/book/src/`, `plugin/skills/browser-hand/SKILL.md`, `host/src/instructions.md` | edit | 6 | guides, reference, tool text | expected |
| `scripts/prove/*.sh` | new | 6 | one headless proof per feature | expected |

*Reused, not rewritten:*

- `host/src/tools/images.rs` `save`: writes the screenshot; only the folder
  it is given changes.
- `host/src/gif.rs` `output_dir`, `host/src/config.rs` `folder_problem_in`,
  `expand`: folder creation and validation for the new folder keys.
- `extension/src/sites.ts` `gate`, `SiteRules`; `extension/src/site-rules.ts`
  `sessionRules`: the allow list extends them, no parallel gate.
- `host/src/mcp.rs` `Server::call`, `do_recording_replay`, `do_select_profile`:
  the one place calls leave the host, and the replay the CLI reuses.
- `extension/src/replay.ts` `RESOLVE_POLL_MS`, `Resolved`: the poll interval
  and element lookup `wait_for` shares.

## Contract

Binding; every other name here is a suggestion.

```toml
[sites]
allowed = ["docs.google.com/*"]   # empty: no restriction

[capture]
save_screenshots = false
screenshot_folder = ""            # "" means capture.gif_folder

[audit]
enabled = false
file = ""                         # "" means the state dir's audit.jsonl
```

`wait_for` arguments: `tabId` (required), exactly one of `text`, `ref`,
`url_contains`, optional `gone` (wait for it to vanish), `timeout_s`
(1 to 60, default 15). It returns the matched text or ref, or fails with
`timeout` naming what it waited for.

Audit line, one per tool call: `{"t":<ms>,"tool":"computer","action":
"left_click","tab":123,"ok":true,"ms":412}`; a `navigate` line also has
`"host":"example.com"`; a failure has `"err":"<code>"`. Never a path, query,
typed text, value or page text. (The host sees a URL only in `navigate`'s
argument, so other tools carry the tab id and no host.)

CLI: `browser-hand replay <recording id> [--profile <dir>] [--from <n>]
[--value <step>=<text>]...` and `browser-hand recordings`. Exit 0 when every
step ran, 1 at the first failed step, which is printed.

## Edge cases

- `allowed` and `blocked` both match: blocked wins.
- A tab on `about:blank` or a new-tab page has no host: open, as today.
- `allowed` set while a tab sits on an unlisted site: the next tool call
  there says `blocked`; the network rule stops loads, not the open page.
- `save_screenshots` on with an unwritable folder: the screenshot still
  returns to Claude, with a `Could not save` note, as `save_to_disk` does.
- The audit file cannot be opened: the call proceeds, and one warning goes
  to the server's stderr; logging never fails a tool.
- `wait_for` on a tab that navigates: the poll continues on the new page.
- `replay` with no profile and several connected: refuses and lists them.
- A masked value in a replay with no `--value`: stops at that step, as the
  Claude replay does.

## Security

What is protected: the sites Claude may act on (D2), the person's browsing
history (D3), the disk (D4) and the person's logged-in sessions, which a
replay drives (D1).

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Elevation: Claude escapes the allow list through a link or iframe | a click opens an unlisted site | the network rule blocks `main_frame` and `sub_frame` for the group's tabs; the gate refuses tools | `site-rules` proof and a vitest of `sessionRules` |
| Elevation: a page makes Claude write a file elsewhere | a path in a tool argument | the folder comes only from settings; `folder_problem_in` refuses odd paths | host test: no tool argument reaches the folder |
| Information disclosure: the audit log holds secrets | typed text or a URL query logged | the line has host and action only; no query, path or value | host test on a login step and a URL with a token |
| Information disclosure: the log is readable by others | file mode | created `0600`, its folder `0700` (Windows: the user's profile ACL) | host test on the mode |
| Tampering: a bad page steers a replay | recorded steps carry page text | steps are data, as in `DATA_NOTE`; masked values need `--value`; the sites gate still applies | host test: a replay onto a blocked site stops |
| Denial of service: a huge log or wait | a tight loop | `timeout_s` capped at 60; the log appends one short line per call | host test on the cap |

Data: URL hosts and tool names, kept in the person's own files, never sent
anywhere. Secrets: none. Logged: host, tool, action, tab, result, time;
never typed text, values, queries or page content. Checklist followed:
OWASP ASVS V7 (logging) and V8 (data protection).

## Rollback

The keys are optional with the old behaviour as default, so removing them
from `config.toml` undoes the change. A newer `config.toml` read by an older
host: unknown keys are warned about and dropped, as `parse` does today.

## Open decisions

- The audit log's default: off until the person turns it on in the settings
  page. Default: off, because it records the person's browsing.
- Where the audit log lives: default `audit.jsonl` beside `config.toml`.
- Whether `replay` waits for a connected profile: default, it fails at once
  with the `list_profiles` text.

## Risks

- A replay run from a script acts as the person with nobody watching:
  the CLI prints each step as it runs and stops at the first failure.
- `wait_for` could hide a page that never loads: `timeout_s` is capped and
  the error names what it waited for.
- The settings page grows three sections: the new rows reuse the list and
  toggle components, and the design is checked against the Penpot file
  (`.penpot.json`, file "Settings") before any new board is drawn.

## Declined

- Puppeteer Replay on a debug port: the person's Chrome has none (D1).
- An extension-side replay runner: the worker is dropped after about 30 s
  idle, and it would be a second walker (D1).
- A `sites.mode` switch: it changes what an old list means (D2).
- Per-site prompts: left to Claude Code, plan 14 (D2).
- SQLite for the log: a new crate for queries nobody asked for (D3).
- A `path` argument on `computer`: lets a page-steered Claude choose where
  files land (D4).
- Waiting through a condition on `computer`'s `wait`: changes a schema the
  reference holds (D5).
- Firefox, shortcuts and scheduled tasks: not asked here.

## What the tests hold

- `wait_for` returns on the condition and fails with `timeout` otherwise,
  through a navigation (`extension/test/wait.test.ts`).
- Screenshots save only when the switch is on, into the chosen folder, and
  never from a tool argument (`host/tests/`).
- An audit line has no query, value or typed text, and the file is `0600`
  (`host/tests/audit.rs`).
- `sessionRules` gives one block-all, one allow per pattern and the blocked
  rules above them; `blocked` beats `allowed` (`extension/test/`).
- `replay` runs a recording against the fake host, stops at the first
  failure and refuses a masked step with no value (`host/tests/`).
- The tools, settings and commands pages match the host
  (`host/tests/docs.rs`).

## Repository knowledge

Read root `KNOWLEDGE.md` and `~/.knowledge/personal/browser-hand/` before each
phase. New verified findings go to the file `kn path` prints.

## Phases

### Phase 1: the rough cut, wait_for and saved screenshots (needs you: try it)

- [x] `wait_for` (expected in `host/src/mcp.rs`, `host/src/tools/args.rs`,
  `extension/src/wait.ts`, routed in `extension/src/background.ts`) waits
  for text, a ref or a URL substring from the extension, pinned by
  `extension/test/wait.test.ts` and a host test listing it in the tool names
  (`host/tests/mcp.rs`).
- [x] `capture.save_screenshots` and `capture.screenshot_folder` (fixed in
  `host/src/config.rs`) save each screenshot, off by default, pinned by a
  host test that a screenshot writes nothing until the switch is on.
- [x] Check: `make check` passes, and `browser-hand mcp` lists `wait_for`
  among its tools.
  Landed 2026-11-20: `make check` exit 0; host line coverage 90.03 % (floor
  90). `Frame::Settings` boxes its `Settings` (clippy `large_enum_variant`).
- [ ] You try it: set `save_screenshots = true` in `config.toml`, ask Claude
  to open a slow page and `wait_for` a word, then look in the folder for the
  screenshot, and say whether the wait and the save feel right.

### Phase 2: the audit log

- [x] `audit.enabled` and `audit.file` (fixed in `host/src/config.rs`) and
  the writer (expected in `host/src/audit.rs`), called from `Server::call` and
  `dispatch` so a `browser_batch` item gets its own line, pinned by
  `host/tests/audit.rs` (redaction, mode `0600`, a failed open does not fail
  the call).
- [x] 1000 appends timed and the figure written under Decision 3's
  evidence.
- [x] Check: `make check` passes, and a call with logging on adds one line
  that `jq .` reads.

### Phase 3: the allow list

- [x] `sites.allowed` (fixed in `host/src/config.rs`) read by `SiteRules` and
  `sessionRules` (expected in `extension/src/sites.ts`,
  `extension/src/site-rules.ts`), with `blocked` over `allowed`, pinned by
  vitest and a host test of the parser and its problems.
- [ ] Check: `make check` passes, and `sh scripts/prove/site-rules.sh` style
  proof shows a link to an unlisted site stopped and a listed one open.
  Landed 2026-11-20: `make check` passes (coverage lines 90.05 %); the live
  proof is `scripts/prove/allow-list.sh` in Phase 6, so this box stays open.
  `chrome://`, `about:` and other non-web pages are not judged (Edge cases).

### Phase 4: replay without Claude

- [x] `browser-hand recordings` and `browser-hand replay` (expected in
  `host/src/replay_cli.rs`, `host/src/main.rs`) that reuse
  `do_select_profile` and `do_recording_replay` and print each step, pinned
  by a host test against the fake extension and by `main.rs`'s usage text.
- [ ] Check: `make check` passes, and `browser-hand replay` runs a recorded
  flow headless on Chrome for Testing (`scripts/prove/cft.sh`).
- [ ] You try it: record two steps from the popup, run `browser-hand replay`
  on them with Claude closed, and say whether it moves like the Claude
  replay.

### Phase 5: the settings page

- [ ] The new rows (expected in `extension/src/settings.ts` and its page):
  an allowed list beside the blocked and read-only lists, a Capture toggle
  and folder, an Audit toggle and path. If a board is missing in the Penpot
  file "Settings", it is drawn there first and exported to `design/`.
- [ ] Check: `make check` passes, and headless screenshots in light and dark
  show the rows (`knowledge`: the settings page preview).

### Phase 6: docs, the plugin's words and the proofs

- [ ] `docs/book/src/guides/` gains the allow list and audit log guides, the
  screenshots guide gains the switch, and `docs/book/src/reference/`
  regenerates through `UPDATE_DOCS=1`.
- [ ] `plugin/skills/browser-hand/SKILL.md` and `host/src/instructions.md`
  tell Claude to use `wait_for` instead of long `wait`s.
  Landed 2026-11-20 for `wait_for` and `save_screenshots`: the skill's
  description now also matches "Claude in Chrome", a section maps the two
  tool sets, and `instructions.md` is trimmed to stay under 4,096 characters
  (4,077 now). The allow list, audit log and `replay` still need their words.
- [ ] One headless proof each (expected in `scripts/prove/`) for `wait_for`,
  the allow list, the audit log and `replay`, each printing `PASS`, listed
  in `docs/testing.md`.
- [ ] Check: `make check` passes, and every proof prints `PASS` on Chrome for
  Testing.

### Phase 7: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

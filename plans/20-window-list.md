# Claude can ask how many windows the profile has open, and which one is its own

## The ask

"window management is not there in the extension right, i mean i can't ask
how many windows are open or something like that." Checked 21/11/2026:
the only window tools are `resize_window` (the window holding one of
Claude's tabs) and `tabs_context` with `createIfEmpty`, which can make a
window but never list them. Claude in Chrome has the same gap
(`reference/claude-in-chrome/README.md`: "Tabs and windows" is
`tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`,
`resize_window`), so this is beyond parity, not a miss.

What it means: a read-only answer to "how many windows are open in this
profile, which is focused, which holds my tab group". Acting on windows
(focusing, closing, moving tabs between them) is a different power and is
not asked for here.

## Alternatives

### Decision 1: where the window list lives (two-way door)

Searched 21/11/2026: `chrome.windows.getAll` on developer.chrome.com
(returns every window the extension may see; `populate` adds each window's
`tabs`; a tab's `url`, `title` and `pendingUrl` are filled only when the
`tabs` permission is declared, which `extension/manifest.json` already
does). The `Window` field list (focused, state, size, incognito) was not
shown by the search; the extension already reads `focused`-style fields
through `windows.getLastFocused` and `windows.update`, and the build
confirms the rest against the reference page.

| Must | A: new `windows_list` tool | B: add `windows` to `tabs_context` | C: full window tools (list, focus, close, move) |
| --- | --- | --- | --- |
| Shows no title or URL of tabs outside the session's group | yes | yes | yes |
| Never closes, moves or focuses a window the person owns | yes | yes | no (close and move act on their windows) |
| **Survives** | **yes** | **yes** | no |

| Criterion | Weight | A | B |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 3 |
| Reliability | 30 | 5 | 4 |
| Compatibility | 30 | 4 | 3 |
| **Weighted total** | **100** | **4.70** | **3.30** |

- A efficiency 5: the window query runs only when asked. B efficiency 3:
  `tabs_context` is called before almost every tab action (the server's
  own instructions say so), so B adds a window query and more reply text
  to each of them. Reasoned from `host/src/mcp.rs` instructions and
  `extension/src/tabs.ts`, not measured.
- A reliability 5: nothing existing changes. B reliability 4: the
  `tabs_context` reply shape is read by `extension/test/tabs.test.ts` and
  the host's docs test.
- A compatibility 4: one more tool (23 to 24), so the docs reference, the
  skill and the server instructions each gain a line. B compatibility 3: a
  clients' existing parse of `tabs_context` changes.

Sensitivity: B wins only if tool count itself were the cost; the
`tabs_context` calls per task would have to be rare, and they are not.
Risk: a window count says the person has windows open they did not mention;
it carries counts and sizes, never page text.

**Chosen: A.** A separate read-only tool costs nothing when unused and
leaves `tabs_context` alone. Revisit if Chrome's `windows` API adds a field
that makes B free.

## The decision

One new tool, `windows_list` (Decision 1), read-only, built in the extension
from `chrome.windows.getAll({ windowTypes: ["normal"] })` plus a tab count
per window. It returns for each window: `windowId`, `focused`, `state`
(`normal`, `minimized`, `maximized`, `fullscreen`), `width`, `height`,
`incognito`, `tabCount`, and `holdsSessionGroup` (true for the window that
holds this session's tab group). It returns no tab titles or URLs. Only
windows of the selected profile are listed. New dependency or permission:
none (`tabs` is already declared). Site rules do not apply: no page is read.

Standards: `docs/standards.md` (format, lint, types, tests, coverage floor,
advisories and secrets, through `make check`).

Security: read-only, no new input beyond an empty argument object, no new
permission; the one thing handed to Claude is how many windows exist, never
what is in them. Covered in Edge cases.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `extension/src/tabs.ts` | edit | 1 | `listWindows` beside `createGroup`, using `chrome.windows.getAll` | expected |
| `extension/src/background.ts` | edit | 1 | `windows_list` handler next to `resize_window` | expected |
| `extension/src/sites.ts` | edit | 1 | `windows_list` counted as reading, like `resize_window` | expected |
| `host/src/mcp.rs` | edit | 1 | the tool, its `call` and the server instructions line | expected |
| `host/src/tools/args.rs` | edit | 1 | empty args type if the macro needs one | expected |
| `extension/test/tabs.test.ts`, `host/tests/mcp.rs` | edit | 1 | tests, and the tool-name list | expected |
| `docs/book/src/reference/tools.md` | edit | 1 | regenerated with `UPDATE_DOCS=1` | fixed |
| `plugin/skills/browser-hand/SKILL.md` | edit | 2 | when to ask for windows | expected |

*Reused, not rewritten:* `TabTools` in `extension/src/tabs.ts` already holds
the `windows` API handle and the session's group id (`group()`), so
`holdsSessionGroup` reads the group's `windowId` from there; the
`resize_window` handler is the model for a tool that touches windows, not
pages. Searched `git grep -i "windows.getAll\|list_windows\|windows_list"`:
nothing.

## Contract

Owner: the host (`host/src/mcp.rs`); the extension answers the call.

Arguments: none. Reply, as text content holding JSON:

```json
{"windows":[{"windowId":123,"focused":true,"state":"normal","width":1280,
"height":800,"incognito":false,"tabCount":7,"holdsSessionGroup":true}]}
```

`tools.md` is regenerated and held by `host/tests/docs.rs`; the tool list
by `host/tests/mcp.rs`.

## Edge cases

- No window open: `{"windows":[]}`, not an error.
- A minimised window: listed with `state: "minimized"`; its size is whatever
  Chrome reports.
- Incognito windows: listed only if Chrome lets the extension see them
  (`incognito: true`); never opened or read by this tool.
- App and popup windows (the extension's own popup): not listed, the filter
  is `normal` windows.
- The session has no group yet: every `holdsSessionGroup` is false.
- Another profile's windows: never listed, the call goes to the selected
  profile only.

## Security

Who can reach it: any session of the selected profile, like `tabs_context`.
It reveals the number, size and state of the person's windows and whether
incognito windows exist. It reveals no page content.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Tab titles or URLs outside the session leak through the list | `getAll` with `populate` would carry them | the handler reads `tabs.query({ windowId })` for a count only and never copies a title or URL | a test whose fake windows hold tabs with titles and URLs, asserting the reply has neither |
| Reads a window of another profile | wrong profile selected | the call goes through the selected profile's extension, as every tool does | the existing profile-routing tests; the new tool is added to their list |
| Used to act on a window | list gives ids that `resize_window` accepts | `resize_window` still takes a tab id from the session's group, so a listed id cannot be acted on | `extension/test/background.test.ts` case: `resize_window` with a window id is refused |

## Phases

### Phase 1: the rough cut (needs you: try it)

- [ ] `windows_list` answers end to end: the extension counts windows and
  their tabs (expected in `extension/src/tabs.ts` and
  `extension/src/background.ts`), the host exposes the tool with no
  arguments (expected in `host/src/mcp.rs`), and the reply has the shape in
  `## Contract`, pinned by the tests in `## Where it lands`.
- [ ] The reply carries no title or URL, pinned by a test over fake tabs
  that have both.
- [ ] `docs/book/src/reference/tools.md` regenerated with `UPDATE_DOCS=1`
  and the server instructions in `host/src/mcp.rs` gain one line on when to
  use it.
- [ ] The project's check passes: `make check`, then
  `cargo test --manifest-path host/Cargo.toml --test docs` and
  `npm --prefix extension test` both green.
- [ ] You try it: run `sh scripts/build.sh`, open two Chrome windows in one
  profile (one minimised), ask Claude "how many windows do I have open and
  which one is yours", and say whether the answer matches what you see.
  What you say goes into the phases not yet started.

### Phase 2: edge cases and the skill

- [ ] Each case in `## Edge cases` has a test (no window, minimised,
  incognito not shown, no session group, another profile).
- [ ] `plugin/skills/browser-hand/SKILL.md` says when to ask for windows
  (before `resize_window`, when the person says "my other window").
- [ ] Plan 19 (`plan/19-optional-access`, PR #63) read, and the tool filed
  under whichever access switch it names, if any; a `Landed` note records
  which.
- [ ] The project's check passes: `make check`.

### Phase 3: open the PR

- [ ] The branch pushed and its PR opened against `main` (or, if one is
  already open for this branch, its body brought up to date) with a
  Conventional Commit title for the whole change, a body naming this plan,
  what changed and why, and the checks run with their result. The PR's URL
  printed as the evidence. Opened, never merged.

## Declined

- Full window management (focus, close, move a tab between windows,
  create on demand): it acts on windows the person owns, which the
  session model (one tab group, nothing else touched) rules out. It would
  be its own plan with its own switch.
- Listing every tab of every window: leaks titles and URLs the session was
  never given.

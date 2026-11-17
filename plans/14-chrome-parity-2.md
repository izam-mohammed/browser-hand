# browser-hand runs on Linux and other Chromium browsers, keeps big reads in the conversation and refuses credential files on upload

## The ask

"Find every gap between browser-hand and the current real Claude in Chrome,
and write the plan to close it."

The reference was refreshed on 17/11/2026 (`reference/claude-in-chrome/README.md`
§ *Changes since 14/11/2026*): Claude Code 2.1.326, its live tool list, the
installed extension (still 1.0.107, manifest unchanged), the Claude Code
Chrome docs and the support articles. Tool parity still holds: the same 20
tools, all in `host/src/mcp.rs` (23 tools with the recording trio and the
profile pair standing in for the browser trio). Plan 13 closed the four
behaviours found on 14/11/2026. What is new, and not in any plan:

- The tool list now carries `_meta` `anthropic/maxResultSizeChars: 60000` on
  `read_page`, `get_page_text`, `javascript_tool` and `browser_batch`, and a
  `title` on the three tabs tools. `host/src/mcp.rs` sends neither.
- File uploads refuse files with more than one hard link and files named or
  foldered like credentials (`.env`, `.pem`, `.key`, under `.ssh`)
  (code.claude.com/docs/en/chrome). `host/src/tools/files.rs` checks size only.
- Claude in Chrome runs on Linux and Windows, and on Chrome, Edge, Brave,
  Arc, Vivaldi and Opera. browser-hand reads a macOS path in
  `host/src/profiles.rs` `chrome_dir`, launches with `open -na "Google
  Chrome"` in `host/src/mcp.rs` `open_in_chrome`, and the README says "macOS
  with Google Chrome".

Gap table (17/11/2026):

| Feature | Evidence | Have it? | Size | In scope |
| --- | --- | --- | --- | --- |
| Linux: profiles, launch, native host manifest | docs list the Linux host path; `profiles.rs`, `mcp.rs` are macOS only | no | medium | yes |
| Other Chromium browsers (Edge, Brave, Chromium, Vivaldi) | docs: Claude Code sets up the host for them | no | medium | yes |
| Result-size hint on four tools | tool list `_meta` | no | small | yes |
| `title` on the tabs tools | tool list `title` | no | small | yes |
| Upload refuses credential names and hard links | docs, Claude Code 2.1.293 | no | small | yes |
| Windows (named pipes, registry host manifest) | docs: Windows host key | no | large | no, own plan later |
| `action_summary` gone from live schemas | tool list diff | kept, optional | none | no: harmless, step-recording labels and the skill use it |
| 150 s answer window for a long `browser_batch` | changelog 2.1.326 | yes, `COMPUTER_WAIT` is 300 s | none | have |
| 6 s reconnect, JSON-text refusal, redacted URLs, visible cursor | plan 13 | yes | none | have |
| Shortcuts, scheduled tasks, workflow-to-shortcut | support article; tools dropped upstream | no | large | no: Claude Code has `/schedule`; `plans/02` declined shortcuts |
| Cowork sessions, connectors, 1Password, side panel | support article | no | large | no: Anthropic-account features |
| Classifier auto-approval, per-site allow prompts, plan-mode prompts | docs | no | large | no: Claude Code's permission system owns them; browser-hand has `blocked` and `read_only` |
| Org sign-in lock, admin allow and block lists, ZDR or HIPAA off | docs, `managed_schema.json` | no | large | no: no account |
| `favicon` permission, Google Meet script | manifest 1.0.107 | no | small | no: declined in plan 13 |
| `/clear` closes the tab group | docs | partly: `close_tabs_on_end` | none | no: Claude Code owns session events; setting exists |
| Install prompt, `CLAUDE_CODE_ENABLE_CFC` guard | docs | no | none | no: Claude Code side; `plans/07` covers browser-hand's own install |

Built so far: `docs/built/BUILT-2026-11-14-2216.md` (plans 13's phases have
landed since; the newest snapshot predates them).

## Alternatives

### Decision 1: how a Linux profile is opened (two-way door)

macOS uses `open -na "Google Chrome" --args --profile-directory=<dir> <url>`;
`xdg-open` takes no such arguments (`docs/external/chrome-profiles-and-launch.md`;
`xdg-open: unexpected option '-na'` seen on 17/11/2026).

Searched 17/11/2026: "chrome --profile-directory linux command line
existing instance", "xdg-open pass arguments browser profile", Chromium's
command-line docs: a second launch of the binary hands the URL and
`--profile-directory` to the running instance.

| Must | Baseline: `open` | Run the browser binary | `xdg-open` |
| --- | --- | --- | --- |
| Targets one profile | n/a on Linux | yes | no |
| Starts the browser when closed | n/a | yes | yes |
| **Survives** | no | **yes** | no |

| Criterion | Weight | Run the browser binary | CDP `Target.createTarget` |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 2 |
| Reliability | 40 | 4 | 2 |
| Matches the macOS behaviour | 20 | 5 | 2 |
| **Weighted total** | **100** | **4.60** | **2.00** |

- Binary efficiency 5: one process spawn, same as `open`.
- CDP 2: needs a debug port the person's own Chrome does not expose
  (`knowledge/chrome-for-testing.md`).

Sensitivity: none plausible. Risk: a snap or flatpak Chrome sandboxes the
binary; the error names the path tried.

**Chosen: run the first of `google-chrome-stable`, `google-chrome`,
`chromium` found on `PATH`**, `BROWSER_HAND_BROWSER_BIN` overriding. Revisit
if a walk finds a packaged browser that ignores the profile flag.

### Decision 2: how other Chromium browsers are reached (two-way door)

Searched 17/11/2026: Claude Code's Chrome docs (host manifests per browser
directory), the Chromium `Local State` format shared by Chromium browsers.

| Must | Baseline: Chrome only | One browser per run, by env | Every installed browser's profiles |
| --- | --- | --- | --- |
| Existing macOS Chrome users unchanged | yes | yes | yes |
| Person can reach a Brave profile | no | yes | yes |
| **Survives** | no | **yes** | **yes** |

| Criterion | Weight | By env | Every installed browser |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 4 |
| Fewest steps for the person | 40 | 2 | 5 |
| Predictable profile ids | 20 | 5 | 3 |
| **Weighted total** | **100** | **3.80** | **4.20** |

- Every browser 4: one `Local State` read per known browser dir, only those
  that exist; the list is read per `list_profiles` call, not per tool call.
- Predictable ids 3: a profile is named `<browser>:<dir>` only when more
  than one browser is found, so a Chrome-only user sees no change.

Sensitivity: flips to env if two browsers share a profile dir name often.
Risk: a profile listed whose browser has no extension: it shows as not
installed, as today.

**Chosen: every installed browser, prefixed when more than one.** The known
dirs are a fixed table (Chrome, Chromium, Edge, Brave, Vivaldi). Revisit if
the table needs more than a line per browser.

### Decision 3: how the result-size hint is sent (two-way door)

Searched 17/11/2026: `docs/external/rmcp.md` (`#[tool(meta = ...)]`,
`Tool.meta`); the live tool list's `_meta` shape.

| Must | Baseline: none | `meta` on `#[tool]` | Patch `list_tools` output |
| --- | --- | --- | --- |
| `_meta` reaches the client unchanged | no | yes | yes |
| **Survives** | no | **yes** | yes |

| Criterion | Weight | `meta` on `#[tool]` | Patch `list_tools` |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 5 |
| Stays with the tool it describes | 40 | 5 | 2 |
| Survives an rmcp upgrade | 20 | 4 | 3 |
| **Weighted total** | **100** | **4.80** | **3.40** |

- Efficiency 5 for both: built once at start-up.

Sensitivity: none. Risk: a client that ignores `_meta` is unaffected.

**Chosen: `meta` on each `#[tool]`.** Revisit if rmcp drops the field.

## The decision

Linux and other Chromium browsers become first-class: paths per OS and a
fixed table of browsers (decision 2), the binary run directly to open a
profile (decision 1). The four large reads carry the result-size hint and
the tabs tools a title (decision 3). `file_upload` refuses credential names
and multi-link files. Windows, shortcuts, scheduled tasks and every
account feature stay out (the gap table). No new dependency, permission,
network host or secret; `libc` and `std::fs::metadata` already cover link
counts.

Standards: `docs/standards.md` (types, vitest, cargo test, coverage floor,
docs reference, the build), through `make check`.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `host/src/profiles.rs` | edit | 1, 4 | `chrome_dir` per OS; the browser table and merged list | reuse |
| `host/src/mcp.rs` | edit | 1, 2 | launcher on Linux; `meta` and titles on the tools | reuse |
| `host/src/install.rs` | edit | 1, 4 | manifest dir per browser | reuse |
| `host/src/tools/files.rs` | edit | 3 | credential-name and hard-link refusal | reuse |
| `scripts/prove/linux-open.sh` | new | 1 | proof: the host opens a profile headless | expected |
| `README.md`, `docs/testing.md` | edit | 1, 4 | platforms and browsers | reuse |

*Reused, not rewritten:*

- `scripts/prove/cft.sh`: already launches Chrome for Testing headless; the
  new proof sits on it.
- `host/src/tools/files.rs` `MAX_UPLOAD_BYTES` check: the refusals go beside
  it, in the same error shape.
- Searched for an existing browser table, `cfg(target_os = "linux")` code and
  `_meta` use: none exists.

## Edge cases

- Two browsers hold a profile named `Default`: listed as `chrome:Default`
  and `brave:Default`; a bare `Default` is refused with both names.
- Chrome not installed, only Brave: the list holds Brave's profiles.
- No browser binary on `PATH`: `select_profile` says which names it tried
  and that `BROWSER_HAND_BROWSER_BIN` overrides.
- A file named `config.env.example`: allowed; only exact credential names
  and extensions (`.env`, `.pem`, `.key`) and a `.ssh` folder are refused.
- A symlink to a credential file: refused by the resolved name.
- Result-size hint on a client that ignores it: no change.

## Security

Entry point: `file_upload` paths (model in, local files out to a web page).

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | a prompt-injected page asks Claude to upload `~/.ssh/id_ed25519` | refusal by name, folder and resolved symlink | `files.rs` tests on `.env`, `.pem`, `.key`, `.ssh/` and a symlink |
| Information disclosure | a hard link to a protected file under a harmless name | link count above 1 refused | `files.rs` hard-link test |
| Elevation | a browser table entry pointing outside the user's home | dirs built from `$HOME` only, never from tool input | `profiles.rs` test with a hostile name |

Data: nothing stored or logged; refused paths appear in the error, which
the person already sees. Checklist: OWASP ASVS 12.3 (file handling).

## Declined

- `xdg-open` and CDP to open a profile (decision 1): fail the profile must
  and the reliability criterion.
- One browser by env only (decision 2): more steps for the person.
- Patching `list_tools` (decision 3): separates the hint from its tool.
- Windows now: named pipes and registry manifests are their own transport
  work; a later plan.
- Everything marked "no" in the gap table, for the reasons there.

## What the tests hold

`chrome_dir` and the browser table per OS under a fake `HOME`; the merged
profile list with two browsers and with one; the binary search order and
the override; `tools/list` carrying `_meta` on four tools and `title` on
three; upload refusals for each credential name, a symlink and a hard link,
with a lookalike name allowed.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: the rough cut, Linux end to end (needs you: try it)

- [ ] Tests first: profile dir, launcher command and manifest path per OS
  under a fake `HOME`, in `host/src/profiles.rs`, `host/src/mcp.rs` and
  `host/src/install.rs` test modules, failing on Linux.
- [ ] `chrome_dir`, the launcher and `install` work on Linux with Chrome
  (expected in the same files), per decision 1.
- [ ] A proof `scripts/prove/linux-open.sh` that opens a throwaway profile
  through the real launcher on Chrome for Testing and prints PASS.
- [ ] README and `docs/testing.md` name Linux as supported.
- [ ] Check: `make check`, then `sh scripts/prove/linux-open.sh` prints PASS.
- [ ] You try it: on a Linux box with Chrome, run `sh scripts/build.sh`, ask
  Claude to `select_profile` and open a page. Say what felt off; it goes
  into the phases below.

### Phase 2: big reads stay in the conversation

- [x] Tests first: `tools/list` carries `_meta` `anthropic/maxResultSizeChars`
  60000 on `read_page`, `get_page_text`, `javascript_tool`, `browser_batch`
  and a `title` on the three tabs tools (`host/tests/`).
- [x] The `meta` and `title` set on those tools (expected in
  `host/src/mcp.rs`), per decision 3.
- [x] `UPDATE_DOCS=1 cargo test --manifest-path host/Cargo.toml --test docs`
  run: the reference pages did not change (meta and title are not rendered there).
- [x] Check: `make check` passes.

### Phase 3: uploads refuse credential files

- [ ] Tests first: refusals for `.env`, `.pem`, `.key`, a path under
  `.ssh`, a symlink to one, a hard-linked file; `config.env.example`
  allowed (in `host/src/tools/files.rs`).
- [ ] The refusals land beside the size check, each error naming the rule
  and telling Claude to ask the person for another file.
- [ ] `host/src/instructions.md` and `plugin/skills/browser-hand/SKILL.md`
  say so in a line, pinned by `host/tests/instructions.rs`.
- [ ] Check: `make check` passes.

### Phase 4: other Chromium browsers

- [ ] Tests first: the browser table (Chrome, Chromium, Edge, Brave,
  Vivaldi) per OS, the merged profile list, the `<browser>:<dir>` naming
  only when more than one browser is found, a bare ambiguous dir refused.
- [ ] `list_profiles`, `select_profile` and `install` use the table
  (expected in `host/src/profiles.rs`, `host/src/mcp.rs`,
  `host/src/install.rs`), per decision 2; one launcher binary per browser.
- [ ] README, `docs/book` getting started and `docs/testing.md` list the
  browsers; the docs reference regenerated.
- [ ] Check: `make check` passes.

### Phase 5: the walk (needs you at a Linux desktop)

- [ ] On Linux with Chrome and one other Chromium browser: list profiles,
  open one in each, read a large page, and try to upload a `.env` file.
  Written under `## Verified` with the date.
- [ ] Check: `make check` passes.

### Phase 6: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to
  date) with a Conventional Commit title for the whole change, a body
  naming this plan, what changed and why, and the checks run with their
  result. The PR's URL printed as the evidence. Opened, never merged.

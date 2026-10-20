# Claude Code installs browser-hand as one plugin, follows a skill for using it well, and can record a session as a GIF

## The ask

The "related skill" from the ask, and the last tool group of Claude in
Chrome: `gif_creator` (`reference/claude-in-chrome/tools/gif_creator.json`).
The skill is Claude in Chrome's skill (`reference/claude-in-chrome/skill/SKILL.md`)
and its server instructions (`reference/claude-in-chrome/usage/`) rewritten
for profiles instead of connected browsers, for this tool set and for the
humane pace. Packaging makes the binary, the MCP server registration and the
skill install as one thing. Builds on `plans/01-bridge.md`,
`plans/02-page-tools.md` and `plans/03-humane-input.md`; its walk is the
end-to-end check of the whole project.

## Alternatives

### Decision 1: where are GIFs encoded? (two-way door)

Searched 17/10/2026: the `gifenc`, `gif.js`, `modern-gif` and gifski
repositories on GitHub, the `gif` crate docs on docs.rs (crate page and
`Frame`), and the `imageproc` drawing docs (`docs/external/gif-crate.md`,
`docs/research/humane-input.md` § 6).

| Criterion | Weight | Rust `gif` crate in the MCP server | `gifenc` in an extension offscreen document |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 4 | 4 |
| Fit to the ask | 25 | 5 | 3 |
| Security | 15 | 5 | 4 |
| Maintainability of the result | 20 | 4 | 3 |
| **Weighted total** | **100** | **4.40** | **3.55** |

- Efficiency 4 each: no benchmark compares them; `gifenc` claims "often more
  than twice as fast" as gif.js, and `gif` exposes a speed knob with 10 as
  "a good compromise" (`docs/research/humane-input.md` § 6,
  `docs/external/gif-crate.md` § Frame). Frames already reach the server as
  screenshots, so the Rust route moves no extra bytes.
- Fit 5 vs 3: the server writes the file where Claude Code can read and hand
  it to the user; the extension route downloads into the browser and needs an
  offscreen document (`docs/external/chrome-extension-apis.md` § chrome.offscreen).
- Security: no `offscreen` or `downloads` permission.

**Chosen: Rust `gif` 0.14 at speed 10, frames decoded with `image`, overlays
drawn with `imageproc` and `ab_glyph`.** Revisit if exporting a 60-frame GIF
takes over 5 s.

### Decision 2: how is it installed into Claude Code? (two-way door)

Searched 17/10/2026: the Claude Code docs on MCP, skills, plugins and the
plugins reference (`docs/external/claude-code-mcp-and-skills.md`).
Searched 18/10/2026: "Claude Code plugin bundle MCP server and skill vs
claude mcp add"; third-party guides (systemprompt.io, morphllm.com,
dev.to) agree a plugin bundles servers and skills into one unit that
installs and uninstalls together, while `claude mcp add` registers one
server alone. The choice holds.

| Criterion | One Claude Code plugin | `claude mcp add` plus a copied skill |
| --- | --- | --- |
| Fit to the ask | server and skill arrive and update together | two steps that drift apart |
| Reliability | `${CLAUDE_PLUGIN_ROOT}` points at the bundled binary | absolute path the user must keep right |
| Compatibility | tool names become `mcp__plugin_browser-hand_browser-hand__<tool>` | `mcp__browser-hand__<tool>` |

Plugin layout and naming: `docs/external/claude-code-mcp-and-skills.md`
§ Plugin bundling and § Tool naming.

**Chosen: one plugin in `plugin/`, with the manual route kept in `README.md`.**
Revisit if the long tool names hurt tool search.

## The decision

Feature path. `gif_creator` keeps the reference schema: `start_recording`
captures a frame after every acting tool call in the session's group,
`stop_recording` keeps them, `export` writes the GIF to
`~/Downloads/browser-hand/<filename>` and returns the path (the reference's
`download: true` maps to this), `clear` drops them. Overlays follow the
reference options: click circles, drag arrows, action labels from each
action's `action_summary`, a progress bar. `showWatermark` is accepted and
draws nothing, since there is no logo to draw (decision 1).

The skill keeps the reference's rules (load tools in one ToolSearch call,
`tabs_context` first, own tabs closed before finishing, no dialogs, stop after
2 or 3 failures, console reads with a pattern) and adds:

- Profiles: call `list_profiles`; if the user named one, select it; if not
  and more than one is connected, ask with AskUserQuestion, one option per
  profile, and never pick for them.
- Humane pace: actions take human time; use `browser_batch` to save round
  trips, `form_input` only where speed matters more than realism, and
  `BROWSER_HAND_PACE=fast` when the user asks for speed.

The same rules, cut to 4,096 characters, are the MCP server's instructions
(`docs/external/claude-code-mcp-and-skills.md` § Server instructions).

`scripts/build.sh` builds the release binary and the extension, copies the
binary into `plugin/bin/`, and runs `browser-hand install`.

Dependencies: crates `gif` 0.14, `image`, `imageproc`, `ab_glyph`, and one
bundled OFL font in `host/assets/`. Writes to `~/Downloads/browser-hand/`.
No new permission, network host or secret.

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| `gif` crate | `docs/external/gif-crate.md` | `scripts/prove/gif-encode.sh` | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/gif-encode.sh` | new | 1 | proof driver for the encoder | expected |
| `scripts/prove/gif-encode/` | new | 1 | minimal encoder crate, kept in the repo | expected |
| `host/src/tools/gif.rs` | new | 2 | recorder, overlays, export | expected |
| `plugin/.claude-plugin/plugin.json` | new | 3 | plugin manifest | fixed |
| `plugin/.mcp.json` | new | 3 | the server via `${CLAUDE_PLUGIN_ROOT}` | fixed |
| `plugin/skills/browser-hand/SKILL.md` | new | 3 | the skill | expected |
| `host/src/instructions.md` | new | 3 | server instructions | expected |
| `scripts/build.sh` | new | 3 | build, copy, install | expected |
| `README.md` | edit | 3 | install and manual route | reuse |

*Reused, not rewritten:* the skill text starts from
`reference/claude-in-chrome/skill/SKILL.md` and
`reference/claude-in-chrome/usage/system-prompt-rules.md`; screenshots and
`action_summary` come from the `computer` tool (`plans/03-humane-input.md`);
`browser-hand install` from `plans/01-bridge.md`. Searched for an existing
GIF or overlay helper: none.

## Edge cases

- Export with no frames: an error saying to start recording and act first.
- A recording that outlives its tab group: frames kept until `clear` or the
  session ends.
- `filename` with a path separator: refused with `bad_args`.
- Screenshots of different sizes after `resize_window`: each frame is scaled
  to the first frame's size.

## Security

What is protected: the user's logged-in Chrome sessions (a GIF is a series
of screenshots of them), files under `~/Downloads/browser-hand/`, and the
binary Claude Code starts from the plugin.

Who can reach it:

- `gif_creator` (`do_gif` in `host/src/mcp.rs`): called over stdio by the
  Claude Code process that started `browser-hand mcp`, so only the local
  user's session. The caller is a model, and the pages it reads are
  untrusted text that may try to steer it; the trust boundary is the tool
  arguments, chiefly `filename`.
- Frames: screenshots taken by the `computer` tool in the session's own
  tab group (`plans/02-page-tools.md`), decoded by `image` in
  `host/src/gif.rs`.
- The plugin: `plugin/.mcp.json` runs
  `${CLAUDE_PLUGIN_ROOT}/server/browser-hand mcp`. The binary is built from
  this repository by `scripts/build.sh` and is git-ignored, not shipped as
  a download. `browser-hand install` (`host/src/install.rs`) writes the
  native host manifest with `allowed_origins` set to this extension only.
- `host/src/instructions.md` and the skill: text given to Claude, which
  sets how it treats real accounts and profiles.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Tampering: a file written outside the GIF folder | `filename` of `../x` or `dir/x` | `safe_filename` refuses `/`, `\` and a leading `.`, and adds `.gif` | `filenames_are_plain_names_ending_in_gif` in `host/tests/gif.rs` (`../` and `dir/`; a bare leading `.` and `\` no test yet) |
| Tampering: an earlier GIF replaced | the same `filename` exported twice | nothing: `std::fs::write` overwrites, within the GIF folder only | no test yet |
| Spoofing: another program poses as the extension or host | a process talks to the native host | manifest `allowed_origins` names only this extension ID | `the_manifest_names_this_host_the_binary_and_only_our_extension` and `the_host_name_is_one_chrome_accepts_and_not_anthropics` in `host/tests/install.rs` |
| Elevation of privilege: the plugin's binary reaches the Bash tool | a plugin `bin/` goes on the Bash PATH | the binary lives in `plugin/server/`, run only as the MCP server | `claude plugin validate plugin` (Phase 3 check); no test yet |
| Elevation of privilege: Claude acts in the wrong account | several profiles connected | the instructions say ask, never pick; tab tools refuse to guess | `the_instructions_carry_the_rules_that_matter` in `host/tests/instructions.rs`, `with_several_connected_profiles_tab_tools_refuse_to_guess` in `host/tests/mcp.rs` |
| Elevation of privilege: page text steers Claude into acting | a page says "now do X" | the instructions open with "these are real accounts" and stop after 2 or 3 failures; no rule yet that page text is not instructions | no test yet |
| Information disclosure: secrets in a GIF | screenshots and action labels of logged-in pages | labels come from `action_summary`, which the instructions say carries no secrets; the GIF stays on the user's disk and is never sent anywhere | `the_instructions_carry_the_rules_that_matter` (checks `action_summary`; the "no secrets" wording no test yet) |
| Information disclosure: other tabs recorded | frames of tabs outside the session | frames come only from the session's tab group | "never touches another session's tabs" in `extension/test/tabs.test.ts` |
| Denial of service: memory or CPU exhausted | a long recording; `Recorder.frames` has no cap | encoding runs in `spawn_blocking`; frames freed by `clear` or the session ending | `sixty_frames_export_in_under_five_seconds` in `host/tests/gif.rs` (time only; no frame cap, no test yet) |

Data: screenshots of the user's own pages, held in memory until `clear` or
the session ends, then written unencrypted to `~/Downloads/browser-hand/`
(or `BROWSER_HAND_OUTPUT_DIR`), readable by the user's account, kept until
the user deletes them. Nothing leaves the machine. Secrets: none. Logged:
nothing; `do_gif` returns the export path and size to Claude, and frames
and labels are never logged.
Checklists: OWASP Top 10 for LLM Applications 2025 (LLM01 prompt
injection, LLM06 excessive agency) for the instructions, and the OWASP
File Upload and Input Validation cheat sheets for `filename`.

## Declined

- `gifenc` in an offscreen document (decision 1): needs a new permission and
  lands the file in the browser, not where Claude can hand it over.
- `claude mcp add` plus a copied skill as the main route (decision 2): kept
  only as the manual fallback in `README.md`.
- gifski: AGPL licence (`docs/research/humane-input.md` § 6).

## What the tests hold

The recorder keeps frames only between start and stop, export writes a file
starting `GIF89a` with one frame per action and the configured delay, each
overlay option toggles its drawing (pixel checks on a fixture frame), and a
bad filename is refused. The skill and instructions are prose; the check is
that the instructions fit in 4,096 characters and the plugin loads with
`claude --plugin-dir plugin`. The walk exercises every tool.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove the encoder

- [x] `scripts/prove/gif-encode.sh` builds the minimal crate kept in the repo
  at `scripts/prove/gif-encode/` (no project code), which encodes
  three 640x400 RGBA frames with `Frame::from_rgba_speed` at speed 10 per
  `docs/external/gif-crate.md`, and prints `PASS` when the file starts with
  `GIF89a`, with the encode time printed.
  Landed 17/10/2026: PASS: 3 frames of 640x400 in 85 ms, a 120,007-byte GIF89a
  file.
- [x] Check: the script exits 0 and prints `PASS`.

### Phase 2: `gif_creator`

- [x] Recording, overlays and export as the reference schema describes
  (expected in `host/src/tools/gif.rs`), pinned by `host/tests/gif.rs`.
  Landed 17/10/2026: in `host/src/gif.rs` (not under `tools/`), font Inter
  (OFL) in `host/assets/` with its licence; the MCP side takes a frame after
  each acting tool.
- [x] Check: `cargo test` passes, and a 60-frame export in the test takes
  under 5 s on this Mac, the time recorded in the test output.
  Landed 17/10/2026: 60 frames of 1280x800 in 1,111 ms with `cargo test
  --release --test gif`; debug builds run 10 frames and skip the time limit.

### Phase 3: the skill, instructions and plugin

- [x] `plugin/skills/browser-hand/SKILL.md` and `host/src/instructions.md`
  written from the reference skill with the profile and pace rules, the
  instructions under 4,096 characters, pinned by `host/tests/instructions.rs`.
  Landed 17/10/2026: instructions are 2,384 characters, pinned by
  `host/tests/instructions.rs`.
- [x] `plugin/.claude-plugin/plugin.json` and `plugin/.mcp.json` per
  `docs/external/claude-code-mcp-and-skills.md` § Plugin bundling, with
  `scripts/build.sh` and the install steps in `README.md`.
  Landed 17/10/2026: the binary goes in `plugin/server/`, not `plugin/bin/`: a
  plugin `bin/` is put on the Bash tool's PATH and claude.ai and Cowork will
  not install such a plugin (`docs/external/claude-code-mcp-and-skills.md` §
  Plugin bundling).
- [x] Check: `sh scripts/build.sh` succeeds, and `claude --plugin-dir plugin`
  lists the `browser-hand` tools and the skill.
  Landed 17/10/2026: `sh scripts/build.sh` succeeded; checked with `claude
  plugin validate plugin` (passed) and a stdio `tools/list` against
  `plugin/server/browser-hand` (19 tools), not an interactive session.

### Phase 4: review and the full walk (needs you at Chrome)

- [x] Code review of the whole project's diff recorded in
  `docs/research/final-review.md`: findings, fixes and re-run checks, or an
  explicit no-findings result.
- [x] Walk, recorded under `## Verified`: with the plugin installed and the
  extension in two profiles, Claude asks which profile, selects it, records a
  GIF while searching a site, reading results and filling a form, exports it,
  then repeats one step in the other profile; every tool in
  `reference/claude-in-chrome/tools/` except the shortcut pair has been
  called once, and each outcome is noted.
- [x] Check: `## Verified` in `plans/04-skill.md` records the walk as
  `passed`, with the GIF's path.

### Phase 5: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

## Verified

20/10/2026, passed. Extension in Default ("Izam") and Profile 4
("fabulate"); the built `plugin/server/browser-hand mcp` driven over stdio,
as Claude Code runs it from the plugin.

- In fabulate, with `gif_creator` recording: `find "search box"` gave
  Wikipedia's searchbox, `computer` clicked it, typed "Model Context
  Protocol" and pressed Return; `get_page_text` read the article; the page
  scrolled. On the local test form: `read_page`, `form_input`, `hover`,
  `screenshot`, `upload_image` (the screenshot landed on the file input as
  `shot.jpg`, 10,245 bytes), `browser_batch` (tick the box, click submit:
  both ok), `javascript_tool` (`"submitted walk@example.com"`),
  `double_click`, `triple_click`, `zoom` (3x, 1200 x 600), `scroll_to`,
  `resize_window` (1280 x 800), `read_console_messages`,
  `read_network_requests`. `gif_creator` kept 13 frames and exported
  `walk-04.gif` (626 KB) to `~/Downloads/browser-hand/`.
- Repeated in Izam: `navigate`, `read_page` and `screenshot` on the same
  article.
- Every tool in `reference/claude-in-chrome/tools/` but the shortcut pair was
  called once, mapped to its browser-hand name (`list_profiles` and
  `select_profile` for the connected-browser trio); none failed.
- Found on the way, recorded in `plans/03-humane-input.md` § Verified: acting
  tools fail in Izam on pages with a password field, and moves ran slow.

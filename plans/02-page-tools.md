# Claude reads a page's structure, text, console and network, fills forms, runs scripts and uploads files in the selected profile

## The ask

The reading and form tools Claude in Chrome has
(`reference/claude-in-chrome/tools/`): `read_page`, `find`, `get_page_text`,
`read_console_messages`, `read_network_requests`, `form_input`,
`javascript_tool`, `file_upload`, with the same input schemas so the skill and
habits carry over. Builds on `plans/plan-bridge.md` (the wire, the dispatcher,
the tab group). Mouse and keyboard are `plans/plan-humane-input.md`.

A design goal from the user's "as humane as possible": reading a page should
not show Chrome's "started debugging this browser" bar, which appears in every
tab while any debugger session is attached
(`docs/external/chrome-debugger-cdp.md` § Infobar while attached). So the
debugger is attached only for tools that need it, and detached when idle.

## Alternatives

### Decision 1: how do `read_page` and `find` see the page? (two-way door)

| Criterion | Weight | Content-script walker with a ref map | CDP `Accessibility.getFullAXTree` |
| --- | ---: | ---: | ---: |
| Performance efficiency | 35 | 5 | 3 |
| Fit to the ask | 25 | 3 | 5 |
| Reliability | 20 | 5 | 3 |
| Security | 10 | 4 | 4 |
| Compatibility | 10 | 5 | 4 |
| **Weighted total** | **100** | **4.40** | **3.70** |

- Efficiency 5 vs 3: the walker runs in the page's isolated world with no
  debugger attach and no CDP round trip per node; the CDP route attaches the
  debugger (and its infobar) just to read. Neither is benchmarked yet; Phase 1
  records the walker's time on three real pages.
- Fit 3 vs 5: Chrome computes full accessible names for CDP; the walker
  computes them from `aria-label`, `aria-labelledby`, `<label>`, `alt`,
  `title`, `placeholder` and text, a subset of the accname rules.
- Reliability 5 vs 3: attach is refused on tabs holding any
  `chrome-extension://` iframe or a PDF frame
  (`docs/external/chrome-debugger-cdp.md` § Attach restrictions).
- Compatibility: Claude in Chrome injects its own `accessibility-tree.js` at
  `document_start` in all frames (`reference/claude-in-chrome/extension/manifest.json`),
  the same shape; refs resolve to elements for the click tools.

**Chosen: content-script walker, refs held in a per-frame map of `WeakRef`s.**
Revisit if names are wrong often enough that clicks miss.

### Decision 2: how does `find` match a natural-language query? (two-way door)

Claude in Chrome's `find` takes queries like "login button"; how it matches
is not knowable from the reference (its bundles were not copied).

| Must | Local lexical ranking | Call an LLM API | Chrome built-in Prompt API |
| --- | --- | --- | --- |
| Works offline with no API key or new network host | yes | no | not verified for extensions on this Chrome |
| **Survives** | **yes** | no | no |

Ranking scores each walker node on query words found in its role, name,
placeholder, value and text, with role words ("button", "link", "field")
matched to roles; up to 20 results, as the reference schema says.

**Chosen: local lexical ranking.** Revisit if the Prompt API is confirmed for
extensions (`## Follow-ups`).

### Decision 3: how are console messages and network requests captured? (two-way door)

| Criterion | Weight | Page hooks + `chrome.webRequest` | CDP `Runtime`, `Log`, `Network` |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 4 | 3 |
| Fit to the ask | 25 | 4 | 5 |
| Reliability | 20 | 5 | 2 |
| Security | 15 | 4 | 4 |
| **Weighted total** | **100** | **4.20** | **3.45** |

- Efficiency: hooks are always on with no debugger; CDP needs the debugger
  attached from page load to see anything, so it would stay attached.
- Fit 4: `webRequest` gives URL, method, status and type but no bodies, which
  is what the reference schema returns; CDP also gives timings.
- Reliability 2: CDP misses everything before attach, and detaching to clear
  the infobar loses capture.
- Console hooks: a MAIN-world script at `document_start` wraps `console.*`
  and listens for `error` and `unhandledrejection`
  (`docs/external/chrome-extension-apis.md` § chrome.scripting).

**Chosen: MAIN-world console hooks and `chrome.webRequest`.** Revisit if
response bodies are needed.

### Decision 4: how does `javascript_tool` run code? (two-way door)

| Criterion | `chrome.scripting` in MAIN world | CDP `Runtime.evaluate` |
| --- | --- | --- |
| Fit to the ask | a string must be `eval`ed, which page CSP without `unsafe-eval` blocks | runs under DevTools rules, not page CSP; `replMode` gives top-level `await` and last-expression results as the schema promises |
| Performance efficiency | no attach | one attach, reused for 30 s |

`Runtime.evaluate` with `replMode`, `awaitPromise`, `returnByValue`:
`docs/external/chrome-debugger-cdp.md` § CDP methods.

**Chosen: CDP `Runtime.evaluate`.** Revisit never; the schema needs REPL
semantics.

### Decision 5: how does `file_upload` set files? (two-way door)

| Criterion | Bytes over the wire + `DataTransfer` | CDP `DOM.setFileInputFiles` |
| --- | --- | --- |
| Fit to the ask | works in every profile as installed | needs "Allow access to file URLs" turned on per profile |
| Performance efficiency | one base64 copy, chunked at 1 MB (10 MB cap) | no copy |
| Security | the extension sees only the bytes sent | the extension can read any `file://` path once allowed |

**Chosen: bytes in `chunk` frames, set through `DataTransfer` on the input.**
Revisit if files above 10 MB are needed.

### Decision 6: what does `get_page_text` extract? (two-way door)

| Criterion | `@mozilla/readability` | `main`/`article`, else `body.innerText` |
| --- | --- | --- |
| Fit to the ask ("prioritizing article content") | strips navigation and boilerplate | keeps menus and footers |
| Performance efficiency | clones the document per call | reads text once |

**Chosen: Readability, falling back to `body.innerText` when it finds no
article.** Revisit if a call exceeds 500 ms on the Phase 1 pages.

## The decision

Feature path. Content scripts in `extension/src/page/` (walker, finder, text,
console hooks) are injected at `document_start` in all frames (decision 1, 3);
`chrome.webRequest` records requests per tab, cleared on cross-domain
navigation as the reference describes (decision 3). A debugger manager
attaches per tab on first need and detaches after 30 s idle so the infobar
closes; `plans/plan-humane-input.md` reuses it. `javascript_tool` uses it
(decision 4). `form_input` sets values directly with `input` and `change`
events: it is the fast path Claude in Chrome also has, and the humane path is
`computer` typing. `file_upload` reads files in the MCP server, enforcing the
reference's 10 MB per call, and sends them chunked (decision 5).

Dependencies: npm `@mozilla/readability`. New extension permissions:
`scripting`, `webRequest`, `debugger`, `webNavigation`, host access
`<all_urls>`. No network host, no secret.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `extension/src/page/walker.ts` | new | 1 | tree, refs, interactive filter, depth, `max_chars` | expected |
| `extension/src/page/find.ts` | new | 2 | lexical ranking | expected |
| `extension/src/page/text.ts` | new | 2 | Readability extraction | expected |
| `extension/src/page/hooks.ts` | new | 3 | MAIN-world console hooks | expected |
| `extension/src/network.ts` | new | 3 | `webRequest` log per tab | expected |
| `extension/src/debugger.ts` | new | 4 | attach on demand, idle detach | expected |
| `extension/src/page/forms.ts` | new | 4 | `form_input`, `DataTransfer` upload | expected |
| `host/src/tools/page.rs` | new | 1 | tool schemas and forwarding | expected |
| `extension/manifest.json` | edit | 1 | content scripts, permissions | reuse |
| `extension/src/background.ts` | edit | 1 | dispatch for the new tools | reuse |

*Reused, not rewritten:* `host/src/wire.rs` `chunk` frames for uploads;
`extension/src/background.ts` dispatcher and tab-group check from
`plans/plan-bridge.md`; tool descriptions and schemas copied from
`reference/claude-in-chrome/tools/` where they still hold. Searched for an
existing walker or accessible-name library in the tree: none.

## Edge cases

- `read_page` over `max_chars` (default 50,000): truncated at a line boundary
  with the full size noted, as the reference says.
- A ref from a page that has since navigated: `no_tab`-style error
  `stale_ref`, telling Claude to call `read_page` again.
- Cross-origin iframes: each frame's walker numbers its refs with a frame
  prefix (`f2_ref_7`) so refs never collide.
- `javascript_tool` on a page that refuses attach: `debugger_refused` naming
  the reason (`chrome://` page, extension iframe, PDF).
- `read_console_messages` with no pattern: works, and the description keeps
  the reference's advice to always pass one.
- DevTools opened by the user on the tab: `onDetach` fires and the manager
  re-attaches on next need.

## Declined

- CDP accessibility tree (decision 1): attaches the debugger to read.
- An LLM API or the Prompt API for `find` (decision 2): failed the offline
  must.
- CDP console and network capture (decision 3): loses events before attach.
- `chrome.scripting` for `javascript_tool` (decision 4): page CSP blocks it.
- `DOM.setFileInputFiles` (decision 5): needs a per-profile file URL toggle.
- Plain `innerText` for page text (decision 6): keeps boilerplate.
- `shortcuts_list` and `shortcuts_execute`: they run Claude side-panel
  shortcuts, and this build has no UI.

## What the tests hold

The walker on fixture HTML yields stable refs, names from each labelling
source, the interactive filter and truncation; `find` ranks the expected
element first on a fixture set of queries; the console hook records log,
error and unhandled rejection; the network log clears on cross-domain
navigation; the debugger manager attaches once for two calls and detaches
after the idle timer (fake timers); `form_input` sets text, select, checkbox
and fires events; upload rejoins chunks into the right bytes. Vitest with
jsdom for page code. The live check is Phase 5's walk.

## Follow-ups

- Chrome's built-in Prompt API for `find`, once confirmed available to
  extensions on stable Chrome.
- Refs inside iframes: the initial version reads and acts on the top frame
  only. Cross-origin frames need per-frame content scripts and a frame offset
  for clicks.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: the walker and `read_page`

- [x] `read_page` returns the tree with refs, `filter`, `depth`, `ref_id` and
  `max_chars` as the reference schema says (expected in
  `extension/src/page/walker.ts` and `host/src/tools/page.rs`), pinned by
  `extension/test/walker.test.ts`.
  Landed 17/10/2026: refs are numbered in the top frame only; iframes are a
  follow-up. Tool schemas live in `host/src/tools/args.rs` and forwarding in
  `host/src/mcp.rs` (no `host/src/tools/page.rs`). The content script entry is
  `extension/src/page/content.ts`, reached through
  `extension/src/page-client.ts`, which injects it into tabs opened before the
  extension loaded. Tests: `extension/test/page.test.ts`.
- [ ] Baseline: the walker's time and output size on three real pages
  (a news article, a web app, a long form) recorded in
  `docs/research/page-tools-baseline.md`.
- [x] Check: `npm --prefix extension test` and `cargo test` pass.

### Phase 2: `find` and `get_page_text`

- [x] `find` ranks walker nodes lexically and returns up to 20 refs (expected
  in `extension/src/page/find.ts`), pinned by `extension/test/find.test.ts`.
  Landed 17/10/2026: tests in `extension/test/page.test.ts`.
- [x] `get_page_text` returns Readability text, falling back to body text
  (expected in `extension/src/page/text.ts`), pinned by
  `extension/test/text.test.ts`.
  Landed 17/10/2026: per `docs/external/readability.md`, pulled while building;
  output capped at 100,000 characters.
- [x] Check: `npm --prefix extension test` passes.

### Phase 3: console and network

- [x] `read_console_messages` with `pattern`, `onlyErrors`, `limit`, `clear`
  reads the MAIN-world hook buffer for the current domain (expected in
  `extension/src/page/hooks.ts`), pinned by `extension/test/hooks.test.ts`.
  Landed 17/10/2026: the hook is `extension/src/page/hooks.ts`, run by
  `main-world.ts`; the isolated-world buffer is
  `extension/src/page/console.ts`. Tests in `extension/test/page.test.ts`.
- [x] `read_network_requests` with `urlPattern`, `limit`, `clear` reads the
  per-tab `webRequest` log (expected in `extension/src/network.ts`), pinned by
  `extension/test/network.test.ts`.
  Landed 17/10/2026: tests in `extension/test/tools.test.ts`.
- [x] Check: `npm --prefix extension test` passes.

### Phase 4: the debugger manager, scripts, forms and uploads

- [x] The debugger manager attaches per tab on demand and detaches after 30 s
  idle (expected in `extension/src/debugger.ts`), pinned by
  `extension/test/debugger.test.ts`.
  Landed 17/10/2026: tests in `extension/test/tools.test.ts`.
- [x] `javascript_tool` evaluates with `replMode` per
  `docs/external/chrome-debugger-cdp.md` § CDP methods; `form_input` and
  `file_upload` land in `extension/src/page/forms.ts`, pinned by
  `extension/test/forms.test.ts`, with the 10 MB cap in
  `host/src/tools/page.rs`.
  Landed 17/10/2026: the 10 MB cap and file reading are in
  `host/src/tools/files.rs`; tests for forms in `extension/test/page.test.ts`
  (jsdom has no `DataTransfer`, so `setFiles` and `dropFiles` wait for the
  walk) and for uploads in `host/tests/mcp.rs`.
- [x] Check: `npm --prefix extension test` and `cargo test` pass.

### Phase 5: review and the walk (needs you at Chrome)

- [ ] Code review of this plan's diff recorded in
  `docs/research/page-tools-review.md`: findings, fixes and re-run checks, or
  an explicit no-findings result.
- [ ] Walk, recorded under `## Verified` in `plans/plan-page-tools.md`: in one profile Claude
  reads a page, finds and fills a form field, reads a console error and an
  API request, runs a script, uploads a file, and no debugging bar shows
  during the read-only steps.
- [ ] Check: `## Verified` in `plans/plan-page-tools.md` records the walk as
  `passed`, with what was seen.

### Phase 6: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

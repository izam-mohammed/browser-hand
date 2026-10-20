# Code review: humane input

Reviewed: 19/10/2026

Scope: `plans/03-humane-input.md` as built: the humane model
(`extension/src/humane/params.ts`, `path.ts`, `timing.ts`, `random.ts`,
`keys.ts`), the `computer` action engine (`extension/src/input.ts`),
screenshots and zoom (`extension/src/screenshot.ts`), and in the MCP server
`do_computer`, `do_batch`, `do_upload_image`, `resize_window` and the image
store (`host/src/mcp.rs`, `host/src/tools/args.rs`,
`host/src/tools/images.rs`). Read against the plan's decision, Security
table, Edge cases and "What the tests hold".

Commit reviewed: `27b1462`, plus the working tree's uncommitted one-line
edits to `extension/src` and `host/src` (each updates a comment's plan path
after the plans were renamed; no findings in them).

## Findings

Line numbers are as the files stand after the fixes below.

| # | file:line | severity | problem | evidence | fix | status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `extension/src/input.ts:264` | medium | Typing ran about 50% slower than the sourced rhythm. Dhakal et al.'s 238.7 ms is the inter-key interval, press to press (`docs/research/humane-input.md` § 2), and `keyGapMs`'s own comment says the hold is part of it, but the gap was waited in full after each key's hold. Press to press came out near 355 ms. | A recording `Input` typing 2,000 characters measured a mean keyDown to keyDown interval of 351 ms. | `typeChar` returns its hold and the loop waits `max(0, keyGapMs - hold)`. Test: `extension/test/humane.test.ts` "spaces key presses by the research inter-key interval, hold included" (mean within 0.92 to 1.1 of 238.7 ms, floor kept). The `key` action's gaps between combos (`input.ts:285`) are left as they are. | fixed |
| 2 | `host/src/mcp.rs:393`, `extension/src/input.ts:295` | low | `scroll_amount` 1 to 10 is in the plan's Denial of service row, pinned by "out_of_range_inputs_are_refused_before_reaching_the_browser", but the MCP server did not check it, and the extension checked it only after gliding the cursor to the target. | `do_computer` bounded `duration` and `repeat` only; `run("scroll")` called `moveTo` before the range check. | Refuse it in `do_computer`; in the extension check before moving. Tests: the host test now also sends 0 and 11; `humane.test.ts` "refuses a bad scroll_amount before moving the mouse". | fixed |
| 3 | `extension/src/input.ts:87` | low | The plan says `fast` "keeps the same events with no travel time or gaps" and "What the tests hold" says the same; `fast` sends one `mouseMoved` at the target instead of the path. | `const path = pace === "fast" ? [to] : movePath(...)`; the test checks `["mouseMoved", "mousePressed", "mouseReleased"]`. | Either send the full path with no waits, or change the plan to "the same kinds of events". A choice for the owner. | open |
| 4 | `extension/src/input.ts:184` | low | A `key` combo of only Shift and a letter (`shift+a`) sends `text: "a"` with the Shift bit, so it types a lowercase letter. | `typesText` uses `c.key.text` and ignores Shift. | When the only modifier is Shift, send the shifted character (`A`, or the `PUNCT` shifted form) as `text`. | open |
| 5 | `extension/src/screenshot.ts:52` | low | The device pixel ratio that sizes the clip is read with `Runtime.evaluate("window.devicePixelRatio")` in the page's main world, which a page can redefine, skewing the screenshot's scale and so every coordinate Claude reads off it. | `dprEval` evaluates in the page context. | Take it from `Page.getLayoutMetrics` (device `visualViewport` against `cssVisualViewport`), or evaluate in an isolated world. | open |
| 6 | `extension/src/screenshot.ts:50` | low | Only `Page.captureScreenshot` has the 10 s timeout the plan lists; `Page.getLayoutMetrics` and the `Runtime.evaluate` before it fall under the server's 300 s `COMPUTER_WAIT`. | `withTimeout` wraps one call (`screenshot.ts:72`). | Wrap the whole `capture` in `withTimeout`. | open |
| 7 | `host/src/tools/images.rs:39` | low | Screenshots are pruned only when another is kept or looked up, so after the last screenshot of a session they stay in memory past 5 minutes, for as long as the server runs. The plan's Data paragraph says they "stay in memory for 5 minutes, then go". | `prune` runs from `keep` and `get` only. | Prune on a timer, or reword the plan to "unusable after 5 minutes". | open |
| 8 | `extension/src/screenshot.ts:101` | low | The `captureVisibleTab` fallback returns device pixels with no "viewport" or "image" sizes in its text, so Claude's coordinates are off by the pixel ratio and a GIF frame recorded from it gets scale 1.0 (`images::scale_from_text` finds nothing), placing click circles wrongly on a Retina screen. | Text: "via captureVisibleTab (device pixels; ...)". | Report viewport and image sizes as `capture` does, or scale the image to CSS pixels. | open |
| 9 | `extension/test/tools.test.ts:88` | low | "What the tests hold" promises "screenshot scaling maps coordinates back exactly"; the tests check `fitScale` and `zoomScale` sizes only, nothing checks the `clip` or its `scale / dpr` against a fake debugger. The plan itself leaves the `clip.scale` question to the walk. | `describe("screenshot scaling")` has two size tests. | A fake `DebuggerManager` test for `capture` that checks `clip`, `scale` and the reported image size for dpr 1 and 2. | open |

## Security table, walked against the code

- `allowed_origins` names only this extension: `host/src/install.rs:27`.
- `ownTab` before `computer`, screenshots, `resize_window` and
  `upload_image`: `extension/src/background.ts:86`, `:171`, `:175`, `:158`.
- Tab tools refuse to guess a profile: `host/src/mcp.rs:240` to `:248`.
- Refused attaches become `debugger_refused`: `extension/src/debugger.ts:50`.
- Images in memory only, saved only on `save_to_disk`, never logged:
  `host/src/mcp.rs` `keep_images`; see finding 7 on the expiry.
- `upload_image` takes only ids this server issued, into owned tabs:
  `host/src/mcp.rs` `do_upload_image`.
- Debugging bar left showing: no code hides it.
- Bounds: `wait` 0 to 10 s and `repeat` 1 to 100 in both the server and the
  extension; `scroll_amount` now in both (finding 2); no nested batches;
  batch length uncapped, as the plan says.

Every "Proved by" test named in the table exists. Rows marked "no test yet"
are acknowledged gaps.

## Checks re-run

19/10/2026, after the fixes:
`npm --prefix extension test && cargo test --manifest-path host/Cargo.toml && sh scripts/build.sh`
exited 0. Extension: 5 files, 67 tests passed. Host: 51 tests passed,
0 failed. Build: release binary and extension built, binary copied to
`plugin/server/`, native host manifest installed.

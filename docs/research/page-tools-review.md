# Code review: page tools

Reviewed: 19/10/2026

Scope: `plans/02-page-tools.md` as built: the walker and `read_page`
(`extension/src/page/walker.ts`), `find` (`find.ts`), `get_page_text`
(`text.ts`), the console hooks and buffer (`hooks.ts`, `main-world.ts`,
`console.ts`), the network log (`extension/src/network.ts`), `form_input`
and file setting (`forms.ts`), `javascript_tool` (`extension/src/background.ts`),
`file_upload` (`host/src/tools/files.rs`), the debugger manager
(`extension/src/debugger.ts`), and the plumbing between them
(`content.ts`, `extension/src/page-client.ts`, `extension/manifest.json`).
Read against the plan's decision, Edge cases, Security table and "What the
tests hold".

Commit reviewed: `27b1462`, plus the working tree's uncommitted one-line
edits to `extension/src` and `host/src` (each updates a comment's plan path
after the plans were renamed; no findings in them).

## Findings

Line numbers are as the files stand after the fixes below.

| # | file:line | severity | problem | evidence | fix | status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `extension/src/page/find.ts:56` | medium | `find` matched words against a password field's value, so a query confirmed the secret ("find hunter2" returned the password box). The plan's row "`read_page` shows typed passwords" holds for the walker but `find` leaked the same value as an oracle. | `extra` was built from `(el as HTMLInputElement).value` for every element; with the fixture's password `secret`, `find(document.body, "secret")` returned the password field. | Skip the value when `type === "password"`. Test: `extension/test/page.test.ts` "never matches on a password field's value". | fixed |
| 2 | `extension/src/page/hooks.ts:26` | medium | The MAIN-world hook copies each console call with `window.postMessage(..., "*")`, so every page `message` listener also receives it. A page that logs its messages (`addEventListener("message", e => console.log(e.data))`, common while debugging) loops forever: each log posts a message, which logs again. It also shows the page that browser-hand is installed. | `installHooks` posts on the page's own window; `ConsoleBuffer.listen` only filters on the receiving side. | Carry entries on a channel the page does not listen to: a `CustomEvent` with a private name and a JSON string `detail` dispatched on `document`, or a `MessageChannel` port handed to the isolated world once at `document_start`. Needs a check in real Chrome that the detail crosses worlds, so not done here. | fixed 19/10/2026: entries go out as a `CustomEvent` on the document with a JSON string detail; test "the page's message listeners never see console entries". Crossing worlds in real Chrome is left to the plan 02 walk |
| 3 | `extension/src/page/console.ts:15` | low | The 4,000-character cap per console entry (the plan's Denial of service row) was applied only in the hook. A page can post a tagged message itself (the plan's Spoofing row accepts that) with megabytes of text, and up to 1,000 of them are kept and returned. | `listen` pushed `String(e.data.text)` unchanged. | Cap again on receipt with the shared `MAX_ENTRY_CHARS`. Test: "caps a tagged message the page posts itself at 4,000 characters", which is also the "tagged one from the page" test the Spoofing row lacked. | fixed |
| 4 | `extension/src/page/walker.ts:17` | medium | Refs restart at `ref_1` in every new document. After a navigation and one `read_page` or `find`, a ref Claude kept from the previous page resolves to a different element on the new page, and `computer` or `form_input` acts on it. The plan's edge case says a ref from a navigated page is an error. | `nextRef` is module state of the content script, which is fresh per document; `resolveRef` only checks the element is connected. | Make refs unique per document, e.g. a short per-document token in the ref (`ref_k3_12`) or a random starting number, so an old ref never resolves. Changes the ref format Claude sees, so left for the owner. | fixed 19/10/2026: refs carry a per-document tag (`ref_k3x9_12`); test "a ref from the previous document never resolves on the next one" |
| 5 | `extension/src/page/walker.ts:236`, `extension/src/page/forms.ts:13` | low | A stale ref is reported as `bad_args`; the plan's edge case names the error `stale_ref`, which is not in `docs/protocol.md` § Errors or `ErrorCode`. The message does tell Claude to read again. | Both throw with code `bad_args`. | Either add `stale_ref` to `ErrorCode` (a new enum value older MCP servers cannot parse, so bump or tolerate unknown codes) or change the plan's edge case to `bad_args`. | open |
| 6 | `extension/src/page/console.ts:37`, `extension/src/network.ts:72` | low | `limit: 0` returns everything rather than nothing, since `slice(-0)` is `slice(0)`; up to 1,000 console entries or 500 requests come back. | `found.slice(-(opts.limit ?? 100))`; the schema allows `0` (`u32` in `host/src/tools/args.rs`). | `slice(Math.max(0, found.length - limit))`, or refuse `limit < 1` in the MCP server. | open |
| 7 | `host/src/tools/files.rs:50` | low | The 10 MB cap is checked on `metadata().len()` and the file is then read whole, so a file that grows in between is read and sent past the cap. | `total += meta.len()` then `std::fs::read(path)`. | Open once and read with `take(MAX_UPLOAD_BYTES - total + 1)`, refusing when the read exceeds the remainder. | open |
| 8 | `extension/src/debugger.ts:44` | low | Two calls that attach to the same tab at once both call `chrome.debugger.attach`; the second fails with "already attached" and comes back as `debugger_refused`. Unreachable from one session today, because `Server::call` in `host/src/mcp.rs` holds the bound lock for the whole call. | `attach` checks `attached` before awaiting and adds the tab only after. | Keep the in-flight attach promise per tab and await it. | open |
| 9 | `extension/test/page.test.ts:145` | low | "What the tests hold" promises the console hook records "log, error and unhandled rejection"; the tests cover log and error only, and nothing exercises the `error` or `unhandledrejection` listeners. | "records logs and errors without breaking the page's console" calls `console.log` and `console.error` only. | Dispatch an `ErrorEvent` and a `PromiseRejectionEvent` (or an `Event` with `reason`) on the window and read them back as `exception`. | open |

## Security table, walked against the code

Every "Handled by" in the plan's table exists as described:

- Socket dir `0700` and socket `0600`: `host/src/paths.rs:47`,
  `host/src/native_host.rs:214`.
- Console messages kept only when `e.source` is the same window:
  `extension/src/page/console.ts:13`. Finding 3 adds the length cap the
  Denial of service row assumed.
- `ownTab` first: every page tool in `extension/src/background.ts` (`read_page`,
  `find`, `get_page_text`, `read_console_messages`, `read_network_requests`,
  `form_input`, `javascript_tool`, `file_upload`) calls it before acting.
- Password values: the walker skips them (`walker.ts:176`), `form_input`
  echoes `••••` (`forms.ts:65`); `find` did not, finding 1.
- Network entries: method, URL, type, status, timing only (`network.ts:39`).
- `file_upload`: absolute paths to regular files, 10 MB per call
  (`files.rs:43` to `:52`); see finding 7.
- Caps: `read_page` 50,000, page text 100,000, script results 50,000,
  console 1,000 entries, network 500 per tab, 64 MiB frames, chunks out of
  order dropped: all present.
- `javascript_tool`: limited to owned tabs; refusals become
  `debugger_refused` (`debugger.ts:50`).
- Prompt injection: still only Claude Code's approval; see
  `docs/research/final-review.md` finding 2.

The "Proved by" tests named in the table all exist. Rows marked "no test
yet" in the plan are acknowledged gaps, not findings; the "tagged one from
the page" gap is now covered by finding 3's test.

## Checks re-run

19/10/2026, after the fixes:
`npm --prefix extension test && cargo test --manifest-path host/Cargo.toml && sh scripts/build.sh`
exited 0. Extension: 5 files, 67 tests passed. Host: 51 tests passed,
0 failed. Build: release binary and extension built, binary copied to
`plugin/server/`, native host manifest installed.

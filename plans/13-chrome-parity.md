# browser-hand keeps up with Claude in Chrome: a cursor you can see, tokens hidden in network reads, a steady reconnect and plain-spoken argument errors

## The ask

"Check the claude in chrome mcp now and tell me how close are we when it
comes to the features and how many features are not there in the plans
itself", then "have it in the plans and update in the reference files also
in the same pr".

The reference was refreshed on 14/11/2026 from Claude Code 2.1.325 (tool
list read live from `claude --claude-in-chrome-mcp`) and the installed
extension 1.0.107; `reference/claude-in-chrome/README.md` § *Changes since
17/10/2026* lists what moved. Tool parity holds: the 20 tools Claude in
Chrome has are all in `host/src/mcp.rs` (the browser trio as
`list_profiles` and `select_profile`), and the two it dropped
(`shortcuts_list`, `shortcuts_execute`) were declined in
`plans/02-page-tools.md` already. Four behaviours are new upstream and
appear in no plan:

- `read_network_requests` lists auth values in URLs as `REDACTED`, and
  `urlPattern` matches against that form (`tools/read_network_requests.json`).
  `plans/02-page-tools.md` § Security chose not to redact.
- After a brief disconnect Claude Code waits up to 6 seconds for the
  session's own browser to come back, and checks the page before repeating
  an action that may have run (Claude Code changelog). `host/src/mcp.rs`
  `call` fails at once when the profile's host is gone.
- Browser tool calls refuse some escaped or JSON-text inputs and say how to
  respell them (Claude Code changelog). The host's serde errors say only
  that the type is wrong.
- Extension 1.0.107 adds `cursor-motion.js` (an animated agent cursor on
  the page). browser-hand's cursor is virtual (`extension/src/input.ts`
  `Mouse.moveTo`): the person watching sees things happen with no pointer.

Built so far: `docs/built/BUILT-2026-11-14-2216.md`.

## Alternatives

### Decision 1: which URL parts the network read hides (two-way door)

URLs in the network log carry tokens in query strings (OAuth `code`,
`access_token`, signed URL `sig`), and the read hands them to the model.

Searched 14/11/2026: "OWASP sensitive information in query string URL
redact tokens logging"; read OWASP *Information exposure through query
strings in URL* and ASVS 8.3.1 (sensitive data must not be in query
strings, and such URLs land in logs).

| Must | Baseline: no redaction | Named keys | Every query value |
| --- | --- | --- | --- |
| No token value reaches the model | no | yes | yes |
| `urlPattern` still finds `/api/` paths and hosts | yes | yes | yes |
| **Survives** | no | **yes** | **yes** |

| Criterion | Weight | Named keys | Every query value |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 5 |
| Usefulness of the read | 35 | 5 | 2 |
| Coverage of unknown token names | 25 | 3 | 5 |
| **Weighted total** | **100** | **4.50** | **3.95** |

- Efficiency 5 for both: one `URL` parse per entry, done once when the
  request starts (`NetworkLog.started`), not per read.
- Usefulness: query values are often what the person is debugging
  (`?page=2`, `?q=shoes`); hiding all of them loses that.
- Coverage: a named list misses a site's own key names; the list matches
  case-insensitively on substrings (`token`, `key`, `secret`, `sig`,
  `password`, `auth`, `code`, `session`) to narrow the gap, and userinfo
  (`user:pass@`) is always hidden.

Sensitivity: if a walk shows tokens slipping through under other names,
usefulness would have to fall below 2 to flip it; the list grows instead.
Risk: a missed name leaks one value to the model; the person's own browser
already holds it.

**Chosen: named keys**, matching Claude in Chrome's `REDACTED` form.
Revisit if a walk finds a token under a name the list misses twice.

### Decision 2: what the host does when a profile's connection drops (two-way door)

Chrome restarts the extension's service worker, and the profile's host
socket goes away for a moment.

Searched 14/11/2026: "Chrome MV3 service worker restart native messaging
reconnect grace period"; read Chrome's service worker lifecycle and
native messaging docs (a `connectNative` port keeps the worker alive
since Chrome 105) and chromium-extensions threads reporting restarts
anyway.

| Must | Baseline: fail at once | Wait for the same profile | Retry the call |
| --- | --- | --- | --- |
| Never runs an acting tool twice | yes | yes | no (a click may have landed) |
| **Survives** | **yes** | **yes** | no |

| Criterion | Weight | Baseline: fail at once | Wait for the same profile |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 4 |
| Reliability | 40 | 2 | 5 |
| Compatibility with Claude in Chrome habits | 20 | 2 | 5 |
| **Weighted total** | **100** | **3.20** | **4.60** |

- Wait efficiency 4: polls the socket directory every 250 ms for at most
  6 s, only while the bound connection is dead.
- Reliability: the baseline turns every worker restart into a failed call
  and a `select_profile` round trip.

Sensitivity: holds unless restarts last longer than 6 s, which turns the
wait into a 6 s delay before the same error.
Risk: a dropped call that had already acted; the error says so and tells
Claude to look at the page before repeating it.

**Chosen: wait for the same profile**, up to 6 s, never another profile.
Revisit if walks show restarts longer than 6 s.

### Decision 3: arguments that arrive as JSON text (two-way door)

Models sometimes send an array or object argument as a JSON string
(`"coordinate": "[300, 200]"`, `"actions": "[{...}]"`).

Searched 14/11/2026: "MCP tool arguments LLM sends JSON string instead of
array validation error hint"; read Claude Code issues on stringified MCP
arguments and the coercion and loosened-schema workarounds they propose.

| Must | Baseline: serde error | Refuse with a respelling hint | Coerce silently |
| --- | --- | --- | --- |
| A wrong value never acts | yes | yes | no (a mis-parsed string can click) |
| **Survives** | **yes** | **yes** | no |

| Criterion | Weight | Baseline: serde error | Refuse with a hint |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 5 |
| Recovery in one more call | 40 | 2 | 5 |
| Compatibility with Claude in Chrome | 20 | 2 | 5 |
| **Weighted total** | **100** | **3.20** | **5.00** |

- Efficiency 5 for both: the check runs only after deserialisation fails.
- Recovery: serde's "invalid type: string, expected a sequence" does not
  say what to send instead.

Sensitivity: none plausible.
Risk: none beyond a refused call.

**Chosen: refuse with a hint** naming the field and the shape to send.
Revisit never; it is an error message.

### Decision 4: how the person sees the cursor (two-way door)

Searched 14/11/2026: "Chrome extension content script fake cursor overlay
shadow DOM pointer-events none automation indicator"; read practitioner
overlays (`position: fixed`, top z-index, `pointer-events: none`, shadow
root for style isolation) and noted content scripts do not run on
`chrome://` pages.

| Must | Baseline: none | Overlay in the content script | CDP `Overlay` domain |
| --- | --- | --- | --- |
| Visible to the person while Claude acts | no | yes | partly (highlights boxes, no pointer) |
| Never takes a click | yes | yes | yes |
| **Survives** | no | **yes** | no |

| Criterion | Weight | Path sent once, animated in the page | A message per glide point |
| --- | ---: | ---: | ---: |
| Performance efficiency | 50 | 5 | 2 |
| Smoothness | 30 | 5 | 3 |
| Reliability under slow pages | 20 | 4 | 3 |
| **Weighted total** | **100** | **4.80** | **2.50** |

- Path once: one `chrome.tabs.sendMessage` per move with the points and
  their interval; the page animates with `requestAnimationFrame`. Per point
  is 30 to 60 messages a second through the worker.

Sensitivity: holds unless the page's clock drifts from the worker's; the
overlay snaps to the final point when the move ends either way.
Risk: the overlay shows up in screenshots; it is hidden for the capture.

**Chosen: an overlay in the content script, its path sent once per move.**
Revisit if the walk shows the overlay lagging the real events.

## The decision

The network log redacts named auth keys and userinfo when a request is
recorded (decision 1); a dropped profile connection is waited on for up to
6 s, the same profile only, and a call cut mid-way says it may have run
(decision 2); an argument that fails to parse but is valid JSON text is
refused with the shape to send (decision 3); and the virtual cursor gets a
visible twin drawn by the content script, fed one path per move and hidden
during screenshots (decision 4). The reference refresh lands in the same
PR as this plan. No new dependency, permission, host or secret.

Standards: `docs/standards.md` (types, vitest, cargo test, the build),
through `npm --prefix extension test && cargo test --manifest-path
host/Cargo.toml && sh scripts/build.sh`.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `extension/src/page/cursor.ts` | new | 1 | the overlay: shadow root, path animation, hide and show | expected |
| `extension/src/page/content.ts` | edit | 1 | routes the cursor messages | reuse |
| `extension/src/input.ts` | edit | 1 | `Mouse.moveTo` sends the path before gliding | reuse |
| `extension/src/screenshot.ts` | edit | 1 | hides the overlay for the capture | reuse |
| `extension/src/network.ts` | edit | 1 | `redactUrl` applied in `NetworkLog.started` | reuse |
| `host/src/mcp.rs` | edit | 2 | `call` waits for the profile's host; mid-call drop message | reuse |
| `host/src/host_conn.rs` | edit | 2 | `call_error_frame` says the action may have run | reuse |
| `host/src/tools/args.rs` | edit | 3 | the JSON-text check and hint | expected |
| `host/src/instructions.md`, `plugin/skills/browser-hand/SKILL.md` | edit | 4 | redaction, the reconnect and the cursor in a line each | reuse |

*Reused, not rewritten:*

- `extension/src/input.ts` `movePath`: already computes the glide; the
  overlay replays its points rather than computing its own.
- `extension/src/page/content.ts` message listener: the existing
  `chrome.runtime.onMessage` route carries the cursor messages.
- `host/src/mcp.rs` `hosts` and `host_for`: already find a profile's live
  host; the wait polls them.
- Searched for an existing overlay, redaction helper or JSON-text check
  (`overlay`, `redact`, `REDACTED`, `from_str` on arguments): none exists.

## Edge cases

- A move on a `chrome://` page: no content script, no overlay; the move
  still happens.
- A tab in the background: the overlay animates when shown, or snaps to
  the last point.
- A token in a URL fragment (`#access_token=`): redacted like a query key.
- `urlPattern` containing a token value: no match, since matching runs on
  the redacted URL.
- The profile's host comes back as a different socket path: accepted when
  it reports the same profile dir.
- A valid string field (`text`, `url`) whose value happens to be JSON: not
  refused; only fields whose schema is not a string are checked.

## Security

Entry points: the network read (page traffic in, model out), tool
arguments (model in), the page overlay (extension into every page).

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | tokens in request URLs reach the model | `redactUrl` at record time | `network.test.ts` redaction cases |
| Tampering | a page script reads or moves the overlay to mislead the person | closed shadow root, created by the isolated-world content script | `cursor.test.ts` closed-root case |
| Elevation | a JSON-text argument is coerced into an action | refused, never coerced | `args` tests on `coordinate` and `actions` |
| Repudiation | a dropped acting call repeated blindly | error says it may have run | `mcp.rs` mid-call drop test |

Data: no new data stored; redacted values are never kept. Logged: nothing
new. Checklist: OWASP ASVS 8.3.1.

## Declined

- No redaction (decision 1): fails the token must.
- Every query value (decision 1): lost on usefulness.
- Retrying a dropped call (decision 2): can act twice.
- Coercing JSON text (decision 3): a mis-parsed string can act.
- CDP `Overlay` domain (decision 4): highlights boxes, draws no pointer.
- A message per glide point (decision 4): lost on efficiency.
- The `favicon` permission and tab icons: nothing in browser-hand reads a
  tab's icon.
- The Google Meet script and the organisation sign-in lock: Claude
  product features, not browser control.

## What the tests hold

Redaction of each named key, case-insensitive, in query and fragment, with
userinfo; `urlPattern` matching the redacted form; the overlay mounting in
a closed shadow root, replaying a path, snapping on the last point and
hiding for a screenshot (jsdom); the host waiting for a returning profile
and giving up after 6 s with a fake clock; a mid-call drop's message;
JSON-text refusals for `coordinate`, `region` and `browser_batch` `actions`
with the hint, and a JSON-looking `text` passing through.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: the rough cut (needs you: try it)

- [x] A visible cursor follows every glide, click and drag on the page and
  is hidden while a screenshot is taken (expected in
  `extension/src/page/cursor.ts`, fed by `Mouse.moveTo` in
  `extension/src/input.ts`), pinned by `cursor.test.ts`.
- [x] `read_network_requests` shows named auth values and userinfo as
  `REDACTED`, and `urlPattern` matches the redacted URL (expected in
  `extension/src/network.ts`), pinned by redaction cases in
  `network.test.ts`.
- [ ] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
- [ ] You try it: run `sh scripts/build.sh`, ask Claude to open a page and
  click through a form, and watch the cursor glide; then open a URL with
  `?access_token=abc` and ask for the network read. Say how the cursor
  looks and moves. What you want changed goes into the phases below.

### Phase 2: a steady reconnect

- [x] When the bound profile's connection drops, the next call waits up to
  6 s for the same profile's host and goes on; after that it fails as now
  (expected in `host/src/mcp.rs` `call`), pinned by a fake-clock test.
- [x] A call cut off mid-way says the action may have run and to check the
  page before repeating it (expected in `host/src/host_conn.rs`
  `call_error_frame`), pinned by a mid-call drop test.
- [ ] Check: the standard check command passes.

### Phase 3: plain-spoken argument errors

- [x] An array or object argument sent as JSON text is refused with the
  field name and the shape to send, and never coerced (expected in
  `host/src/tools/args.rs`), pinned by tests on `coordinate`, `region`
  and `browser_batch` `actions`, with a JSON-looking `text` accepted.
- [ ] Check: the standard check command passes.

### Phase 4: the cursor's polish and the words

- [x] The overlay respects the person's reduced-motion setting by snapping
  instead of gliding, and disappears a few seconds after the last action
  (expected in `extension/src/page/cursor.ts`), pinned by
  `cursor.test.ts`.
- [x] `host/src/instructions.md` and `plugin/skills/browser-hand/SKILL.md`
  say network URLs come redacted and a dropped action may have run,
  pinned by `host/tests/instructions.rs`.
- [ ] Check: the standard check command passes.

### Phase 5: the walk (needs you at Chrome)

- [ ] In one profile: watch the cursor through a form fill and a drag,
  take a screenshot and confirm no overlay in it, read the network log of
  a page with a token in its URL, and quit and reopen the extension's
  worker (`chrome://extensions`, reload) mid-session to see the next call
  go on. Written under `## Verified` with the date.
- [ ] Check: the standard check command passes.

### Phase 6: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to
  date) with a Conventional Commit title for the whole change, a body
  naming this plan, what changed and why, and the checks run with their
  result. The PR's URL printed as the evidence. Opened, never merged.

# two browsers with a profile named Default never get mixed up, and the settings page lists every browser's profiles

## The ask

Two gaps left by `plans/14-chrome-parity-2.md`, both written down in its
last commit:

1. The native host's `hello` carries `profileDir` and no browser. With
   Chrome and Brave both running and each holding a profile called
   `Default`, `host_for` in `host/src/mcp.rs` matches on the dir alone: both
   hosts count as connected for both profiles (`list_profiles` warns "two
   extensions answer"), and `select_profile` can bind the wrong browser.
2. `host/src/native_host.rs` fills the settings page's profile list with
   `read_profiles(chrome_dir)`, Chrome's `Local State` only, so a Brave,
   Edge, Chromium or Vivaldi profile cannot be the default profile.

Built so far: `docs/built/BUILT-2026-11-14-2216.md` (plans 13 and 14 landed
since; no newer snapshot was written for this small change).

## Alternatives

### Decision 1: how the browser behind a host is learned (two-way door)

The `browser` field is optional on the wire, so the source can change later.
The ask needs one key from `BROWSERS` (`chrome`, `brave`, ...) per host.

Searched 17/11/2026: "Brave navigator.userAgentData brands", "chrome
native messaging host parent process", "Chrome --user-data-dir default
Linux", MDN `NavigatorUAData.brands`. Found: Brave lists itself in brands
only by its own choice and documents `navigator.brave.isBrave()` as the
real signal, so brands vary by browser and version
(community.brave.com "Browser identification"; ctrl.blog "How to detect
Brave"); two channels of one vendor (Chrome Stable and Beta) share brands.
Measured here on 17/11/2026 with Chrome for Testing 157: the native host's
parent pid is the browser's main process, `/proc/<ppid>/exe` is the binary
and `/proc/<ppid>/cmdline` carries `--user-data-dir=<dir>` when given.

| Must | Baseline: dir only | Parent process in the host | Brands in the extension | Per-browser manifest path |
| --- | --- | --- | --- | --- |
| Tells two Chromium browsers apart | no | yes | no (same-vendor channels, Brave by choice) | yes |
| Older extensions keep working unchanged | yes | yes | no (they send no brands) | yes |
| **Survives** | no | **yes** | no | **yes** |

| Criterion | Weight | Parent process in the host | Per-browser manifest path |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 5 |
| Reliability | 40 | 4 | 3 |
| Works for installs made before this lands | 20 | 5 | 1 |
| **Weighted total** | **100** | **4.60** | **3.40** |

- Parent process efficiency 5: one `/proc` read when the host starts, none
  per hello or per call.
- Parent reliability 4: exact for the user data dir when the browser was
  started with `--user-data-dir` (two throwaway dirs stand in for two
  browsers in the proof) and by binary name otherwise; a snap or flatpak
  wrapper can hide the binary, then the host says nothing and matching falls
  back to the dir. macOS reads the binary only and is unproven here.
- Manifest path reliability 3: identity is fixed at install, so a reinstall
  or a moved browser leaves it stale; `argv[0]` of a symlink is also
  unmeasured.
- Manifest path installs 1: every existing manifest would lack it.

Sensitivity: brands would win only if the host could not see its parent
(flatpak); a later optional `browser` hint from the extension fits the same
field. Risk: a wrapper script that execs a differently named binary labels
the host by that binary; the table's hints cover the packaged names.

**Chosen: the native host reads its parent process once** (the user data
dir argument first, then the binary's name against the table), and stamps
`browser` on every `hello` it sends to socket clients. The extension is
unchanged, so every existing extension works at once. Revisit if a walk
finds a browser whose parent is not the main process.

### Decision 2: how matching uses it (two-way door)

Searched 17/11/2026: the code paths `host_for`, `bind`, `bind_default`,
`do_list_profiles` and the reconnect wait in `host/src/mcp.rs`.

| Must | Baseline: dir only | Require a browser on every hello | Match the browser when both sides state one |
| --- | --- | --- | --- |
| A host of another browser never binds | no | yes | yes |
| Hello without `browser` (older host, unknown binary) still matches by dir | yes | no | yes |
| **Survives** | no | no | **yes** |

Only one option survives the musts, so it is scored alone: efficiency 5 (a
string compare per hello, no extra call), reliability 5 (an unknown stays
what it is today).

**Chosen: a profile matches a host when the dir is equal and the host's
`browser` is absent or equals the profile's.** `<browser>:<dir>` ids from
`host/src/profiles.rs` are what `select_profile` and the default profile
already use. Revisit if a host reports a wrong key in a walk.

### Decision 3: how the settings page learns every browser's profiles (two-way door)

Searched 17/11/2026: `Conf::read` in `host/src/native_host.rs`,
`renderSessions` in `extension/src/options/page.ts`.

| Must | Baseline: Chrome's dir | `read_all(roots())`, ids and browser on each ref | A second request from the page to the MCP side |
| --- | --- | --- | --- |
| A Brave profile can be picked | no | yes | yes |
| The page needs no new frame | yes | yes | no (new frame pair) |
| **Survives** | no | **yes** | no |

Scored alone: efficiency 5 (the read already happens on each `settings`
frame; `read_all` adds one `Local State` read per installed browser, each a
few KB), reliability 5 (the same list `list_profiles` shows).

**Chosen: `ProfileRef` gains `id` and `browser`** (the display name), filled
from `read_all(roots())`. The page's value is `id`, its label is the name
and, when the id has a prefix, the browser. A stored bare dir still resolves
(`bind_default` already takes `id` or `dir`). Revisit if the list needs
filtering by browser.

## The decision

Decisions 1 to 3 above. Wire: `hello` gains an optional `browser`
(`#[serde(default, skip_serializing_if = "Option::is_none")]`, `#[ts(optional)]`),
`ProfileRef` gains `id` and `browser`. The `protocol` stays 1: adding an
optional field is not breaking (`docs/protocol.md` § Compatibility), and
serde ignores fields it does not know, so an older MCP server reads the new
hello. Compatibility matrix: older extension with a new host, works (the
host stamps); older host with a new MCP server, no `browser`, dir match as
today; newer host with an older MCP server, the field is skipped; older host
with a new settings page, `id` and `browser` absent, the page falls back to
`dir`. No new dependency, permission, network host or secret (`libc` is
already used; macOS `proc_pidpath` comes from it).

Standards: `docs/standards.md` (fmt, Clippy, tsc, Biome, vitest, cargo test
with the ts-rs export, 90 % coverage floors, docs reference, book), through
`make check`.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `host/src/wire.rs` | edit | 1, 2 | `Hello.browser`, `ProfileRef.id` and `.browser` | fixed |
| `extension/src/wire.gen.ts` | generated | 1, 2 | by `cargo test` | fixed |
| `host/src/profiles.rs` | edit | 1 | exe hints on `Browser`, `identify`, parent reader | reuse |
| `host/src/native_host.rs` | edit | 1, 2 | stamps `browser`; `HostOptions.roots` and `browser`; merged list | reuse |
| `host/src/host_conn.rs` | edit | 1 | `HelloInfo.browser` | reuse |
| `host/src/mcp.rs` | edit | 1 | `host_for` takes the profile; callers | reuse |
| `extension/src/options/page.ts` | edit | 2 | value `id`, label with browser | reuse |
| `extension/src/background.ts` | edit | 1 | `hello` literal types only | reuse |
| `scripts/prove/browser-identity.sh` | new | 3 | two browsers, one `Default` each | expected |
| `docs/protocol.md`, `docs/testing.md`, `README.md`, book | edit | 3 | the field, the proof, the gap line | reuse |

*Reused, not rewritten:* `BROWSERS` and `read_all` (ids already
`<browser>:<dir>`), `roots()`, `linux-open.sh` (the proof copies its
driver), `cft.sh`. Searched for an existing process-inspection helper and
any use of `getppid`: none.

## Edge cases

- Chrome and Brave both hold `Default`: `chrome:Default` and
  `brave:Default` each see only their own host as connected.
- The host's parent is unknown (flatpak, snap wrapper, no `/proc`): no
  `browser`; matching is by dir as before.
- A browser started with a `--user-data-dir` that is no table dir: the
  binary name decides; a Chrome for Testing binary reads as `chrome`.
- `BROWSER_HAND_CHROME_DIR` set (tests, proofs): that dir is the one root,
  keyed `chrome`; a host started from that dir is `chrome`.
- `--user-data-dir <dir>` with a space, a trailing slash, a symlinked dir:
  all compare equal by canonical path.
- Hostile exe name (`/tmp/x brave`): only the basename, its parent dir and
  `.app` parts are matched, and only table keys are ever emitted.
- Default profile stored as a bare `Default` with two browsers: the first
  browser in table order, as today; a prefixed id is exact.
- Settings page with one browser: labels as before (ids unprefixed).

## Security

Entry points: a process id (`getppid`) read from `/proc`; the extension's
settings page.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Tampering | a process spoofs its way to a wrong binding | identity is a routing hint, not auth: sockets are in a `0700` dir, same user only | existing socket dir test; `profiles.rs` test that a hello never widens what a call may do |
| Information disclosure | the parent's command line holds URLs and flags | only the `--user-data-dir` value is read and never logged or sent; the wire carries a table key | `identify` test with a long command line; wire fixture shows only the key |
| Injection | an exe path or dir name flows into a frame or a path | only table keys are emitted; the dir is compared, never opened or run | `profiles.rs` hostile-name test |
| Denial of service | an unreadable `/proc` entry or a vanished parent | any read error gives `None`, the host starts | `identify` test with a missing pid |

Data: nothing stored. Checklist: OWASP ASVS 5.1 (input validation).

## Declined

- Brands from the extension (decision 1): not decisive for Brave and
  same-vendor channels, and older extensions send none.
- Marking the browser in each manifest (decision 1): leaves existing
  installs blind.
- Requiring `browser` on every hello (decision 2): breaks an older host.
- Windows, and a macOS-proven parent read, stay out: macOS reads the binary
  through `proc_pidpath` and is a person's check.

## What the tests hold

`identify` over a table of (exe, user data dir, roots) cases, including
two browsers with one exe and different dirs, hostile names and no
information; hello frames with and without `browser` (`frames.json`
fixture, both directions); the native host stamping the browser it was
given; `host_for` and `list_profiles` with two hosts that both answer
`Default`; a hello with no browser still matching by dir; the settings frame
listing profiles of two browsers with ids; the page's options and labels;
`bind_default` with a prefixed id.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: the rough cut, matching by browser (needs you: try it)

- [ ] Tests first: `identify` cases in `host/src/profiles.rs`, a
  hello-with-and-without-`browser` case in `host/tests/fixtures/frames.json`
  and `host/tests/wire.rs`, the native host stamping `browser`
  (`host/tests/relay.rs`), and `host_for` with two same-dir hosts
  (`host/tests/browsers_mcp.rs`), all failing.
- [ ] `Hello.browser` and `HelloInfo.browser`; `cargo test` regenerates
  `extension/src/wire.gen.ts`; `hello()` in `extension/src/background.ts`
  still typechecks.
- [ ] `identify` and the parent reader (expected in `host/src/profiles.rs`),
  `HostOptions.browser` filled from them in `from_env`, stamped on every
  hello the host sends (decision 1).
- [ ] `host_for`, `bind`, the reconnect wait, `call`'s single-host fallback
  and `do_list_profiles` match by dir and browser (expected in
  `host/src/mcp.rs`), per decision 2.
- [ ] Check: `make check`.
- [ ] You try it: with Chrome and Brave both running and a profile named
  `Default` in each, run `list_profiles`: each shows connected once with no
  "two extensions" warning, and `select_profile` `brave:Default` then a
  `navigate` lands in Brave. Say what felt off; it goes into the phases
  below.

### Phase 2: the settings page lists every browser's profiles

- [ ] Tests first: a `settings` frame lists profiles of two browsers with
  ids and browser names (`host/tests/relay.rs`); the page offers the ids,
  labels the browser only when ids are prefixed, and keeps a stored bare
  dir selected (`extension/test/settings.test.ts`, `options` page tests).
- [ ] `ProfileRef.id` and `.browser`; `HostOptions` holds `roots`;
  `Conf::read` uses `read_all` (expected in `host/src/native_host.rs`,
  `host/src/wire.rs`), per decision 3.
- [ ] `renderSessions` in `extension/src/options/page.ts` uses `id`, falling
  back to `dir` from an older host.
- [ ] Check: `make check`.

### Phase 3: the proof, and the docs

- [ ] A proof `scripts/prove/browser-identity.sh`: two Chrome for Testing
  instances on `<home>/.config/microsoft-edge` and
  `<home>/.config/BraveSoftware/Brave-Browser` under a temp `HOME`, a
  `Default` profile in each, both claimed; prints PASS when `list_profiles`
  shows each connected once and stops showing one after its browser is
  killed.
- [ ] `docs/protocol.md` (the `hello` line, the compatibility matrix and the
  `settings` profiles), `docs/testing.md` (the proof row, what needs a
  person), `README.md` and the book where they name this gap.
- [ ] Check: `make check`, then `sh scripts/prove/browser-identity.sh`
  prints PASS.

### Phase 4: the walk (needs you with two browsers)

- [ ] On Linux with Chrome and Brave, and again on macOS: the Phase 1 try-it
  and the settings page's default-profile list showing both browsers'
  profiles. Written under `## Verified` with the date.
- [ ] Check: `make check`.

### Phase 5: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to
  date) with a Conventional Commit title for the whole change, a body
  naming this plan, what changed and why, and the checks run with their
  result. The PR's URL printed as the evidence. Opened, never merged.

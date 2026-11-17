# every Chrome profile is offered browser-hand with one Enable click, and no profile needs Load unpacked

## The ask

"Stop needing Load unpacked in every Chrome profile." Asked 21/10/2026, on
top of `docs/research/07-install-extension.md` (20/10/2026), which found no
silent route for an unpacked extension on branded Chrome without admin
rights, and recommends: publish to the Chrome Web Store as unlisted; have
`browser-hand install` write the per-user External Extensions file so every
profile gets one "Enable extension" prompt; have `select_profile` open the
store page in a profile that has no extension; offer, not require, a
configuration profile with `ExtensionInstallForcelist`; keep Load unpacked
for development.

What it means in this tree: `host/src/install.rs` writes only the native
host manifest, with one origin (`EXTENSION_ID` in `host/src/mcp.rs`,
`ednpkicgdjiiihmophoifehfeeoabjdc`, fixed by the manifest `key`).
`Server::claim` opens `chrome-extension://<id>/claim.html` in the profile
and, after the wait, says "Load unpacked: extension/dist". The same
instruction is in `scripts/build.sh`, `README.md`,
`host/src/instructions.md` and `plugin/skills/browser-hand/SKILL.md`.

## Constraints

- Keep the extension ID if possible (the manifest `key`).
- The developer account, the fee, the upload and the clicks in Chrome are
  the person's; Claude cannot do them.
- The managed (policy) path is documented and opt-in, never the default.
- The unpacked flow keeps working for development.

## Alternatives

Searched 20/10/2026 and 21/10/2026; the searches and sources are listed in
`docs/research/07-install-extension.md` § Searches, plus "Chrome Web Store
upload key.pem keep extension ID key field not allowed manifest" and
"macOS mobileconfig ExtensionInstallForcelist com.google.Chrome" on
21/10/2026 (`docs/external/chrome-extension-distribution.md`). Publishing
has one approach and no table: the first item is made in the developer
dashboard by the person, because the listing, privacy and visibility fields
are set there; the Chrome Web Store API for later updates is a follow-up.

### Decision 1: the extension's ID (one-way door)

The store will not take a `key` field in the uploaded manifest, and no
`.pem` for `ednpkicg...` is in the repository or its history. Whoever made
the key may still hold it.

Searched 21/10/2026: "Chrome Web Store upload key.pem in zip keep extension
ID first upload key field not allowed manifest"; the `key` manifest page,
a GWT commit note, a Microsoft Q&A on the Edge store.

| Must | `key.pem` in the first upload keeps `ednpkicg...` | New store ID, dev ID kept, both allowed | New store ID, dev `key` moved to it |
| --- | --- | --- | --- |
| Works without the old private key | no (needs the `.pem`) | yes | yes |
| **Survives** | only if the person has the `.pem` | **yes** | **yes** |

| Criterion | Weight | `key.pem` keeps the ID | Both IDs allowed | Dev key moved to the store's |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency | 35 | 5 | 4 | 5 |
| Compatibility (profiles with the unpacked build keep working) | 35 | 5 | 5 | 2 |
| Reliability (no two copies on in one profile) | 30 | 5 | 3 | 5 |
| **Weighted total** | **100** | **5.00** | **4.05** | **3.95** |

- Both IDs, efficiency 4: the claim page URL needs the right ID per profile
  (Decision 3), one directory check.
- Dev key moved, compatibility 2: every profile with the unpacked build gets
  a new ID, so the old host manifest refuses it until rebuilt and reloaded.
- Both IDs, reliability 3: a store copy and an unpacked copy can both be on
  in one profile (`docs/external/chrome-extension-distribution.md`
  § Gotchas).

Sensitivity: "both IDs" beats "dev key moved" by 0.10; it flips if
compatibility weighs under 31, which it does not while profiles run the
unpacked build today.
Risk: two copies in one profile; `list_profiles` warns (Phase 4).

**Chosen: `key.pem` in the first upload when the person has it; otherwise a
new store ID beside `ednpkicg...`, both in `allowed_origins`.** Revisit if
the store assigns a new ID even with `key.pem`.

### Decision 2: how each profile gets the extension (one-way door)

Searched 20/10/2026: the routes in `docs/research/07-install-extension.md`
§ Summary. Musts: works on Chrome 142 and later stable (removes
`--load-extension`), no admin rights by default (removes the forcelist as
default), no tampering with Chrome's integrity checks (removes
`Preferences` edits), the person's own profiles (removes CDP and Chrome for
Testing).

| Criterion | Weight | External Extensions file, store link as fallback | Store link only | Load unpacked (baseline) |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency (clicks per profile) | 40 | 5 | 4 | 2 |
| Reliability | 30 | 4 | 4 | 2 |
| Security | 30 | 4 | 4 | 3 |
| **Weighted total** | **100** | **4.40** | **4.00** | **2.30** |

- File, efficiency 5: one Enable click per profile after a Chrome restart;
  store link 4: two clicks; unpacked 2: Developer mode, the folder picker.
- Unpacked, reliability 2: disabled whenever Developer mode goes off;
  security 3: leaves Developer mode on in every profile.

Sensitivity: the file wins on every weight that keeps efficiency first.
Risk: the prompt shows at most 3 times; the store link covers a dismissed
one.

**Chosen: `browser-hand install` writes
`External Extensions/<store id>.json`; `select_profile` opens the store
page where the extension is missing.** Revisit if the prompt does not show
in a second profile (Phase 1).

### Decision 3: which ID the claim page uses (two-way door)

Only under Decision 1's "both IDs".

Searched 21/10/2026: "chrome profile Extensions folder webstore install
unpacked not copied"; Chromium `extension_service.cc` read in the research.

| Criterion | Weight | Store ID if `<profile>/Extensions/<store id>/` exists, else dev ID | Read `Secure Preferences` | Open both claim URLs |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 3 | 3 |
| Reliability | 35 | 4 | 3 | 3 |
| Security | 25 | 5 | 4 | 5 |
| **Weighted total** | **100** | **4.65** | **3.25** | **3.50** |

- Directory, reliability 4: store and external installs unpack into the
  profile's `Extensions/<id>/<version>`; unpacked ones do not. A removed
  extension's folder can linger until Chrome cleans it up.
- `Secure Preferences`: an undocumented, HMAC-guarded file holding more of
  the person's settings than needed.
- Both URLs: a profile without one ID shows an error tab.

Sensitivity: holds under any weights. Risk: a lingering folder; the claim
falls back to the other ID once before giving up.

**Chosen: the directory check, falling back to the other ID.** Revisit if a
store install is seen without the folder.

### Decision 4: the next step for a profile with no extension (two-way door)

Searched 21/10/2026: "open chrome web store detail page in specific profile
command line"; `docs/external/chrome-profiles-and-launch.md`.

| Criterion | Weight | `select_profile` opens the store page there | Text only |
| --- | ---: | ---: | ---: |
| Performance efficiency (clicks) | 40 | 5 | 3 |
| Security (tabs opened unasked) | 30 | 4 | 5 |
| Reliability | 30 | 4 | 4 |
| **Weighted total** | **100** | **4.40** | **3.90** |

**Chosen: `select_profile` opens the store page in that profile and says
what to click; `list_profiles`, read-only, returns the step as text.** With
no store ID built in, both name the Load unpacked steps. Revisit if people
find the extra tab unwelcome.

### Decision 5: the managed path (two-way door)

Searched 21/10/2026: "macOS mobileconfig ExtensionInstallForcelist
com.google.Chrome configuration profile example"; Addigy, CultureAI,
anzenna templates. Musts: not default, never installed by browser-hand.

| Criterion | Weight | `browser-hand install --mobileconfig <path>` writes it | A template in the docs, ID filled by hand |
| --- | ---: | ---: | ---: |
| Performance efficiency (right ID, no edits) | 40 | 5 | 3 |
| Reliability (valid plist, unique UUIDs) | 35 | 5 | 3 |
| Security | 25 | 4 | 5 |
| **Weighted total** | **100** | **4.75** | **3.50** |

**Chosen: the flag writes the file and prints how to approve it; README
says what it costs (a managed browser, admin password).** Revisit if nobody
uses it.

## The decision

The person publishes browser-hand unlisted (Phase 2), keeping
`ednpkicg...` with `key.pem` if they have it, else adding the store ID (1).
`browser-hand install` writes the External Extensions file beside the host
manifest, and `--uninstall` removes both (2). The claim page uses the store
ID where the profile has it installed, else the dev ID (3). With no
extension answering, `select_profile` opens the store page in that profile;
`list_profiles` returns a `nextStep` (4). `--mobileconfig <path>` writes an
opt-in forcelist profile (5). `--no-store` skips the file for development;
Load unpacked keeps working with the manifest `key`.

New dependencies: none (`uuid` and `serde_json` are in `host/Cargo.toml`
already; the plist is written as text). New permissions: none in the
manifest. New files outside the repository: the External Extensions file;
the `.mobileconfig` only where the person asks. Network: Chrome fetches
from `clients2.google.com` and `chromewebstore.google.com`; browser-hand
makes no request. The store listing needs a privacy disclosure and a reason
for each permission (`docs/store-listing.md`).

Standards: `docs/standards.md` (types, vitest, cargo test, build, through
`npm --prefix extension test && cargo test --manifest-path host/Cargo.toml
&& sh scripts/build.sh`).

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| External Extensions file, Chrome Web Store, forcelist policy | `docs/external/chrome-extension-distribution.md` | `scripts/prove/external-extensions.sh` | none |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/external-extensions.sh` | new | 1 | the proof | expected |
| `scripts/package.sh`, `docs/store-listing.md` | new | 2 | store zip, listing text | expected |
| `host/src/mcp.rs` | edit | 3, 4 | `STORE_EXTENSION_ID`, claim ID, `nextStep` | expected |
| `host/src/install.rs` | edit | 3, 5, 6 | the file, flags | reuse |
| `host/src/main.rs` | edit | 5, 6 | `--no-store`, `--mobileconfig` | expected |
| `host/tests/install.rs`, `host/tests/mcp.rs` | edit | 3-6 | tests | expected |
| `scripts/build.sh`, `README.md`, `host/src/instructions.md`, `plugin/skills/browser-hand/SKILL.md` | edit | 3, 4, 6 | the new steps | expected |

*Reused, not rewritten:*

- `host/src/install.rs` `write_manifest`, `main`: the External Extensions
  file is written and removed beside the host manifest, same error style.
- `host/src/profiles.rs` `chrome_dir`: both files sit under it.
- `host/src/mcp.rs` `open_in_chrome` (the `Launcher`): opens the store page
  in a profile as it opens the claim page.
- `host/src/mcp.rs` `Server::claim`: gains the ID choice and the next step,
  no second claim path.
- Searched for an existing plist writer or store packaging script: none.

## Contract

- File: `<chrome_dir>/External Extensions/<store id>.json`, exactly
  `{"external_update_url": "https://clients2.google.com/service/update2/crx"}`.
- CLI: `browser-hand install [--uninstall] [--no-store] [--mobileconfig <path>]`.
- `list_profiles`: each profile gains `nextStep` (string, only when not
  connected); a profile with both builds gains `warning`.
- Host manifest `allowed_origins`: the dev ID, plus the store ID when it
  differs.

## Edge cases

- No store ID built in yet: install writes no file and says so; next steps
  name Load unpacked.
- Chrome running during install: the file takes effect on the next start;
  install says to quit and reopen Chrome.
- The person removed the extension in a profile: the file no longer offers
  it there; `select_profile` opens the store page.
- Developer mode off with the unpacked build: it is disabled; the next step
  names the store page.
- Both builds on in one profile: `list_profiles` warns to turn one off.
- `--uninstall` with no file: "Nothing to remove", as for the host manifest.

## Security

Entry points: `browser-hand install` (the person, at a shell), the
`select_profile` and `list_profiles` tools (Claude), the files written
under `~/Library`.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Tampering | the file points Chrome at another source | ID and URL are constants; no argument sets them | `host/tests/install.rs` |
| Elevation of privilege | Claude installs an extension of its choosing | the store URL is built from the constant ID only | `host/tests/mcp.rs` |
| Tampering | a profile dir with odd characters reaches `open` | passed as one argument, never through a shell (as today) | `host/tests/mcp.rs` |
| Spoofing | another extension talks to the host | `allowed_origins` lists only our IDs | `host/tests/install.rs` |
| Elevation of privilege | the forcelist profile installed silently | only written to a path the person names; macOS asks an admin to approve | `host/tests/install.rs` |

Data: none new. Secrets: the old `key.pem`, if found, stays outside the
repository, never committed or printed; `scripts/package.sh` takes its path
from the person. Logged: nothing. Checklist: OWASP Top 10 for LLM
Applications 2025 (LLM06 excessive agency).

## Rollback

`browser-hand install --uninstall` removes the host manifest and the file;
the person removes the extension in each profile. An older build ignores
the file. The store item can be unpublished from the dashboard.

## Open decisions

- Whether the person has the `.pem` for `ednpkicg...`: default, no; a new
  store ID.
- The listing's name, description and icon: default, the manifest's, and
  the stand-in app icon from plan 06.
- A privacy policy URL, if the dashboard asks for one: default, a section
  in `README.md` on GitHub.

## Risks

- Review refuses `debugger` with `<all_urls>`: `docs/store-listing.md`
  justifies each; the unpacked flow stays until it passes.
- The prompt shows only in the profile opened first: the store page
  fallback covers the rest.

## Declined

`--load-extension` (ignored from Chrome 142), `Preferences` edits
(integrity bypass), CDP and Chrome for Testing (not the person's profiles),
UI scripting (fragile, privacy grants) (2); the forcelist as default (needs
admin) (2); the store link only (two clicks) (2); moving the dev key to the
store's (breaks today's profiles) (1); reading `Secure Preferences`, both
claim URLs (3); text only (4); a hand-filled template (5).

## What the tests hold

`host/tests/install.rs`: the file's path and exact body, `--uninstall`
removes it, `--no-store` skips it, `allowed_origins` lists both IDs, the
`.mobileconfig` passes `plutil -lint` with unique UUIDs. `host/tests/mcp.rs`:
the claim ID per profile, the store URL opened on a timeout, `nextStep` and
`warning`. Chrome itself is the proof and the walk.

## Follow-ups

- Publishing updates with the Chrome Web Store API from a script.
- The "started debugging" bar stays for store installs; only the forcelist
  hides it.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove the External Extensions file (needs you at Chrome)

- [ ] `scripts/prove/external-extensions.sh <store id>` writes
  `External Extensions/<id>.json` for a public store extension not yet in
  any profile (it refuses one whose `Extensions/<id>/` exists), per
  `docs/external/chrome-extension-distribution.md`, asks the person to quit
  and reopen Chrome, open two profiles and say what each shows, removes the
  file on exit, and prints `PASS` when both offered the Enable prompt.
- [ ] Check: it prints `PASS`; what the prompt looked like, and whether the
  second profile showed it too, go into
  `docs/research/07-install-extension.md` § Open questions.

### Phase 2: publish unlisted (needs you: the developer account and the upload)

- [x] `scripts/package.sh` builds `extension/dist`, copies it without the
  manifest `key`, adds `key.pem` from a path the person gives (never read
  or printed by Claude), and zips it to `dist/browser-hand-<version>.zip`.
- [x] `docs/store-listing.md` holds the description, a reason for every
  permission and host access, and the privacy answers.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes, and the zip's
  `manifest.json` has no `key`.
  Landed 21/10/2026: 191 extension and 99 host tests pass, `build.sh` ran
  and reloaded both profiles; `dist/browser-hand-0.1.0.zip` holds 22 files
  and its `manifest.json` has no `key`. Also written:
  `scripts/prove/external-extensions.sh` for Phase 1. The listing notes
  that the store needs a public privacy policy page, and the repository is
  private.
- [ ] You: look for the `.pem` of `ednpkicg...`; make the developer
  account and pay the fee; upload the zip; set visibility Unlisted; fill
  the listing from `docs/store-listing.md`; submit; then say the ID the
  dashboard shows. Review takes days to weeks; Phase 3's code lands
  meanwhile.

### Phase 3: the rough cut (needs you: try it)

- [ ] `STORE_EXTENSION_ID` holds the dashboard's ID (expected in
  `host/src/mcp.rs`), and the host manifest allows it beside `EXTENSION_ID`
  when they differ, pinned by `host/tests/install.rs`.
  Code landed: `STORE_EXTENSION_ID` is `None` in `host/src/mcp.rs`; set it
  to the dashboard's ID once Phase 2's last step is done.
- [ ] `browser-hand install` writes `External Extensions/<store id>.json`
  as Contract says and prints "quit and reopen Chrome, then click Enable in
  each profile"; `--uninstall` removes it (expected in
  `host/src/install.rs`), pinned by `host/tests/install.rs`.
  Code and tests landed (`install::run`, tested with an injected ID); stays
  open until `STORE_EXTENSION_ID` is set, because until then the binary
  writes no file.
- [x] `scripts/build.sh` and `README.md` give the store route first and Load
  unpacked as the development route.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.
- [ ] You try it, once the item is approved: run `sh scripts/build.sh`, quit
  and reopen Chrome, click Enable in one profile, ask Claude to use it. Say
  whether the prompt and the steps read right.

### Phase 4: the next step for a profile without it

- [x] The claim page uses the store ID where
  `<profile>/Extensions/<store id>/` exists, else the dev ID, trying the
  other once on a timeout (expected in `Server::claim`), pinned by
  `host/tests/mcp.rs`.
- [x] On a timeout `select_profile` opens
  `https://chromewebstore.google.com/detail/<store id>` in that profile and
  says to ask the person to click Add to Chrome, or, when installed but
  silent, to turn it on in `chrome://extensions`; `list_profiles` returns
  the same step as `nextStep` and a `warning` for both builds in one
  profile, pinned by `host/tests/mcp.rs`.
- [x] `host/src/instructions.md` and `plugin/skills/browser-hand/SKILL.md`
  say to relay `nextStep` and stop, pinned by `host/tests/instructions.rs`.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.

### Phase 5: the development flow

- [x] `browser-hand install --no-store` writes only the host manifest, and
  with no store ID built in install writes no file and says so (expected in
  `host/src/install.rs`, `host/src/main.rs`), pinned by
  `host/tests/install.rs`.
- [x] `README.md` § development says to keep one build on per profile and
  that Developer mode off disables the unpacked one.
- [ ] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes, and Load unpacked still
  connects with `ednpkicg...`.
  Tests and `build.sh` pass (run with `BROWSER_HAND_CHROME_DIR` pointing at
  a temp dir); still open: Load unpacked connecting in a real Chrome.

### Phase 6: the managed path, opt-in

- [x] (the `plutil -lint` test skips off macOS and was not run here; the
  profile is checked by tag balance and unique UUIDs)
  `browser-hand install --mobileconfig <path>` writes a configuration
  profile with `ExtensionInstallForcelist` =
  `<store id>;https://clients2.google.com/service/update2/crx` under
  `PayloadType` `com.google.Chrome`, fresh UUIDs, and prints how to approve
  it in System Settings (expected in `host/src/install.rs`), pinned by
  `host/tests/install.rs` with `plutil -lint`.
- [x] `README.md` says what it costs: an admin password, a browser shown as
  managed, no Enable click and no "started debugging" bar.
- [x] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.

### Phase 7: the walk (needs you at Chrome)

- [ ] In two profiles without the extension: install, restart Chrome,
  Enable in one, dismiss in the other, then have Claude select each; the
  second gets the store page. A `## Verified` section here records the
  date and what each showed.
- [ ] Check: `npm --prefix extension test && cargo test --manifest-path
  host/Cargo.toml && sh scripts/build.sh` passes.

### Phase 8: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

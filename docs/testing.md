# Testing browser-hand

What to run to know a change works, what each check proves, and what it
cannot. Checked on Linux with Chrome for Testing 157.0.8103.78 on
2026-11-17, unless a line says "not run". `docs/standards.md` lists the
tools and versions each check needs.

Marks: **headless** runs with no person and no window; **person** needs
someone at a real Chrome.

## Safety rules

- Never point a test at a real Chrome profile (`~/.config/google-chrome`,
  `~/Library/Application Support/Google/Chrome`). Use a throwaway
  `--user-data-dir`.
- Run `scripts/build.sh` only with `BROWSER_HAND_CHROME_DIR=<temp dir>`: it
  runs `browser-hand install` and `reload`, which write into Chrome's
  directory. Prefer `make build`, which does not install.
- Build into the repo's `host/target` (`CARGO_TARGET_DIR=$PWD/host/target`,
  gitignored). Add files to git by name, never `git add -A` in a worktree.
- Set `XDG_CONFIG_HOME` to a temp dir when a host runs: the native host reads
  and writes `config.toml` under `~/.config/browser-hand/`.
- Kill every Chrome and host you start. `sh scripts/prove/cft.sh stop <dir>`
  does it for a dir it started.

## Unit and gate suites (headless)

| Check | Command | Passing | Proves | Cannot prove |
| --- | --- | --- | --- | --- |
| Extension tests | `npm --prefix extension test` | `Tests  296 passed (296)` (the count grows) | extension logic in jsdom | anything that needs real Chrome: the debugger, input, the service worker's life, native messaging |
| Host tests | `cargo test --manifest-path host/Cargo.toml` | every `test result: ok.` line, no `FAILED` | wire frames, tools, args, install, docs reference; also rewrites `extension/src/wire.gen.ts` | a real Chrome on the other end |
| Everything | `make check` | exits 0 (lint, coverage floors, build, security, docs) | the whole gate CI runs | not run here; needs `cargo-llvm-cov`, `osv-scanner`, `gitleaks`, `mdbook`, `lychee` |
| Coverage floors | `make coverage` | host lines at or over 90 %, extension lines at or over 90 % | the floors in `docs/standards.md` | not run here |

## Proof scripts

`scripts/prove/*.sh` prove that an outside piece behaves as documented. Most
were written for a person doing "Load unpacked" in Chrome on macOS: they call
`open -na "Google Chrome"` and write to `~/Library`. They do not run as they
stand on Linux or headless. The "How headless" column says what was run
instead; the scripts' own checks (the Python block at the end of each) were
run unchanged on the reports those runs produced.

### Cargo proofs (headless, run as written)

| Script | Command | Passing line | Proves | Cannot prove |
| --- | --- | --- | --- | --- |
| `config-toml.sh` | `sh scripts/prove/config-toml.sh` | `PASS: toml 1.1.8 round-trips the Contract's file and reports line and column` | the toml crate reads and writes `config.toml` | settings behaviour in the host |
| `gif-encode.sh` | `sh scripts/prove/gif-encode.sh` | `PASS: gif 0.14.2 wrote a GIF89a file of N bytes` | the gif crate encodes frames | the host's recording |
| `rmcp-stdio.sh` | `sh scripts/prove/rmcp-stdio.sh` | `PASS: rmcp 3.5.1 stdio server listed a tool and returned text plus image/png` | rmcp serves an image result over stdio | Claude Code's own handshake |

`gif-encode.sh` used `mktemp -t prove-gif`, which GNU `mktemp` refuses; it now
uses `mktemp -t prove-gif.XXXXXX`.

### Chrome proofs

The first five below were run headless with `scripts/prove/cft.sh` or the same
flags (see "Headless method"). In every case the extension's own page or
service worker did the work; the driver only did what a person's hands do.

| Script | Claim | Passing line | How headless | Cannot prove headless | Person? |
| --- | --- | --- | --- | --- | --- |
| `chrome-bridge.sh` | an extension reaches a native host in each profile; a claim URL lands in the profile it names | `PASS: native port reached and 2 profiles claimed by launch URL` | two launches on one user data dir with `--profile-directory=Default` and `Profile 3`; the claim page opened over DevTools `Target.createTarget`; echo host and manifest in `<dir>/NativeMessagingHosts/`. The native port and the per-profile claim held (`hello` carried `profileDir:null` in each fresh profile, then `claimed` carried the dir and nonce). | **Launch-URL routing is not proved.** A `chrome-extension://` URL on the command line opened an error page (`chrome-error://chromewebdata/`), probably because the extension loads after the first navigation; a second headless launch on the same dir aborts on `SingletonLock`, so `open` cannot forward a URL to a running Chrome. | person, for the launch URL |
| `cdp-input.sh` | CDP input arrives as trusted events; text arrives; select-all selects | `PASS: CDP input is trusted and cmd+a selects on macOS` | opened `run.html` of the proof extension; the proof does its own `chrome.debugger` work and reports to the echo host. All 19 events `isTrusted: true`, value `abc`, selection 0 to 3, `navigator.webdriver` false. | The proof's `Meta+A` plus `commands:["selectAll"]` also selected on Linux, so the PASS line's "on macOS" is not shown: the `commands` field does the work, not the Meta key. | person, for macOS |
| `record-capture.sh` | a toolbar button fires `onClicked` and takes a badge; capture-phase listeners see a person's click and typing, and a debugger click, with ARIA names and `isTrusted` | `PASS: the toolbar button records trusted steps with ARIA names; UserFlow in .../flow.json` | the toolbar click was simulated with `chrome.action.onClicked.dispatch(tab)` from the worker (the event object has a `dispatch` method); the person's click and typing were CDP `Input.dispatch*` from the driver. | A real toolbar click and a real OS-level person's input. The "person" source is a label the proof sets, so CDP input stands in for it. | person, for the real button |
| `site-rules.sh` | `options_ui` with `open_in_tab` opens in a tab; a tab-scoped `declarativeNetRequest` session rule blocks link, `tabs.update` and iframe in tab A only | `PASS: options open in a tab, and a tab-scoped session rule blocks link, tabs.update and iframe in tab A only` | the Start button clicked over CDP; tab A errors were `net::ERR_BLOCKED_BY_CLIENT`, tab B loaded all three. | nothing found | no |
| `action-popup.sh` | `setPopup("")` lets a click reach `onClicked`; the value holds across a worker stop, a tab load and a new window; `setPopup("popup.html")` brings the popup back | `PASS: a global setPopup switch holds across a worker stop, a tab load and a new window` | the popup page opened as a tab (its `windows.getCurrent()` named a window); its button clicked over CDP; `onClicked` simulated with `dispatch` only when `getPopup()` read `""`; the worker stopped by leaving it idle about 35 s with no DevTools attached, then woken with a `runtime.sendMessage`; the new window via `Target.createTarget` with `newWindow`. On wake `getPopup()` read `""`. | A real toolbar click, and that a popup opens over a window (a tab is not a popup). The script's "global popup value was lost" note fired falsely: my wake-up page counted as a popup opened at `clicks == 1`. | person, for the real click |
| `linux-open.sh` | on Linux the host's launcher runs the browser binary with `--user-data-dir` and `--profile-directory`, the profile is created, and `select_profile` reaches the extension | `PASS: the Linux launcher started a browser on a throwaway profile and select_profile reached its extension` | `CFT_CHROME=<binary> sh scripts/prove/linux-open.sh` (needs a host build and `extension/dist`); a stand-in `BROWSER_HAND_BROWSER_BIN` adds the headless flags and keeps the `chrome-extension://` claim URL aside, and the script opens it over `Target.createTarget`. Ran 2026-11-17 on CfT 157.0.8103.78. | Launch-URL routing into a running real Chrome, packaged (snap, flatpak) browsers, and a desktop session. | person, for a real Chrome |
| `external-extensions.sh` | one External Extensions file offers a store extension in every profile | `PASS` after two `y` answers | **not run.** It writes into the real Chrome dir, needs the Chrome Web Store, a restart and a person reading the prompt. | everything | person |

### Built extension smoke (headless)

Not a script in the repo; this is the sequence that was run for
`plans/13-chrome-parity.md`, with `cft.sh` and a small DevTools and MCP
driver kept outside the repo.

1. Build: `CARGO_BUILD_JOBS=4 CARGO_TARGET_DIR=$PWD/host/target cargo build --release --manifest-path host/Cargo.toml`, then `npm --prefix extension ci && npm --prefix extension run build`.
2. Install the host manifest into the throwaway dir:
   `BROWSER_HAND_CHROME_DIR=<dir> host/target/release/browser-hand install --no-store`
   (writes `<dir>/NativeMessagingHosts/dev.browserhand.host.json`).
3. Start Chrome with `extension/dist` and these environment variables:
   `BROWSER_HAND_CHROME_DIR=<dir>`, `BROWSER_HAND_SOCKET_DIR=<short dir>`,
   `XDG_CONFIG_HOME=<temp dir>`. Chrome's host child and the MCP server must
   see the same values.
4. Run `browser-hand mcp` with the same environment and talk JSON-RPC on its
   stdio (`initialize`, `notifications/initialized`, `tools/call`).
5. `select_profile {"profile":"Default"}` runs the launcher: `open -na ...` on macOS, the browser binary on Linux (`BROWSER_HAND_BROWSER_BIN` overrides the search; with `BROWSER_HAND_CHROME_DIR` set it also passes `--user-data-dir`). `scripts/prove/linux-open.sh` does this with a stand-in binary. To step in by hand instead,
   put a stand-in first on `PATH` that opens the
   last argument (the claim URL) in the test Chrome with `Target.createTarget`.

Results: `select_profile` returned `{"extensionVersion":"0.1.0","selected":{"dir":"Default",...}}`;
`navigate`, `read_page`, `computer` left_click, type and screenshot worked
(the page showed `hello` and `clicked`); the page's DOM held one closed
shadow root (the cursor overlay, plan 13 decision 4) and the screenshot did
not show it; `read_network_requests` listed
`GET .../api/items?access_token=REDACTED&page=2`, `urlPattern: "SECRET123"`
matched nothing and `urlPattern: "access_token=REDACTED"` matched it (plan 13
decision 1).

Cannot prove headless: the overlay's animation and look on a real screen,
`select_profile` as written on macOS (`open`), and a real multi-profile
Chrome.

Traps found:

- `BROWSER_HAND_SOCKET_DIR` must be short: the host failed with
  `path must be shorter than SUN_LEN` under a deep temp path, and Chrome only
  reported `Native host has exited.`. Use something like `/tmp/bhs-x`.
- `BROWSER_HAND_CHROME_DIR` works on Linux as the user data dir (host
  manifest at `<dir>/NativeMessagingHosts/`, profiles read from
  `<dir>/Local State`). Without it the host looks under `~/Library/...`.
- `list_profiles` errors with `Local State has no profile.info_cache` for the
  first seconds of a fresh dir; wait for Chrome to write it.

## Headless method (Chrome for Testing)

Branded Chrome (157 was reported) blocks `--load-extension`; Chrome for
Testing accepts it.

- Download (pattern, **not run here**: 157.0.8103.78 was already unpacked):
  `https://storage.googleapis.com/chrome-for-testing-public/<version>/linux64/chrome-linux64.zip`,
  versions listed at
  `https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json`.
  Unzip into its own empty directory; the binary is
  `chrome-linux64/chrome`.
- Flags used: `--headless=new --no-sandbox --user-data-dir=<throwaway>
  --profile-directory=<Default|Profile 3> --remote-debugging-port=<port>
  --load-extension=<dir> --no-first-run --no-default-browser-check`.
- Native messaging hosts: on Linux Chrome reads
  `<user-data-dir>/NativeMessagingHosts/<name>.json` (verified; the echo and
  real hosts were found there). Each manifest's `allowed_origins` is the ID
  computed from the extension's `key`.
- Helper: `CFT_CHROME=<binary> sh scripts/prove/cft.sh start <dir> <port> <extension-dir> [profile] [url]`
  waits for the DevTools port; `sh scripts/prove/cft.sh stop <dir>` kills it
  and its children. It refuses `~/.config`, `google-chrome`, `chromium` and
  `Google/Chrome` paths.
- Driving: DevTools over `http://127.0.0.1:<port>/json` and the browser
  WebSocket. `Target.createTarget` opens a URL with a `#fragment`
  (`PUT /json/new` through curl drops it). `Input.dispatchMouseEvent` and
  `Input.dispatchKeyEvent` give trusted events. Node 22's global `WebSocket`
  is enough; no packages.
- Extension service workers show up as `service_worker` targets while awake and
  vanish after about 30 s idle (a worker with a DevTools client attached is
  presumed to stay awake; not checked). `ServiceWorker.stopWorker` is not on the browser connection.
- Run one launch at a time per user data dir: a second launch on the same
  dir aborts on `SingletonLock`.
- Cleanup: `cft.sh stop`, then check `pgrep -af chrome-linux64` and
  `pgrep -af browser-hand`; remove the throwaway dirs and any short socket
  dir.

## Browsers the host knows

`host/src/profiles.rs` holds a fixed table; `list_profiles`, `select_profile`
and `install` use every browser whose data dir exists.

| Browser | Linux data dir (under `~/.config/`) | macOS data dir (under `~/Library/Application Support/`) | Linux binaries tried, in order |
| --- | --- | --- | --- |
| Google Chrome (`chrome`) | `google-chrome` | `Google/Chrome` | `google-chrome-stable`, `google-chrome`, `chromium` |
| Chromium (`chromium`) | `chromium` | `Chromium` | `chromium`, `chromium-browser` |
| Microsoft Edge (`edge`) | `microsoft-edge` | `Microsoft Edge` | `microsoft-edge-stable`, `microsoft-edge` |
| Brave (`brave`) | `BraveSoftware/Brave-Browser` | `BraveSoftware/Brave-Browser` | `brave-browser`, `brave-browser-stable`, `brave` |
| Vivaldi (`vivaldi`) | `vivaldi` | `Vivaldi` | `vivaldi-stable`, `vivaldi` |

`BROWSER_HAND_CHROME_DIR` narrows everything to one browser's dir (tests).
Unit tests cover the table per OS under a fake `HOME`, the merged list and
the `<browser>:<dir>` ids (`host/tests/profiles.rs`, `host/tests/browsers_mcp.rs`),
the launcher per OS with stand-in binaries (`host/tests/launcher.rs`) and
the manifest per browser (`host/tests/install_browsers.rs`). Not run
headless: a real Brave, Edge, Chromium or Vivaldi.

## Manual checklist (a person)

Only a person can check these. Tick them on a real profile before a release.

- [ ] `sh scripts/build.sh` on a spare machine or with `BROWSER_HAND_CHROME_DIR` set, then Load unpacked `extension/dist` in a real profile: the toolbar button opens its popup, Alt+Shift+R records.
- [ ] `select_profile` opens the right profile with the real `open -na "Google Chrome"` on macOS, with two profiles loaded.
- [ ] On Linux with Chrome (and again with one other Chromium browser): `sh scripts/build.sh`, `list_profiles`, then `select_profile` opens the right profile and a page loads in it (plans/14 Phase 1 and 5).
- [ ] The agent cursor is visible while Claude clicks and looks right (colour, glide, fades after 4 s).
- [ ] A real toolbar click with the popup off reaches the recorder (`chrome-bridge`, `record-capture` and `action-popup` simulated it).
- [ ] Web Store route: `scripts/prove/external-extensions.sh <store id>` with a public extension no profile has; each profile offers it after a restart. Only once a store ID is built in.
- [ ] The docs book (`sh scripts/check-docs.sh`, then open `docs/book/out/`) and the site (`sh scripts/check-site.sh`, then open `site/`) read right and look right in light and dark.
- [ ] Settings page in a real profile: change a setting, see it in a second profile.

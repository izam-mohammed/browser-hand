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
| Extension tests | `npm --prefix extension test` | `Tests  300 passed (300)` (the count grows) | extension logic in jsdom | anything that needs real Chrome: the debugger, input, the service worker's life, native messaging |
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
| `wait-for.sh` | `wait_for` returns when text, a vanishing or a URL part shows, through a page load, and times out naming the reason | `PASS: wait_for returned on the text, the vanishing and the URL, and timed out with the reason` | `CFT_CHROME=<binary> sh scripts/prove/wait-for.sh` (needs a host build and `extension/dist`; shared setup in `scripts/prove/headless.mjs`). A throwaway profile with the built extension, a host and an MCP client in one node process, and a local web server for the pages. Ran 2026-11-20 on CfT 158.0.8127.36. | Branded Chrome, a desktop session and a person's real input. | no |
| `allow-list.sh` | with `sites.allowed` set, the tool gate refuses an unlisted site, the network rule stops an iframe to it, and a tab outside the group still loads it | `PASS: the allow list refused an unlisted site in the tool gate and the network, and left the person's own tab alone` | `CFT_CHROME=<binary> sh scripts/prove/allow-list.sh` (needs a host build and `extension/dist`; shared setup in `scripts/prove/headless.mjs`). `localhost` is listed and `127.0.0.1` is not; the server counts requests by Host header. Ran 2026-11-20 on CfT 158.0.8127.36. | Branded Chrome, a desktop session and a person's real input. | no |
| `audit-log.sh` | every call writes one audit line with no URL path, query, typed text or value, and the file is `0600` | `PASS: every call wrote one audit line, with no URL path, query or typed text` | `CFT_CHROME=<binary> sh scripts/prove/audit-log.sh` (needs a host build and `extension/dist`; shared setup in `scripts/prove/headless.mjs`). The audit file is read back from the throwaway dir. Ran 2026-11-20 on CfT 158.0.8127.36. | Branded Chrome, a desktop session and a person's real input. | no |
| `replay-cli.sh` | `browser-hand replay` runs a stored recording with no model, prints each step and leaves the page as recorded; a bad `--from` stops it with status 1 | `PASS: browser-hand replay ran a recording with no model, printed each step and left the page as recorded` | `CFT_CHROME=<binary> sh scripts/prove/replay-cli.sh` (needs a host build and `extension/dist`; shared setup in `scripts/prove/headless.mjs`). A seeded recording, and one made by the real recorder (its toggle command, then trusted CDP clicks and typing), are replayed by the CLI as a second process. The proof's own web server must not be blocked: use an async spawn, never `spawnSync`, in a proof that serves pages from the same process. Ran 2026-11-20 on CfT 158.0.8127.36. | Branded Chrome, a desktop session and a person's real input. | no |
| `browser-identity.sh` | two browsers that both hold a profile `Default` are told apart: each host's `hello` carries its own browser and `list_profiles` counts each host for its own profile only | `PASS: two browsers with a Default profile were told apart by the host's own hello, and one quitting left the other connected` | `CFT_CHROME=<binary> sh scripts/prove/browser-identity.sh` (needs a host build and `extension/dist`). Two Chrome for Testing instances run on `<home>/.config/microsoft-edge` and `<home>/.config/BraveSoftware/Brave-Browser` under a throwaway `HOME`; one binary, so the host's `--user-data-dir` rule is what tells them apart. Ran 2026-11-17 on CfT 157.0.8103.78. Chrome rewrites its process title, so `/proc/<pid>/cmdline` is one space-joined string, not NUL-separated words; the host parses for that. | The binary-name rule on a real Brave, Edge, Chromium or Vivaldi, snap or flatpak parents, and macOS (`proc_pidpath`). | person, for a second real browser |
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

| Browser | Linux data dir (under `~/.config/`) | macOS data dir (under `~/Library/Application Support/`) | Windows data dir (under `%LOCALAPPDATA%\`) and registry key (under `HKCU\Software\`) | Linux binaries tried, in order |
| --- | --- | --- | --- | --- |
| Google Chrome (`chrome`) | `google-chrome` | `Google/Chrome` | `Google\Chrome\User Data`, `Google\Chrome` | `google-chrome-stable`, `google-chrome`, `chromium` |
| Chromium (`chromium`) | `chromium` | `Chromium` | `Chromium\User Data`, `Chromium` (by pattern) | `chromium`, `chromium-browser` |
| Microsoft Edge (`edge`) | `microsoft-edge` | `Microsoft Edge` | `Microsoft\Edge\User Data`, `Microsoft\Edge` | `microsoft-edge-stable`, `microsoft-edge` |
| Brave (`brave`) | `BraveSoftware/Brave-Browser` | `BraveSoftware/Brave-Browser` | `BraveSoftware\Brave-Browser\User Data`, `BraveSoftware\Brave-Browser` | `brave-browser`, `brave-browser-stable`, `brave` |
| Vivaldi (`vivaldi`) | `vivaldi` | `Vivaldi` | `Vivaldi\User Data`, `Vivaldi` (third-party source) | `vivaldi-stable`, `vivaldi` |

Each host also says which browser it runs in (`hello.browser`): the
`--user-data-dir` of its parent process compared with each installed
browser's dir, else the binary's name against the table's `exe_names`
(`profiles::identify`). Matching counts a host for a profile only when its
browser is absent or the profile's (`docs/protocol.md`).

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
- [ ] With Chrome and Brave both running and a profile named `Default` in each (Linux, then macOS): `list_profiles` shows `chrome:Default` and `brave:Default` each connected once with no "two extensions" warning, `select_profile` `brave:Default` then `navigate` lands in Brave, and the settings page's default profile lists both browsers' profiles (plans/15 Phase 4).
- [ ] The agent cursor is visible while Claude clicks and looks right (colour, glide, fades after 4 s).
- [ ] A real toolbar click with the popup off reaches the recorder (`chrome-bridge`, `record-capture` and `action-popup` simulated it).
- [ ] Web Store route: `scripts/prove/external-extensions.sh <store id>` with a public extension no profile has; each profile offers it after a restart. Only once a store ID is built in.
- [ ] The docs book (`sh scripts/check-docs.sh`, then open `docs/book/out/`) and the site (`sh scripts/check-site.sh`, then open `site/`) read right and look right in light and dark.
- [ ] Settings page in a real profile: change a setting, see it in a second profile.

## Windows (a person at a Windows 10 or 11 PC; plans/16)

Nothing below has run: the host was only compiled for
`x86_64-pc-windows-gnu` (`make windows`: Clippy, `-D warnings`, all targets,
2026-11-17). What Linux does hold: the registry key names and `reg` command
lines, pipe names and scopes, install folders, `\\?\` stripping, the SDDL
string, Windows config and GIF folder paths, `.exe` identity
(`host/tests/winos.rs`, `install_windows.rs`, `paths_windows.rs`,
`launcher_windows.rs`), and the `ipc` module on Unix (`ipc.rs`). Run from a
checkout in PowerShell with `cargo test --manifest-path host\Cargo.toml`
(`pipe_windows.rs` runs only there; the Unix test files are `cfg(unix)`).

- [ ] `cargo test --manifest-path host\Cargo.toml` passes, `pipe_windows.rs` included.
- [ ] `host\target\release\browser-hand.exe install --no-store` prints `Registered HKCU\Software\...` for each installed browser, and `reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\dev.browserhand.host"` shows a default value that names an existing manifest whose `path` has no `\\?\` prefix.
- [ ] The same for Edge and Brave, and for Chromium and Vivaldi if installed: confirm or correct the two keys written by pattern (Chromium `HKCU\Software\Chromium`, Vivaldi `HKCU\Software\Vivaldi`) in `docs/external/windows.md` and `docs/standards.md`.
- [ ] With the extension loaded unpacked, Chrome starts the host: a `\\.\pipe\browser-hand-bh-<pid>` appears (`Get-ChildItem \\.\pipe\ | Where Name -like 'browser-hand*'`) and `list_profiles` shows the profile connected.
- [ ] A second Windows user (or `runas`) cannot open that pipe: `[IO.Pipes.NamedPipeClientStream]::new('.', 'browser-hand-bh-<pid>').Connect(1000)` as the other user is refused (access denied).
- [ ] `select_profile` starts a closed browser and hands off to a running one (the lockfile test says which); a profile named `Profile 1` and a URL with `&` arrive intact; `BROWSER_HAND_BROWSER_BIN` overrides the exe.
- [ ] Chrome and Edge both running with a `Default` profile each: `list_profiles` counts each once (the parent exe's identity, `chrome.exe` / `msedge.exe`).
- [ ] `navigate`, `read_page`, a click, typing, a screenshot, `gif_creator` export into `%USERPROFILE%\Downloads\browser-hand`, and a recording's list show a correct local time.
- [ ] `file_upload` refuses `.env`, `KEY.PEM`, a file under `.ssh`, a hard link (`fsutil hardlink create`) and `a.txt:s` (a data stream), and takes an ordinary file.
- [ ] The settings page saves; `%LOCALAPPDATA%\browser-hand\config.toml` appears and a second profile follows within 2 s; a GIF folder of `C:\Users\<you>\Videos` and `~\gifs` are accepted.
- [ ] `browser-hand.exe install --uninstall` removes the manifest and each key; running it again says `Nothing to remove`.
- [ ] Killing a host with Task Manager leaves no pipe behind and the MCP server's `list_profiles` stops showing it.
- [ ] With two Claude Code sessions, both reach the same host through its pipe and `reload` reaches every profile.

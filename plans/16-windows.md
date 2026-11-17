# browser-hand installs and runs on Windows, in Chrome, Edge, Brave, Chromium and Vivaldi

## The ask

Windows is the one parity gap with Claude in Chrome left after
`plans/14-chrome-parity-2.md`, which declined it as "large, own plan later"
(its Alternatives row: "Windows (named pipes, registry host manifest) ... no
... own plan later"). `README.md` still says "Windows is not supported".
Built so far: `docs/built/BUILT-2026-11-14-2216.md` (plans 13 to 15 landed
since).

Read from the code, the host is Unix in six places: `UnixListener` and
`UnixStream` for the host/MCP socket (`native_host.rs`, `host_conn.rs`,
`reload.rs`), `std::os::unix` permission calls (`paths.rs`, `config.rs`,
`mcp.rs`, `native_host.rs`), `libc::localtime_r` (`tools/recording.rs`),
`$HOME` as the only home (`profiles.rs`, `config.rs`, `mcp.rs`), the
hard-link check behind `#[cfg(unix)]` (`tools/files.rs`) and
`parent_id` from `std::os::unix` (`native_host.rs`). `install.rs` writes a
manifest file Chrome reads from a folder, which Windows does not do.
`cargo check --target x86_64-pc-windows-gnu` (17/11/2026) compiled every
dependency and failed with 14 errors, all in those six places.

Nothing here can be run on Windows by the builder: no Windows machine was
available. Every step that needs one is a person's check, listed in
`docs/testing.md`, never ticked by the builder.

## Alternatives

### Decision 1: the host to MCP transport on Windows (one-way door: it is the on-machine wire)

Today a Unix socket per host in a `0700` dir. The wire frames
(`docs/protocol.md`) do not change.

Searched 17/11/2026: "tokio named pipe server multiple clients", "Windows
AF_UNIX tokio", "interprocess crate named pipe", Claude Code's Windows notes.
Found: `tokio::net::windows::named_pipe` ships in tokio (feature `net`, on
here already); one server instance serves one client, so accepting is
`connect().await` then creating the next instance. tokio has no Unix socket
type on Windows. Claude Code itself uses named pipes on Windows
(`docs/external/windows.md`).

| Must | Baseline: Unix socket | tokio named pipes | Localhost TCP | `interprocess` crate |
| --- | --- | --- | --- | --- |
| Runs on Windows | no | yes | yes | yes |
| Only this user can connect | n/a | yes, with an explicit DACL | no (any local user, any process) | yes, with a DACL |
| Per-host endpoint found without a registry | n/a | yes (`\\.\pipe\` lists) | no (port file needed) | yes |
| **Survives** | no | **yes** | no | **yes** |

| Criterion | Weight | tokio named pipes | `interprocess` |
| --- | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 4 |
| Reliability | 40 | 4 | 4 |
| Dependency surface | 20 | 5 | 3 |
| **Weighted total** | **100** | **4.60** | **3.80** |

- Efficiency: pipes are in-kernel byte streams like Unix sockets, no TCP
  stack. tokio's pipe is a direct wrapper, `interprocess` adds a layer
  (4, from its README: "Windows only using named pipe based local sockets").
- Reliability 4 for both: unproven here; tokio's pipe is CI-tested on
  Windows by tokio.
- Dependency surface: tokio is already a dependency; `interprocess` is new.

Sensitivity: a Unix-socket path on Windows would win only if tokio gained
`UnixStream` there; it has not. Risk: a pipe left by a crashed host; none
stays, a pipe dies with its process.

**Chosen: tokio named pipes behind a small `ipc` module** (`Listener`,
`connect`, an `Accept` trait the relay takes), so Unix keeps `UnixListener`
and tests do not change.

### Decision 2: who may connect to the pipe (one-way door)

Searched 17/11/2026: Microsoft "Named Pipe Security and Access Rights",
tokio `ServerOptions` docs. Found: with a NULL descriptor the default DACL
grants "read access to members of the Everyone group and the anonymous
account", so any local user could read tool results the host sends.
`reject_remote_clients` is on by default and `first_pipe_instance(true)`
stops a second server on the same name.

| Must | Default DACL | DACL for this user's SID only | Logon SID only |
| --- | --- | --- | --- |
| Another local user cannot read | no | yes | yes |
| Works from Claude Code and Chrome (same user, may be different sessions) | yes | yes | no (a different logon session cannot connect) |
| **Survives** | no | **yes** | no |

Scored alone: efficiency 5 (set once at create, no per-call cost),
reliability 4 (SDDL string built from the token's user SID; an elevated
process still has the same user SID).

**Chosen: `D:P(A;;GA;;;<user SID>)` through `create_with_security_attributes_raw`,
`first_pipe_instance(true)`, remote clients rejected.** The MCP side also
checks the server's owner (decision 2b below). Revisit if a Windows walk
shows Chrome and Claude Code under different SIDs.

Decision 2b (two-way door): a pipe name is guessable (`<pid>`), so another
user could create `browser-hand-...-<pid>` first. The client, after
connecting, asks `GetNamedPipeServerProcessId`, opens that process's token and
refuses a server whose user SID is not its own. Costs one handle query per
connect, none per call.

### Decision 3: how the host manifest is registered (one-way door)

Windows does not read a manifest folder: Chrome wants a registry key whose
default value is the manifest path, one key per browser
(`docs/external/windows.md`).

Searched 17/11/2026: Chrome and Edge native messaging docs, Claude Code's
Chrome page, `winreg` and `windows-sys` registry APIs, `reg.exe` options.

| Must | `reg.exe` by absolute path | `windows-sys` Reg* calls | `winreg` crate | Manifest folder only |
| --- | --- | --- | --- | --- |
| Writes HKCU default value | yes | yes | yes | no (Chrome ignores it) |
| Command line testable on Linux | yes | no | no | n/a |
| **Survives** | **yes** | yes | yes | no |

| Criterion | Weight | `reg.exe` | `windows-sys` | `winreg` |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency | 40 | 4 | 5 | 4 |
| Reliability | 40 | 4 | 3 | 3 |
| Dependency surface | 20 | 5 | 4 | 2 |
| **Weighted total** | **100** | **4.20** | **4.00** | **3.20** |

- `reg.exe` efficiency 4: one process spawn per browser, once at install;
  `windows-sys` 5: none.
- Reliability: the `reg` arguments are built by a pure function tested on
  Linux (`reg add KEY /ve /t REG_SZ /d PATH /f`), exit status only is read
  (its messages are localised); the API calls would be unsafe and untestable
  here. Run by `%SystemRoot%\System32\reg.exe`, never through `cmd` or a
  PATH lookup, so a path with spaces or `&` is one argument and a planted
  `reg.exe` is not run.
- `windows-sys` is already in the tree for decisions 2, 4 and 6; `winreg` is
  new.

Sensitivity: `windows-sys` wins if `reg.exe` proves unreliable in the walk
(AppLocker, a stripped image). Risk: `reg.exe` blocked by policy; the
install prints the exact key and value to set by hand.

**Chosen: `reg.exe` by absolute path.** Keys, per browser, under
`HKCU\Software\`: Chrome `Google\Chrome`, Chromium `Chromium`, Edge
`Microsoft\Edge`, Brave `BraveSoftware\Brave-Browser`, Vivaldi `Vivaldi`
(then `\NativeMessagingHosts\dev.browserhand.host`). Brave and Edge are in
the vendors' docs, Chrome in Google's; Chromium and Vivaldi are by pattern
and a third-party wiki, so they are the first things the walk checks. The
manifest file itself is still written at `<user data dir>\NativeMessagingHosts\`
(`install::write_manifest`, unchanged), and the key points at it.

### Decision 4: which browser is the parent on Windows (two-way door)

`profiles::parent_identity` reads `/proc` or `proc_pidpath`.

Searched 17/11/2026: ToolHelp32 `PROCESSENTRY32W.th32ParentProcessID`,
`NtQueryInformationProcess`, PowerShell `Get-CimInstance`, `wmic`. Found: Microsoft's
`wmic` page says Windows 11 24H2 and 25H2 no longer include `wmic.exe`
(August 2026); PowerShell costs a second-scale start on every host launch.

| Must | ToolHelp snapshot | `NtQueryInformationProcess` | PowerShell | Dir only (as plan 15 fallback) |
| --- | --- | --- | --- | --- |
| Documented, stable API | yes | no (internal struct) | yes | yes |
| No process spawn per host start | yes | yes | no | yes |
| Names the browser | yes (exe path) | yes | yes | no |
| **Survives** | **yes** | no | no | no |

Scored alone: efficiency 5 (one snapshot, parent pid found, image path read
with `QueryFullProcessImageNameW`), reliability 3 (a reused parent pid would
name the wrong process; Chrome is alive while its host runs).
`--user-data-dir` is not read on Windows (it needs the parent's PEB), so two
browser builds sharing one exe and different dirs match by dir only, as
before plan 15.

**Chosen: ToolHelp for the parent pid, `QueryFullProcessImageNameW` for its
exe, then `identify` as today** (a `.exe` suffix stripped, backslashes
accepted).

### Decision 5: the launcher on Windows (two-way door)

Searched 17/11/2026: Chrome launch flags docs already in
`docs/external/chrome-profiles-and-launch.md`; install locations.

| Must | Run the exe from known folders | `cmd /c start chrome ...` | Registry App Paths |
| --- | --- | --- | --- |
| Passes `--profile-directory` and the URL as separate args | yes | no (`start` re-parses quotes; `&` in a URL breaks it) | yes |
| Needs no shell | yes | no | yes (but one `reg query` more) |
| **Survives** | **yes** | no | yes |

Scored alone against App Paths: efficiency 5 against 4 (no `reg query`),
reliability 4 against 4. Folders tried, in order, per browser:
`%ProgramFiles%`, `%ProgramFiles(x86)%`, `%LOCALAPPDATA%`, each plus
`<Vendor>\<Product>\Application\<exe>` (`chrome.exe`, `msedge.exe`,
`brave.exe`, `vivaldi.exe`); `BROWSER_HAND_BROWSER_BIN` overrides.
"Started or handed off" is read from the browser's `lockfile`: opening it
for write fails with a sharing violation while the browser runs
(Chromium `process_singleton_win.cc`, `docs/external/windows.md`).

**Chosen: spawn the exe directly with the same flags as Linux.**

## The decision

Decisions 1 to 5. New dependency: `windows-sys` 0.61 as a
`[target.'cfg(windows)'.dependencies]` entry, features for `ToolHelp`,
`Threading`, `Security`, `Security_Authorization`, `Storage_FileSystem`,
`Time`, `Pipes`; it is already in `Cargo.lock` at 0.61.2 through tokio, so no
new code enters the tree and nothing changes off Windows. No new permission,
network host or secret. The Windows registry, named pipes and `reg.exe` are
documented in `docs/external/windows.md`; with no Windows machine to run a
proof script on, the walk (Phase 5) is their proof. New files on the user's disk: the registry values
named in decision 3, removed by `install --uninstall`.

Pure and tested on Linux, in one module compiled everywhere (`host/src/winos.rs`):
data dirs from `%LOCALAPPDATA%`, registry key and `reg` argument lists, pipe
names and the filter for a listing, `.exe` candidates from the three
folders, `\\?\` stripping for `current_exe().canonicalize()` (Chrome cannot
start a `\\?\` path), a millisecond-to-calendar conversion, `config.toml`'s
path. Only thin calls sit behind `cfg(windows)` (`host/src/winsys.rs`).

Other Windows behaviour fixed by this plan: the config lives in
`%LOCALAPPDATA%\browser-hand\config.toml`; the GIF folder default stays
`~/Downloads/browser-hand` and `~` expands to `%USERPROFILE%`, both slashes
accepted; `--mobileconfig` says it is macOS only; the stdio framing needs
no change because Rust's `stdin` and `stdout` do no `\n` translation on a
pipe (the `O_BINARY` rule in Chrome's docs is a C runtime rule); Chrome's
`--parent-window=<handle>` argument follows the origin and is ignored, as
the `chrome-extension://` first argument alone selects the host mode.

Standards: `docs/standards.md` (fmt, Clippy, tsc, Biome, vitest, cargo test
with the ts-rs export, 90 % floors, docs reference, book), through
`make check`. New: `make windows` runs `cargo check` and `clippy` for
`x86_64-pc-windows-gnu` when that target is installed.

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `host/src/winos.rs` | new | 1 | pure Windows logic, tested on Linux | expected |
| `host/src/winsys.rs` | new | 1, 2, 3 | `cfg(windows)` calls: ToolHelp, SID, DACL, link count, time | expected |
| `host/src/ipc.rs` | new | 1 | `Listener`, `connect`, `Accept`, endpoint listing | expected |
| `host/src/profiles.rs` | edit | 1, 2 | `Os::Windows`, `win_dir`, `.exe` in `identify`, `parent_identity` | reuse |
| `host/src/paths.rs` | edit | 1 | pipe scope, `home_dir`, `config_path` | reuse |
| `host/src/install.rs` | edit | 1 | registry step beside `write_manifest` | reuse |
| `host/src/mcp.rs` | edit | 1 | Windows launcher, `find_on_path` | reuse |
| `host/src/native_host.rs`, `host/src/host_conn.rs`, `host/src/reload.rs` | edit | 1 | `ipc` instead of Unix types | reuse |
| `host/src/config.rs`, `host/src/tools/files.rs`, `host/src/tools/recording.rs` | edit | 2 | mode, link count, local time | reuse |
| `host/Cargo.toml`, `Makefile` | edit | 1 | `windows-sys`, `make windows` | fixed |
| `docs/testing.md`, `docs/standards.md`, `README.md`, book | edit | 4 | support line, manual checklist | reuse |

*Reused, not rewritten:* `profiles::BROWSERS` (gains Windows names),
`install::write_manifest`, `wire::read_frame` (generic over any reader),
`profiles::discover` (calls `ipc` for listing), `tools::files::credential_rule`.
Searched for an existing Windows path, `cfg(windows)`, `named_pipe` and
registry code: none.

## Contract

No wire change: `protocol` stays 1. New on disk and in the registry only:
`HKCU\Software\<vendor key>\NativeMessagingHosts\dev.browserhand.host`
(default value: the manifest path, backslashes, no `\\?\`); pipe name
`\\.\pipe\browser-hand-<scope>-<pid>` where `<scope>` is `bh` or, when
`BROWSER_HAND_SOCKET_DIR` is set (tests), a sanitised form of it.

## Edge cases

- `current_exe().canonicalize()` returns `\\?\C:\...`: stripped before it
  enters the manifest.
- A manifest path with spaces, `&` or non-ASCII: one `reg` argument, JSON
  escapes the backslashes.
- Two browsers: one key each; uninstall deletes the key it wrote, and a key
  that is already gone is "nothing to remove", read by `reg query` status.
- `HKCU` write blocked by policy: the error prints the key and value.
- A user whose `%LOCALAPPDATA%` is redirected: read from the environment, no
  `home\AppData\Local` guess; unset means the browser list is empty.
- A pipe that is busy (all instances taken): the client retries a few
  times, 50 ms apart, on `ERROR_PIPE_BUSY`.
- Another user's pipes answer "access denied" and are skipped by discovery.
- Upload names are case-insensitive on NTFS: `.ENV`, `.SSH`, `KEY.PEM` are
  refused (`credential_rule` already lowercases). An alternate data stream
  (`secret.pem:x`) and a path with a `:` after the drive are refused.
- Hard links: refused by link count from `GetFileInformationByHandle`;
  junctions and symlinks resolve through `canonicalize` first.
- `~\Downloads\browser-hand` and `~/Downloads/browser-hand` both expand.
- The host's parent is not the browser (a `.bat` wrapper): no `browser` is
  stamped; matching falls back to the dir, as plan 15.

## Security

Entry points: the pipe (any local process may try to open it), the registry
write at install, the browser exe the launcher runs, the files `file_upload`
reads.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | another local user reads tool results from the pipe (default DACL gives Everyone read) | DACL for the user's SID only; remote clients rejected | pure test of the SDDL string; walk: a second user cannot open the pipe |
| Spoofing | another user creates `browser-hand-bh-<pid>` first and receives calls | host: `first_pipe_instance(true)`; client: refuses a server not owned by its SID | test that the owner check refuses a different SID string; walk |
| Elevation | a planted `reg.exe` or `chrome.exe` on PATH is run | `reg.exe` run by its `%SystemRoot%\System32` path; the browser found in the three install folders, `PATH` not searched on Windows | `winos` tests of the paths built from env values |
| Injection | a profile dir or URL reaches a shell | no shell: `Command` args only, never `cmd /c` | launcher argument test (`start` not used) |
| Tampering | the manifest is rewritten to run another exe | manifest sits in the user's own data dir; install writes only that and the key | existing manifest tests; the key's default value built from the manifest path only |
| Information disclosure | a hard link or NTFS stream hides a credential file | link count and `:` refusal, case-insensitive names | `files` tests: `.ENV`, `x.pem:s`; link count on Windows by walk |
| Denial of service | many pipe probes, one hung host | probes time out as on Unix (`PROBE_WAIT`) | existing `discover` tests |

Data: the registry value and the manifest hold paths only. Logged: nothing
new; a pipe name carries a pid. Checklist: OWASP ASVS 5.1 and the
Microsoft named pipe security guidance.

## Declined

- Localhost TCP (decision 1): any local process connects.
- The `interprocess` and `winreg` crates (decisions 1, 3): new dependencies
  for what tokio and `reg.exe` already do.
- Reading `--user-data-dir` from the parent on Windows (decision 4): needs
  the PEB; revisit if a walk finds two browsers sharing one exe.
- An MSI, winget, Scoop or a signed installer: a release plan, not this one;
  `browser-hand install` is the Windows install for now.
- `HKLM` (all users) registration: needs admin; per-user only. The store ID
  is still `None`, so Windows installs unpacked, as Linux.

## What the tests hold

On Linux: data dirs for every browser from a fake `LOCALAPPDATA`; registry
key names and `reg` argument lists for install, query and delete; pipe name,
scope sanitising and the listing filter; `.exe` candidates from three
folders and `BROWSER_HAND_BROWSER_BIN`; `\\?\` stripping; `identify` with
backslash paths and `chrome.exe`; the millisecond conversion; the SDDL
string; Windows `config_path`; the case-insensitive credential and stream
rules. Unix behaviour: every existing test, unchanged, plus the relay,
reload and `host_conn` tests through `ipc`. For Windows: `cargo check` and
`clippy` for `x86_64-pc-windows-gnu`; test files that use `std::os::unix`
are `#![cfg(unix)]`; one `#![cfg(windows)]` pipe round trip test runs on a
Windows machine only.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: the rough cut, the host runs and installs on Windows (needs you: try it)

- [x] Tests first, failing: the `winos` cases named above and `ipc` on Unix
  (`host/tests/winos.rs`, `host/tests/ipc.rs`), plus `Os::Windows` rows in
  `host/tests/profiles.rs`.
- [x] `windows-sys` as a target dependency; `Os::Windows` and the data dirs
  in `profiles.rs`; the pure module `host/src/winos.rs`.
- [x] `ipc`: `Listener`, `connect`, `Accept`, endpoint listing; `native_host`,
  `host_conn` and `reload` use it; Unix behaviour unchanged (decision 1).
- [x] The pipe on Windows: owner-only DACL, first instance, busy retry,
  server-owner check on connect (decisions 2 and 2b, expected in
  `host/src/winsys.rs`).
- [x] `install`: the registry step and its uninstall, `\\?\` stripped,
  `--mobileconfig` refused on Windows (decision 3).
- [x] The Windows launcher and `find_on_path` (decision 5); the `unix`
  permission calls and test files gated so the crate compiles for
  `x86_64-pc-windows-gnu`.
  Landed 2026-11-17: also `host/tests/install_windows.rs`,
  `launcher_windows.rs` and `paths_windows.rs`; the Windows launcher runs a
  stand-in exe on Linux in `launcher_windows.rs`.
- [x] Check: `make check`, then `make windows` shows no error or warning.
- [ ] You try it, on Windows 10 or 11 with Chrome: build with
  `cargo build --release`, run `browser-hand install --no-store`, load
  `extension/dist` unpacked, then `claude mcp add` the exe with `mcp` and ask
  Claude for `list_profiles`. Say what felt off; it goes into the phases
  below.

### Phase 2: the rest of the host's behaviour

- [x] Tests first: `local_time` from a fixed millisecond value (pure), the
  Windows `config_path`, `~\` expansion, `.ENV` and `x.pem:s` refusals.
- [x] `home_dir` (`HOME`, else `USERPROFILE`) used by `profiles`, `config` and
  `mcp`; `config::save` without the Unix mode on Windows; the Windows config
  path.
- [x] `local_time` on Windows through the time zone API; hard link count and
  stream refusal in `tools/files.rs`.
- [x] The parent browser: ToolHelp pid, image path, `.exe` and backslashes in
  `identify` (decision 4), replacing `std::os::unix::process::parent_id`.
- [x] Check: `make check`, then `make windows`.

### Phase 3: guard the pipe, and a way to keep it checked

- [x] A `windows` job in `docs/standards.md` and the `Makefile`'s `make windows`
  (`cargo check` and `clippy -D warnings` for `x86_64-pc-windows-gnu`),
  skipped with a message when the target is missing.
  Landed 2026-11-17: no CI job, only the local target (CI runs on a Linux
  self-hosted runner); `make windows` is also the last step of `make lint`.
- [x] The pipe test for Windows (`host/tests/pipe_windows.rs`, `cfg(windows)`):
  the round trip and the owner check (a second user's refusal is a walk).
- [x] Check: `make check`, then `make windows`.

### Phase 4: docs, and the Windows checklist

- [x] `README.md`, `docs/book/src/` and `docs/standards.md` say Windows is
  supported, how to install there, where the config and GIFs go.
  Landed 2026-11-17: `host/src/instructions.md` is unchanged (it is at the
  size limit `host/tests/instructions.rs` holds and still names
  `~/.config/browser-hand/config.toml`); the reference page's settings
  line, `SECURITY.md` and the book's three pages carry the Windows path.
- [x] `docs/testing.md`: a Windows manual checklist, every box unticked, with
  the commands (registry query for each browser, the DACL, two browsers, the
  walk of every tool group); `docs/protocol.md` the pipe name.
- [x] Check: `make check`.

### Phase 5: the walk (needs you at a Windows PC)

- [ ] Each line of the `docs/testing.md` Windows checklist run with Chrome,
  Edge and Brave at least; the Chromium and Vivaldi registry keys confirmed
  or corrected in `docs/external/windows.md`; written under `## Verified`
  with the date.
- [ ] Check: `make check`.

### Phase 6: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to
  date) with a Conventional Commit title for the whole change, a body
  naming this plan, what changed and why, and the checks run with their
  result. The PR's URL printed as the evidence. Opened, never merged.

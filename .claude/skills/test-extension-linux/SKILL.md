---
name: test-extension-linux
description: Test the browser-hand extension and host headless on Linux with Chrome for Testing, no person and no real profile. Use when asked to run, prove, try or tick a plan's "You try it" or "Check:" item, run scripts/prove/*.sh, load the extension in a browser, or screenshot the popup, settings page or cursor overlay on Linux.
---

# Testing browser-hand on Linux

Read `docs/testing.md` (what each check proves) and the "Running Chrome headless
for proofs" topic in `~/.knowledge/personal/browser-hand/knowledge/chrome-for-testing.md`
before acting. This skill is the short path; those hold the evidence.

## Rules

- Branded Chrome (137+) ignores `--load-extension`. Use Chrome for Testing only.
- Never use a real profile. `scripts/prove/cft.sh` refuses `~/.config/google-chrome`, `chromium`, `~/.config`.
- Never run `scripts/build.sh` without `BROWSER_HAND_CHROME_DIR=<temp dir>`; prefer `make build`.
- Set `XDG_CONFIG_HOME=<temp dir>` when a host runs, and a short `BROWSER_HAND_SOCKET_DIR` (`/tmp/bhs-x`; a deep one fails with `path must be shorter than SUN_LEN`).
- Kill by recorded pid, never `pkill -f <pattern>` inside a script that contains the pattern.

## Steps

1. Get the browser: `export CFT_CHROME=$(sh .claude/skills/test-extension-linux/scripts/cft-install.sh)`
2. Build: `npm --prefix extension run build` and `cargo build --release --manifest-path host/Cargo.toml` (output `host/target/release/browser-hand`, `extension/dist`).
3. Run the proof for the plan item (all headless, they call `scripts/prove/cft.sh`):
   - plan 14 launcher: `sh scripts/prove/linux-open.sh`
   - plan 15 identity: `sh scripts/prove/browser-identity.sh`
   - others: `scripts/prove/*.sh`; the table in `docs/testing.md` says which run headless.
   - unit gates: `npm --prefix extension test`, `cargo test --manifest-path host/Cargo.toml`, `make check`.
4. Ad hoc poking: `sh scripts/prove/cft.sh start <tmp udd> <port> extension/dist`, then
   `node .claude/skills/test-extension-linux/scripts/cdp.mjs <port> eval ednpkicgdjiiihmophoifehfeeoabjdc/background '<js>'`,
   `... open chrome-extension://<id>/popup.html`, `... shot popup.html /tmp/popup.png`.
   Stop with `sh scripts/prove/cft.sh stop <tmp udd>`.

CfT ships built-in extensions with their own service workers, so match on browser-hand's id
(`ednpkicgdjiiihmophoifehfeeoabjdc`), never on `service_worker` alone.

## What headless cannot prove

Real toolbar clicks and OS input (simulate with `chrome.action.onClicked.dispatch(tab)`),
the Chrome Web Store prompt, Windows (plan 16), branded Chrome's own Enable prompt, and
whether copy or design looks right. Leave those `You try it` boxes for the person.

## Ticking

Tick a plan box only when its proof printed `PASS` (or the named command exited 0) in this
session. Say which command ran. A proof that needed a stand-in (docs/testing.md lists them)
ticks the check box, not the person's try-it box.

# getting started

Needs Rust 1.88 or newer, Node (to build the extension), a Chromium browser
(Google Chrome, Chromium, Edge, Brave or Vivaldi, on macOS, Linux or Windows) and
Claude Code. About ten minutes, most of it compiling.

## 1. build and register the host

From the repository root:

```sh
sh scripts/build.sh
```

It builds `host/` and `extension/`, copies the binary into
`plugin/server/`, and writes one file outside the repository: the native
messaging manifest, `NativeMessagingHosts/dev.browserhand.host.json`, in the data dir
of each installed browser (macOS Chrome: `~/Library/Application Support/Google/Chrome/`;
Linux Chrome: `~/.config/google-chrome/`).
`plugin/server/browser-hand install --uninstall` removes it.

**Windows.** `scripts/build.sh` does not run there. Build with
`cargo build --release --manifest-path host\Cargo.toml` and
`npm --prefix extension run build`, then run
`host\target\release\browser-hand.exe install --no-store`. It writes the same
manifest in each browser's `%LOCALAPPDATA%\<vendor>\User Data\` folder and
points the browser's `HKCU\Software\<vendor>\NativeMessagingHosts\dev.browserhand.host`
registry key at it. Add the server with
`claude mcp add --scope user browser-hand -- <path>\browser-hand.exe mcp`.
Settings live in `%LOCALAPPDATA%\browser-hand\config.toml`. Windows has been
compiled but not run on a Windows machine yet.

With more than one browser installed, profiles are listed as
`<browser>:<dir>` (`chrome:Default`, `brave:Profile 1`), and a bare `Default`
that two browsers share is refused until you say which. Each browser's
native host knows which browser started it, so a `Default` in Chrome and a
`Default` in Brave are never mixed up, and the settings page's default
profile lists every browser's profiles. On Linux, opening a
profile runs the browser's binary from `PATH` (`google-chrome-stable`,
`google-chrome`, `chromium`, `brave-browser`, `microsoft-edge-stable`,
`vivaldi-stable` and so on); set `BROWSER_HAND_BROWSER_BIN` to a path when
yours is named otherwise. On Windows the browser is started from its install folder under
`%ProgramFiles%`, `%ProgramFiles(x86)%` or `%LOCALAPPDATA%`, and the same variable overrides it.

## 2. load the extension in a profile

Do this in each Chrome profile Claude may use, once:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and pick the `extension/dist` folder.

The extension ID is always `ednpkicgdjiiihmophoifehfeeoabjdc`. After this,
every `sh scripts/build.sh` reloads the extension in each profile that has
it connected (`plugin/server/browser-hand reload` does only that).

## 3. add the plugin

Start Claude Code with the plugin. It brings the server and the
`browser-hand` skill:

```sh
claude --plugin-dir "$PWD/plugin"
```

Or add only the server:

```sh
claude mcp add --scope user browser-hand -- "$PWD/plugin/server/browser-hand" mcp
```

## 4. a first task

Ask Claude something small and harmless:

> list my chrome profiles, then open example.com in the work one and tell
> me what the page says

Claude calls `list_profiles`, then `select_profile`, then opens a tab with
`navigate` and reads it with `get_page_text`. Chrome shows an orange
**browser-hand** tab group: those are Claude's tabs, and it cannot touch
yours.

If the profile was not open, Claude opens it for you. If the extension does
not answer, you skipped step 2 for that profile.

## 5. before the second task

Open the settings page (the extension's toolbar button, then **Settings**)
and add the sites Claude must never touch to the blocked list. Guide:
[blocked and read-only sites](guides/blocked-sites.md). Something not
working: [troubleshooting](guides/troubleshooting.md).

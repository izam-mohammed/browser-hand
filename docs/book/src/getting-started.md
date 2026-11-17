# getting started

Needs Rust 1.88 or newer, Node (to build the extension), Google Chrome and
Claude Code. About ten minutes, most of it compiling.

## 1. build and register the host

From the repository root:

```sh
sh scripts/build.sh
```

It builds `host/` and `extension/`, copies the binary into
`plugin/server/`, and writes one file outside the repository: the native
messaging manifest
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.browserhand.host.json`.
`plugin/server/browser-hand install --uninstall` removes it.

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

# commands

One binary, `browser-hand`, does several jobs. Chrome and Claude Code start
it for you, so `install`, `reload`, `recordings` and `replay` are the ones
you type yourself.

| Command | Who runs it | What it does |
| --- | --- | --- |
| `browser-hand mcp` | Claude Code | The MCP server. Talks to Claude over stdio and finds the native hosts through their sockets. |
| `browser-hand native-host` | Chrome | One per profile that has the extension. Chrome starts it with the extension's origin as its only argument, so no subcommand is needed. |
| `browser-hand install [--uninstall]` | you, or `scripts/build.sh` | Writes the native messaging manifest `dev.browserhand.host.json` into Chrome's `NativeMessagingHosts` folder. `--uninstall` removes it. |
| `browser-hand reload` | you, or `scripts/build.sh` | Reloads the extension in every profile where it is connected. |
| `browser-hand recordings [--profile <name or dir>]` | you | Lists the steps you recorded in a profile, newest first: id, title, time, steps. |
| `browser-hand replay [<id>] [--profile <name or dir>] [--from <step>] [--value <step>=<text>]...` | you | Replays a recording in a new tab of that profile with no Claude involved, printing each step as it runs. The newest recording when no id is given. It moves at your pace setting, obeys your blocked, read-only and allowed sites, and stops at the first step it cannot do (exit status 1). A masked value (a password) needs `--value`. |

Anything else prints the usage line and exits with 2:

```text
usage: browser-hand mcp | native-host | install [--uninstall] [--no-store] [--mobileconfig <path>] | reload | recordings | replay
```

## Environment

| Variable | Effect |
| --- | --- |
| `BROWSER_HAND_PACE` | `fast` or `human`. Overrides the settings page's pace for that server. |
| `BROWSER_HAND_OUTPUT_DIR` | Overrides the GIF folder. |

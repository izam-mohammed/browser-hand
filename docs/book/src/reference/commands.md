# commands

One binary, `browser-hand`, does four jobs. Chrome and Claude Code start
it for you, so `install` and `reload` are the only two you type yourself.

| Command | Who runs it | What it does |
| --- | --- | --- |
| `browser-hand mcp` | Claude Code | The MCP server. Talks to Claude over stdio and finds the native hosts through their sockets. |
| `browser-hand native-host` | Chrome | One per profile that has the extension. Chrome starts it with the extension's origin as its only argument, so no subcommand is needed. |
| `browser-hand install [--uninstall]` | you, or `scripts/build.sh` | Writes the native messaging manifest `dev.browserhand.host.json` into Chrome's `NativeMessagingHosts` folder. `--uninstall` removes it. |
| `browser-hand reload` | you, or `scripts/build.sh` | Reloads the extension in every profile where it is connected. |

Anything else prints the usage line and exits with 2:

```text
usage: browser-hand mcp | native-host | install [--uninstall] | reload
```

## Environment

| Variable | Effect |
| --- | --- |
| `BROWSER_HAND_PACE` | `fast` or `human`. Overrides the settings page's pace for that server. |
| `BROWSER_HAND_OUTPUT_DIR` | Overrides the GIF folder. |

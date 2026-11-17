# browser-hand

browser-hand lets Claude Code drive your own Chrome profiles. It picks a
profile, opens and reads pages, and clicks, types and scrolls the way a
person does, with your logins already in place. It runs on macOS with Google
Chrome.

It comes in three parts, and you need all three:

| Part | What it is | Where it lives |
| --- | --- | --- |
| Native host | A Rust binary, `browser-hand`. It is the MCP server Claude talks to and the native messaging host Chrome starts. | `plugin/server/browser-hand`, built from source |
| Extension | Does the work inside Chrome: reads pages, sends input, records your steps. | Loaded unpacked in each profile Claude may use |
| Plugin | Brings the server and a skill that tells Claude how to use it. | `plugin/`, started with `claude --plugin-dir` |

```text
Claude Code --stdio--> browser-hand mcp --unix socket--> browser-hand (native host) --native port--> extension
```

Chrome starts one native host per profile that has the extension. The MCP
server finds them and talks to the one for the profile Claude selected,
opening that profile if it is not open.

## what to read

- New here: [getting started](getting-started.md), about ten minutes.
- Something to do: the guides, starting with
  [choosing a profile](guides/profiles.md), and the
  [examples](examples.md).
- Something to look up: the [tools](reference/tools.md),
  [commands](reference/commands.md) and [settings](reference/settings.md).
  Those three pages are generated from the code, so they are never older
  than the binary.

## a note on trust

Everything Claude does here happens in your real browser, as you. Block the
sites you would not hand to a stranger before the first task: see
[blocked and read-only sites](guides/blocked-sites.md).

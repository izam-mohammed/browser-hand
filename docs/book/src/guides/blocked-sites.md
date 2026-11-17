# blocked and read-only sites

Two lists on the settings page, under **Site access**:

| List | What Claude can do |
| --- | --- |
| Blocked | Nothing. It never opens or acts on these. |
| Read-only | Read and screenshot. Not click, type, fill forms or run scripts. |

## patterns

A pattern is `host/path`, with `*` for anything and no scheme:

```text
*.bank.example/*
docs.example.com/private/*
localhost/*
```

The host needs a dot, or is `localhost` or `*`. No scheme, port, query or
fragment. Each list holds 200 patterns of 100 characters. The page tells you
when it cannot read one.

## how it is enforced

The extension enforces the lists, so no request from the MCP server gets
past them. Every tool checks the tab's site. Claude's tabs cannot load a
blocked site at all: that is a network rule on Claude's tab groups only,
so your own tabs are untouched.

A tool that answers `blocked` is telling Claude to stop and ask you. The
skill says to never look for a way around it.

## the one gap

Claude is told never to edit `~/.config/browser-hand/config.toml`. Nothing
stops a Bash command that does, so keep that in mind when you let Claude run
shell commands as well.

Changes apply to every open profile within 2 seconds. The page needs the
host: with it not running, the page shows the last values, read-only.

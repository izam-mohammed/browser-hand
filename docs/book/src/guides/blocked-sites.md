# blocked, read-only and allowed sites

Three lists on the settings page, under **Site access**:

| List | What Claude can do |
| --- | --- |
| Blocked | Nothing. It never opens or acts on these. |
| Read-only | Read and screenshot. Not click, type, fill forms or run scripts. |
| Allowed | When the list has anything in it, Claude may open and act on only these sites. Empty means no limit. |

Blocked wins over allowed: a site on both is blocked. Read-only still
applies to a site that is allowed.

## the allowed list

Use it when you would rather name the few sites Claude may touch than the
many it may not. With `docs.google.com/*` and `example.org/*` allowed, a
tool that tries `news.example.com` is refused (`is not on the allowed sites
list`), and a link or an iframe in one of Claude's tabs cannot load it
either. Your own tabs are untouched.

Two things to know. A site that loads others (a sign-in on another host, an
embedded video) needs those hosts in the list too. And pages that are not
sites, like `chrome://` and `about:blank`, are not judged: the list covers
`http`, `https`, `ws` and `wss` only.

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

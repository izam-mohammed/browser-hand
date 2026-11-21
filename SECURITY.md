# Security policy

## Supported versions

browser-hand has no published release yet, so only the latest commit on
`main` gets security fixes. Please pull and rebuild (`sh scripts/build.sh`)
before reporting.

## Reporting a vulnerability

Please do not open a public issue, pull request or discussion for a
security problem. Report it privately with GitHub's
[private vulnerability reporting](https://github.com/izam-mohammed/browser-hand/security/advisories/new)
(the **Security** tab, then **Report a vulnerability**).

Helpful details:

- the commit you built, your macOS and Chrome versions
- what an attacker could do, and what they need first (for example a
  crafted web page, another local user, or a tampered config file)
- the smallest steps that show it
- any fix you have in mind

Please leave out real passwords, cookies and browsing data.

## What happens next

This is a project with one maintainer, so there are no guaranteed response
times. We aim to:

- acknowledge the report
- agree on whether it is a vulnerability and how serious it is
- fix it on `main` and tell you when the fix lands

Please give us a reasonable chance to fix it before you share details.

## Scope

In scope: the native host and MCP server in `host/` (the `browser-hand`
binary, its Unix sockets or Windows named pipes and the native messaging
manifest and registry key it installs),
the Chrome extension in `extension/`, including blocked and read-only site
enforcement and recordings, the Claude Code plugin in `plugin/`, the
settings file it writes (`~/.config/browser-hand/config.toml`), the build
scripts in `scripts/`, and the CI workflow in `.github/workflows/`.

Problems in Chrome, Claude Code or the Rust and npm packages it uses should
go to those projects; tell us too if browser-hand makes them worse.

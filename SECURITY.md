# Security policy

## Supported versions

browser-hand has no published release yet, so only the latest commit on
`main` gets security fixes. Please pull and rebuild (`sh scripts/build.sh`)
before reporting.

## Reporting a vulnerability

This repository is private, so only its collaborators can see it. Please do
not open an issue, pull request or discussion for a security problem.
Report it privately to the owner, [@izam-mohammed](https://github.com/izam-mohammed),
on GitHub.

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
binary, its Unix sockets and the native messaging manifest it installs),
the Chrome extension in `extension/`, including blocked and read-only site
enforcement and recordings, the Claude Code plugin in `plugin/`, the
settings file it writes (`~/.config/browser-hand/config.toml`), the build
scripts in `scripts/`, and the CI workflow in `.github/workflows/`.

Problems in Chrome, Claude Code or the Rust and npm packages it uses should
go to those projects; tell us too if browser-hand makes them worse.

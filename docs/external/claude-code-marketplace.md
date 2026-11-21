# Claude Code plugin marketplace

Pulled 2026-11-20 from web search results (code.claude.com plugin
marketplace pages). Not read end to end: `claude plugin validate` settles it.

- A marketplace is `.claude-plugin/marketplace.json` at a repository root
  with `name`, `owner` and a `plugins` array; each entry has a `name` and a
  `source` (a relative path works only when the marketplace is added through
  Git; a `github` source takes `repo` and an optional `ref`).
- Check it with `claude plugin validate ./`.
- Users add it and install with the form `<plugin>@<marketplace>`; the
  marketplace name comes from the `name` field, and some names are reserved
  for Anthropic.
- A plugin installed this way is a copy of the repository files: the
  gitignored `plugin/server/browser-hand` binary is not in it.

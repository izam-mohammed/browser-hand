# browser-hand: how it is released

Every version is a GitHub release, built by `.github/workflows/release.yml`
when a release plan's PR is merged. Every other channel is published from
that release by its own workflow. Nothing is published by hand.

## Versioning

Semantic versioning, tags `vMAJOR.MINOR.PATCH`. `0.x` until the interface is
declared stable: the MCP tool names and arguments, the `browser-hand`
commands and flags, the `config.toml` keys and the wire format in
`docs/protocol.md`. `1.0.0` is the first version where those only change in
a major. The version lives in `host/Cargo.toml` (the source) and is copied
by hand into `extension/package.json`, `extension/manifest.json` and
`plugin/.claude-plugin/plugin.json`; `scripts/check-version.sh` fails when
the four differ.

## Roadmap

| Version | What a user gets | Chain phase | Plans | New channels | State |
| --- | --- | --- | --- | --- | --- |
| v0.1.0 | The first version anyone can install: Claude drives your Chrome profiles, records and replays, on macOS, Linux and Windows | 18 | `plans/18-release-v0.1.0.md` (everything in plans 01 to 17) | release archives with install scripts, Homebrew tap, Scoop bucket | planned |
| v0.2.0 | Windows checked on a real machine; install the plugin from a Claude Code marketplace | 19 | not written | the marketplace entry | planned |

## Channels

Ranked, recommended first. Decided in `plans/18-release-v0.1.0.md`.

| Rank | Channel | For | Score | Workflow | Install check |
| --- | --- | --- | --- | --- | --- |
| 1 (recommended) | Release archives and install scripts | macOS, Linux, Windows | 4.20 | `release.yml` | `browser-hand --version` |
| 2 | Homebrew tap | macOS, Linux | 3.95 | `publish-homebrew.yml` | `brew install` then `browser-hand --version` |
| 3 | Scoop bucket | Windows | 3.65 | `publish-scoop.yml` | `scoop install` then `browser-hand --version` |
| - | GitHub Releases | everyone, the source | - | `release.yml` | download and `sha256sum -c SHA256SUMS` |

The Chrome extension is not on a store (`plans/07-install-extension.md`,
concluded, not released): every channel ends by telling the person to load
`extension/dist` unpacked, from the release's extension zip.

## Assets

Every release holds: `browser-hand-vX.Y.Z-<target>.tar.gz` (macOS and
Linux) or `.zip` (Windows) for `aarch64-apple-darwin`,
`x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`,
`aarch64-unknown-linux-gnu` and `x86_64-pc-windows-msvc`, each with the
binary and `LICENSE`; `browser-hand-extension-vX.Y.Z.zip` (the built
extension with its manifest `key`, so the ID stays fixed);
`install.sh`; `install.ps1`; `SHA256SUMS`; and a build provenance
attestation for every file.

## Workflows

- `release.yml`: on a push to `main` whose `host/Cargo.toml` version has no
  tag yet (and `workflow_dispatch` for a dry run). Checks the four versions
  agree, builds every asset, writes `SHA256SUMS`, attests them, then tags
  and publishes the release with the notes from `CHANGELOG.md`.
- `publish-homebrew.yml`, `publish-scoop.yml`: on `release: published`
  (and `workflow_dispatch` taking a tag). Download the release's archives,
  verify `SHA256SUMS`, write the formula or manifest, push it to the tap or
  bucket repository, then install from it on a clean runner and check
  `browser-hand --version`. Environment `release`; secret `TAP_GITHUB_TOKEN`
  (by name; scoped to the tap and bucket repositories only).

## Install

The README's `## Install`, in the ranked order above. Each channel's install
check runs the README's own command.

## Decided

- Hand-written matrix workflow over cargo-dist: it must also pack the
  extension zip and check four version files (`plans/18`, decision 1).
- `release.yml` reads `host/Cargo.toml` on a push to `main`: one run, no
  second release PR (`plans/18`, decision 2).
- Archives and install scripts first, then a Homebrew tap and a Scoop bucket;
  winget, cargo-binstall and the marketplace entry declined for `v0.1.0`
  (`plans/18`, decision 3).

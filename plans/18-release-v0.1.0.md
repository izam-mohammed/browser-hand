# v0.1.0 installs with one command on macOS, Linux and Windows

## The ask

"Have a release plan to publish in github." Nothing has been released:
`git tag` is empty, there is no `CHANGELOG.md`, no release workflow, and the
only way in is `sh scripts/build.sh` with Rust and Node installed. The store
route for the extension was concluded, not released (`plans/07`), so the
extension reaches people as a file to load unpacked. This plan lands the
whole pipeline and the version: `docs/releases.md` puts everything in plans
01 to 17 into `v0.1.0`, released to GitHub Releases, with a Homebrew tap and a
Scoop bucket fed from it.

Built so far: `docs/built/BUILT-2026-11-20-1956.md`.

## Constraints

- GitHub-hosted minutes are blocked while the repository is private
  (`.github/workflows/ci.yml`), the self-hosted runner is Linux x64 only, and
  attestations need Enterprise Cloud on a private repository
  (`docs/external/github-releases-attestations.md`). So macOS, Windows and
  arm64 builds, and the attestations, work only once the repository is public.
- Nothing is published by hand and no secret is read by Claude.
- Plan 17 (PR `#59`) lands before `v0.1.0`: the first release holds it.

## Alternatives

### Decision 1: what builds the release assets? (two-way door)

Five targets (macOS arm64 and x64, Linux x64 and arm64, Windows x64), plus
the extension zip, `SHA256SUMS`, attestations and a check that four version
files agree.

Searched 2026-11-20: "cargo-dist vs hand-written GitHub Actions matrix
release Rust binary"; the cargo-dist README and its generated workflow
source.

| Must | cargo-dist | Hand-written matrix |
| --- | --- | --- |
| Builds the five targets | yes | yes |
| Packs the extension zip and the version check | unverified: custom steps only through hooks | yes |
| Runs the repo's SHA-pinned actions | no: the generated workflow is regenerated, hand edits are an error | yes |
| **Survives** | no (two musts unmet or unverified) | **yes** |

| Criterion | Weight | cargo-dist | Hand-written matrix |
| --- | ---: | ---: | ---: |
| Performance efficiency (release run time) | 40 | 4 | 4 |
| Reliability | 30 | 4 | 4 |
| Compatibility with this repo's workflows | 30 | 3 | 5 |
| **Weighted total** | **100** | **3.70** | **4.30** |

- Efficiency 4 both: the same `cargo build --release` runs per target, in
  parallel; no measurement yet, Phase 2's dry run records it.
- Reliability 4 both: cargo-dist is maintained; a matrix of five jobs is
  small and the dry run exercises it.
- Compatibility: the generated file cannot hold the extension zip or the
  version check without hooks, and rewrites SHA-pinned action lines.

Sensitivity: if cargo-dist's `include` and hooks cover the zip and the check,
it ties; the choice holds on the pinned-actions must.
Risk: a hand-written matrix drifts from runner changes; the dry run on every
change to `release.yml` catches it.

**Chosen: hand-written matrix** (`release.yml`). Revisit if a fifth
channel needs cargo-dist's installers.

### Decision 2: how does a merge become a tag? (two-way door)

Searched 2026-11-20: "github actions tag release on version bump vs
release-please"; the GitHub docs on the `release` event.

| Criterion | Weight | `release.yml` reads `host/Cargo.toml` | tag by hand | release-please |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency (runs per release) | 40 | 5 | 5 | 3 |
| Reliability (no forgotten or doubled tag) | 30 | 5 | 3 | 4 |
| Compatibility (the release plan's PR is the bump) | 30 | 5 | 4 | 2 |
| **Weighted total** | **100** | **5.00** | **4.10** | **3.00** |

- release-please efficiency 3: it opens its own release PR, then runs
  again on merging it.
- By hand reliability 3: a tag on the wrong commit is a person's mistake.

**Chosen: `release.yml` reads `host/Cargo.toml`.** One run on the merge, and
the release plan stays the one place a version is decided. Revisit if
changelogs should be generated from commits.

### Decision 3: which installers? (two-way door)

GitHub Releases is the source and is not scored. The person installing is a
Claude Code user on macOS, Linux or Windows; the binary is 9,533,936 bytes
(`plugin/server/browser-hand`, 2026-11-20) and needs no Rust to run.

Searched 2026-11-20: "Homebrew tap formula prebuilt binary GitHub release",
"Scoop bucket manifest autoupdate checkver", "cargo binstall pkg-url
Cargo.toml", "Claude Code plugin marketplace.json"; docs.brew.sh, the Scoop
wiki, the cargo-binstall README, code.claude.com.

| Must | Archives + scripts | Homebrew tap | Scoop bucket | cargo-binstall | winget | Marketplace entry |
| --- | --- | --- | --- | --- | --- | --- |
| Installs the built binary from release assets | yes | yes | yes | yes | yes | no (a plugin copy has no binary) |
| A release reaches users within a day | yes | yes | yes | yes | no (manual review) | yes |
| **Survives** | **yes** | **yes** | **yes** | **yes** | no | no |

| Criterion | Weight | Archives + scripts | Homebrew tap | Scoop bucket | cargo-binstall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Performance efficiency (install time and size) | 30 | 5 | 4 | 4 | 4 |
| Platforms covered | 20 | 5 | 3 | 2 | 5 |
| Updates arrive | 15 | 2 | 5 | 5 | 3 |
| Trust checked on install | 15 | 4 | 4 | 4 | 3 |
| Installer already on the target machine | 10 | 5 | 3 | 2 | 1 |
| Uninstalls cleanly | 10 | 3 | 5 | 5 | 4 |
| **Weighted total** | **100** | **4.20** | **3.95** | **3.65** | **3.60** |

- Efficiency: one 9.5 MB download and no toolchain; the tap and bucket add
  the package manager's own overhead; binstall needs crates.io metadata.
- Platforms: `install.sh` covers macOS and Linux, `install.ps1` Windows; the
  tap has no Windows, the bucket is Windows only.
- Updates: the scripts have no update prompt, `brew upgrade` and `scoop
  update` do.
- Trust: the script and both formulas check `SHA256SUMS`; the script also
  says how to run `gh attestation verify`. binstall verifies less.
- Installer present: a Claude Code user has `curl` or PowerShell; Rust
  users are a minority of them.
- Uninstall: `browser-hand install --uninstall` plus deleting the files for
  the scripts; one command for `brew` and `scoop`.

Sensitivity: drop the installer-present criterion and rescale: archives
4.11, Homebrew 4.06, cargo-binstall 3.89, Scoop 3.83. The top two hold;
binstall would pass the Scoop bucket, and Scoop stays because Windows has
no other package-manager route in this plan.
Risk: an unsigned binary may meet macOS Gatekeeper or Windows SmartScreen
when downloaded in a browser; the scripts and package managers download with
`curl` and PowerShell, which set no quarantine mark, and the README says so.

**Chosen: release archives with install scripts (recommended), then the
Homebrew tap, then the Scoop bucket.** Declined for `v0.1.0`: winget,
cargo-binstall, the marketplace entry. Revisit cargo-binstall and the
marketplace at `v0.2.0` (`## Follow-ups`).

## The decision

Release `v0.1.0` through `release.yml` on the merge of this plan's PR, and
publish to the tap and the bucket from the release (decisions 1 to 3). No
rough cut: the release is the usable thing, and each channel's install check
is its try. The version bump this forces: none beyond `0.1.0`, the version
all four files already hold.

New dependencies and permissions: a GitHub environment `release`; a
fine-grained token `TAP_GITHUB_TOKEN` limited to the tap and bucket
repositories (`izam-mohammed/homebrew-browser-hand`,
`izam-mohammed/scoop-browser-hand`, created by the person); workflow
permissions `contents: write`, `id-token: write` and `attestations: write`
in `release.yml` only; GitHub Actions for build, attest and upload, pinned
by SHA like `ci.yml`. No new Rust or npm package.

Standards: `docs/standards.md` (format, lint, types, tests, coverage,
advisories, secrets, docs, through `make check`). Releases:
`docs/releases.md`, written with this plan.

## Integrations

| Integration | Local docs | Proof script | Env vars |
| --- | --- | --- | --- |
| GitHub Releases and attestations | `docs/external/github-releases-attestations.md` | `scripts/prove/release-dry-run.sh` | none |
| Homebrew tap | `docs/external/homebrew-tap.md` | `scripts/prove/publish-homebrew.sh` | `TAP_GITHUB_TOKEN` |
| Scoop bucket | `docs/external/scoop-bucket.md` | `scripts/prove/publish-scoop.sh` | `TAP_GITHUB_TOKEN` |

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `scripts/prove/release-dry-run.sh`, `publish-homebrew.sh`, `publish-scoop.sh` | new | 1 | one proof per integration | expected |
| `scripts/check-version.sh` | new | 2 | fails when the four versions differ | expected |
| `scripts/package.sh` | edit | 2 | `--keep-key` keeps the manifest `key` for the release zip | expected |
| `CHANGELOG.md` | new | 2 | the `0.1.0` section | expected |
| `.github/workflows/release.yml` | new | 2 | matrix build, sums, attestations, tag, release | fixed |
| `install.sh`, `install.ps1` | new | 3 | verify sums, install the binary, register the host, print the extension path | fixed |
| `.github/workflows/publish-homebrew.yml`, `publish-scoop.yml` | new | 3 | formula and manifest from the release | fixed |
| `README.md` | edit | 3 | `## Install`, recommended way first | expected |
| `Makefile`, `docs/standards.md` | edit | 2 | `check-version` joins `make check` | expected |

*Reused, not rewritten:*

- `scripts/package.sh` already builds and zips the extension; it gains one
  flag instead of a second packer.
- `.github/workflows/ci.yml` pins actions by SHA and installs the same
  toolchain; `release.yml` copies that pinning and runs `make check` as its
  first job rather than repeating the checks.
- `plugin/server/browser-hand install` (`host/src/install.rs`) already
  writes the native host manifest and registry key; the install scripts call
  it instead of writing those files.
- Searched for an existing checksum or archive step (`SHA256SUMS`,
  `tar`, `Compress-Archive` in `scripts/` and `.github/`): none.

## Contract

Asset names are binding, because `install.sh`, `install.ps1`, the formula
and the manifest read them:

- `browser-hand-vX.Y.Z-<target>.tar.gz` (`.zip` for Windows), holding
  `browser-hand` (`browser-hand.exe`) and `LICENSE` at the archive root.
- `browser-hand-extension-vX.Y.Z.zip`, `install.sh`, `install.ps1`,
  `SHA256SUMS` (`sha256sum` format, one line per file above).
- Targets: `aarch64-apple-darwin`, `x86_64-apple-darwin`,
  `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
  `x86_64-pc-windows-msvc`.

Owner: this repository. Checked by the dry run's asset listing and by each
`publish-*.yml` install check.

## Edge cases

- The version already has a tag: `release.yml` skips, no error.
- The four versions differ: `release.yml` fails before building.
- A target fails to build: no release is created (the release job needs all
  of them).
- `SHA256SUMS` does not match a downloaded file: the install script and each
  publish workflow stop and print the file name.
- Publishing a version the tap or bucket already has: a skip, not a failure.
- A tap or bucket push fails: the release stays; `workflow_dispatch` with the
  tag re-runs it.

## Security

What is protected: what people install, which runs with access to their
browser sessions. A tampered binary or a hijacked tap is full takeover of
the profiles Claude can drive.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Tampering | an asset changed after the build | `SHA256SUMS` and attestations on every file; the script, formula and manifest check the sums | each install check fails on one changed byte (Phase 3 check) |
| Spoofing | a fork's workflow publishes to the tap | publish workflows run only from this repository, in the `release` environment | the first release run's log shows the environment |
| Information disclosure | `TAP_GITHUB_TOKEN` leaks in a log | read by name from the environment, never echoed, scoped to two repositories | gitleaks in `make check`; masked in the run log |
| Elevation of privilege | the install script runs with the person's rights and writes outside the user dir | per-user paths only, no `sudo`, `set -eu`, sums verified before anything is installed | `scripts/prove/release-dry-run.sh` installs into a temporary `HOME` |
| Tampering (supply chain) | a workflow action is replaced | actions pinned by SHA like `ci.yml`; `permissions` set per job | `zizmor` or the shared security gate over `.github/workflows/` |

Data: no personal data; nothing is uploaded. Secrets: `TAP_GITHUB_TOKEN`,
named only. Logged: file names and versions, never the token. Checklist:
OpenSSF Scorecard checks for packaging and token permissions.

## Resource budget

| Job | Memory | CPU cores | At what load | Limit |
| --- | --- | --- | --- | --- |
| `cargo build --release` for one target | unmeasured, `?` | 2 | one build at a time on the laptop; five in parallel on hosted runners | `--jobs 2` locally |

Measured in Phase 2's dry run and written here; run `sh <project-planner>/
scripts/headroom.sh 1500 2` before any local build.

## Open decisions

- Linux builds link glibc: default, build on `ubuntu-22.04` and
  `ubuntu-24.04-arm` so older distributions run it; musl is the answer if
  someone reports a failure.
- macOS x64 runner label: default, the one `actions/runner-images` lists for
  Intel in Phase 1; Phase 1 records it.

## Risks

- First release ever: the dry run (`workflow_dispatch`, no tag) is run until
  green before the PR merges.
- An unsigned binary meets Gatekeeper or SmartScreen: the install scripts
  avoid the browser download path; code signing is a follow-up.
- The repository is still private when the plan is built: Phase 1 stops until
  it is public.

## Declined

- cargo-dist (decision 1): its generated workflow cannot carry the
  extension zip and the version check without hooks, and rewrites pinned
  actions.
- release-please (decision 2): a second PR per release racing the release
  plan's.
- Tagging by hand (decision 2): a wrong-commit tag is a person's mistake.
- winget (decision 3): manual review takes days.
- cargo-binstall (decision 3): needs a crates.io publish, and its installer
  is rarely on a Claude Code user's machine.
- A marketplace entry (decision 3): a plugin copy has no binary.
- The Chrome Web Store: concluded not worth it in `plans/07`.

## What the tests hold

`scripts/check-version.sh` rejects four versions that differ; the dry run
builds every asset and `SHA256SUMS` without tagging; each channel's install
check installs `0.1.0` on a clean runner with the README's command and reads
back `browser-hand --version`, and fails on one changed byte.

## Follow-ups

- Claude Code marketplace entry (`.claude-plugin/marketplace.json`): the
  plugin copy lacks `plugin/server/browser-hand`, so `.mcp.json` must find
  the installed binary on `PATH` first (`v0.2.0`).
- cargo-binstall metadata and a crates.io publish, with trusted publishing.
- Code signing and notarisation for macOS and Windows.

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: prove each integration (needs you: public repo, tap, bucket, token)

- [ ] The repository is public, `izam-mohammed/homebrew-browser-hand` and
  `izam-mohammed/scoop-browser-hand` exist (the bucket with the topic
  `scoop-bucket`), the environment `release` exists, and `TAP_GITHUB_TOKEN`
  is set in it. Plan 17's PR `#59` and the README PR `#60` are merged. The
  person does these; Claude never reads or sets the token.
- [ ] `scripts/prove/release-dry-run.sh` builds one archive and the
  extension zip locally, writes `SHA256SUMS`, installs into a temporary
  `HOME` and prints `PASS`; `scripts/prove/publish-homebrew.sh` and
  `scripts/prove/publish-scoop.sh` push a `0.0.0-proof` formula and manifest
  to a branch of the tap and bucket and print `PASS`.
- [ ] Check: each proof script exits 0 and prints `PASS`; the macOS x64
  runner label is written under `## Open decisions`.

### Phase 2: v0.1.0 built and released to GitHub

- [ ] `scripts/check-version.sh` fails when the versions in
  `host/Cargo.toml`, `extension/package.json`, `extension/manifest.json` and
  `plugin/.claude-plugin/plugin.json` differ, runs in `make check`, and is
  listed in `docs/standards.md`, pinned by a test run on a copy with one
  version changed.
- [ ] `scripts/package.sh --keep-key` zips the extension with its manifest
  `key` (expected in `scripts/package.sh`), pinned by a check that the zip's
  `manifest.json` still has the key.
- [ ] `CHANGELOG.md` has the `0.1.0` section, from the PRs merged to date.
- [ ] `.github/workflows/release.yml` checks the versions, builds the five
  targets in a matrix, packs the extension zip, writes `SHA256SUMS`, attests
  every file, then tags and publishes the release when `host/Cargo.toml`
  holds an untagged version; run by hand it does everything except tag and
  publish.
- [ ] Check: `make check` passes, and `release.yml` run by hand (dry run)
  builds every asset in the Contract; its run time and peak memory go into
  `## Resource budget`.

### Phase 3: every channel installs from the release

- [ ] `install.sh` and `install.ps1` download the archive for the machine,
  verify it against `SHA256SUMS`, put the binary in a per-user directory, run
  `browser-hand install --no-store`, unpack the extension zip beside it, and
  print the path to load unpacked, pinned by the dry-run proof installing
  into a temporary `HOME`.
- [ ] `publish-homebrew.yml` and `publish-scoop.yml` run on
  `release: published`, download and verify the release's archives, write the
  formula and manifest to the tap and bucket, and end with an install check
  on a clean runner.
- [ ] `README.md` `## Install` gives the scripts first, then the tap, the
  bucket and the release page, each with upgrade, uninstall and
  `browser-hand --version`, and says the extension is loaded unpacked from
  the extension zip; the build-from-source steps move under `## Development`.
- [ ] Check: `make check` passes, and each `publish-*.yml` run by hand
  against the dry-run assets rejects one changed byte.

### Phase 4: the install tried (needs you: a machine without Rust)

- [ ] You try it: with the dry-run assets from Phase 2, run `install.sh`
  (or `install.ps1` on Windows) on a machine with no Rust or Node, load the
  extension unpacked from the path it prints, and ask Claude to list your
  profiles. Say what was confusing; fixes go into the README and scripts.

### Phase 5: open the PR

- [ ] The branch pushed and its PR opened against `main` (or, if one is
  already open for this branch, its body brought up to date) with the title
  `feat: release pipeline and v0.1.0`, a body naming this plan, saying that
  merging it publishes `v0.1.0` to GitHub Releases, the Homebrew tap and the
  Scoop bucket, and the checks run with their result. The PR's URL printed as
  the evidence. Opened, never merged. Confirming the live release (every asset, every
  `publish-*` run green, `gh attestation verify`, the roadmap row set to
  `released DD/MM/YYYY`) is the first phase of the next release plan.

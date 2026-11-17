# one `make check` formats, lints, tests to a 90 % floor and scans for secrets and advisories, and CI runs it on every PR

## The ask

The user wants every repository to have proper lint and format, tests,
a coverage floor of 90 % (target 95 %), and security checks (dependency
audit, secret scan, static analysis), all run by one local check command
and by CI on every PR, reusing the shared security gate in
`izam-mohammed/.github` rather than a parallel one. This plan covers that
gap for browser-hand; nothing is built in the planning turn.

Built so far: `docs/built/BUILT-2026-10-22-1828.md`. Measured there on
22/10/2026: host 82.61 % lines, extension 76.8 % lines; CI
(`.github/workflows/ci.yml`) already runs rustfmt, Clippy with
`-D warnings`, tsc, both test suites and coverage floors of 70 % and 65 %.
Missing: a TypeScript formatter and linter, any dependency audit, secret
scan or static analysis, one local command, and floors at 90 %. CI has not
run since 21/10/2026 because of a billing hold on the account.

## Alternatives

### Decision 1: where do the security checks in CI come from? (two-way door)

The user asked to reuse the shared gate. It takes an `ecosystem` input of
`python`, `node`, `go` or `shell`; there is no `rust` value, though its
osv-scanner stage reads any lockfile.

Searched 2026-10-22: "semgrep vs CodeQL private repository free Rust
TypeScript support", "osv-scanner supported lockfiles Cargo.lock"; read
`izam-mohammed/.github` `README.md` and `security-scan.yml` at `ff76c48`,
the osv-scanner supported-lockfiles page (lists `Cargo.lock` and
`package-lock.json`), Semgrep's CodeQL comparison page.

| Must | Shared gate, `ecosystem: node` (user's pick) | Own workflow (gitleaks, osv-scanner, semgrep) | CodeQL default setup |
| --- | --- | --- | --- |
| Free on a private repository | yes | yes | no (needs GitHub Advanced Security on private repositories, per GitHub's and Semgrep's pages) |
| Blocks a merge on a leaked secret | yes (gitleaks stage blocks) | yes | no (no secret stage) |
| **Survives** | **yes** | **yes** | no |

| Criterion | Weight | Shared gate | Own workflow |
| --- | ---: | ---: | ---: |
| Performance efficiency | 35 | 4 | 4 |
| Fit to the ask | 25 | 5 | 3 |
| Compatibility | 20 | 5 | 3 |
| Maintainability of the result | 20 | 5 | 2 |
| **Weighted total** | **100** | **4.65** | **3.15** |

- Efficiency 4 each: the same three tools run either way; neither is
  measured yet.
- Fit 5 for the shared gate: the ask names it; the own workflow is the
  parallel version the ask rules out.
- Compatibility and maintainability: the shared gate is one caller file
  pinned by SHA, as in `repo-template/.github/workflows/security.yml`; an
  own copy drifts from every other repository's.

**Chosen: the shared gate with `ecosystem: node` (the user's pick).** It
scans `Cargo.lock` and `package-lock.json` with osv-scanner and the
TypeScript with Semgrep's node packs. Revisit if the shared gate gains a
`rust` ecosystem (see `## Follow-ups`).

### Decision 2: what audits the dependencies in the local check? (two-way door)

Searched 2026-10-22: "cargo-deny vs cargo-audit vs osv-scanner Cargo.lock
RustSec advisories"; read rustsec.org (RustSec exports to OSV), the
osv-scanner supported-lockfiles page, and a cargo-audit against cargo-deny
comparison (safeguard.sh).

| Criterion | osv-scanner, both lockfiles | cargo-deny plus `npm audit` | cargo-audit plus `npm audit` |
| --- | --- | --- | --- |
| Performance efficiency | one run over both lockfiles | two tools, two database fetches | two tools, two database fetches |
| Fit to the ask | advisories for both | advisories plus licences and bans (not asked) | advisories for both |
| Compatibility | same tool and database as the CI gate | differs from CI's results | differs from CI's results |

**Chosen: osv-scanner.** One tool for both languages, and the local
result matches the gate's stage 2, since RustSec feeds OSV. Revisit if
licence or banned-crate checks are asked for (then cargo-deny, already
installed on this machine).

### Decision 3: what formats and lints the TypeScript? (two-way door)

Nothing formats or lints `extension/` today beyond `tsc`.

Searched 2026-10-22: "Biome vs ESLint Prettier vs oxlint performance
benchmark 2026"; read the CodeEditorLand linter benchmark
repository, pkgpulse's Biome against Oxc guide and peterbe.com's oxlint against Biome benchmark.

| Must | Biome | ESLint plus Prettier | oxlint plus Prettier |
| --- | --- | --- | --- |
| Formats and lints TypeScript | yes | yes | yes |
| No unpatched high or critical advisory | unverified: checked on OSV.dev as Phase 2's first step | yes | yes |
| **Survives** | **yes, if OSV.dev shows none** | **yes** | **yes** |

| Criterion | Weight | Biome | ESLint plus Prettier | oxlint plus Prettier |
| --- | ---: | ---: | ---: | ---: |
| Performance efficiency | 40 | 5 | 2 | 4 |
| Fit to the ask | 25 | 4 | 5 | 3 |
| Maintainability of the result | 20 | 5 | 3 | 3 |
| Security | 15 | 5 | 3 | 4 |
| **Weighted total** | **100** | **4.75** | **3.10** | **3.55** |

- Efficiency: Biome is reported 10 to 56 times faster than ESLint plus
  Prettier and on a par with oxlint for linting (secondary sources, varying
  hardware); Prettier remains the slow half of the oxlint pair. To be
  measured on `extension/` in Phase 2.
- Fit: ESLint has the widest rule set (5); oxlint has no formatter of its
  own that is out of beta (3).
- Maintainability and security: Biome is one dev dependency and one config
  file; the others are two or more packages and their plugins.

**Chosen: Biome.** Fastest single tool covering both. Revisit if a rule
the code needs exists only as an ESLint plugin.

### Decision 4: what is the one check command? (two-way door)

Searched 2026-10-22: "just vs make vs shell script task runner check
command comparison"; read the charmhub make-vs-just comparison and the
Linux Magazine piece on just; `project-setup/templates/Makefile.*` and
`mac-notch/Makefile` locally.

| Criterion | `Makefile` (`make check`) | `justfile` | `scripts/check.sh` |
| --- | --- | --- | --- |
| Runs with nothing installed | yes, on macOS and the CI runner | needs `just` | yes |
| Compatibility | the target names `project-setup` uses in every repo | new | `scripts/build.sh` sits beside it |
| Fit to the ask | one command, plus `make lint`, `make test`, `make security` | same | one command only |

**Chosen: a `Makefile`.** Same target names as the house templates, no
install. Revisit if a target needs logic Make expresses badly; it then
calls a script.

### Decision 5: how is the 90 % floor held? (two-way door)

Searched 2026-10-22: "cargo-llvm-cov fail-under-lines vitest coverage
thresholds v8 istanbul 2026"; read vitest.dev's coverage config
(`thresholds.lines`, `perFile`) and the cargo-llvm-cov README.

| Criterion | Lines floor 90 % per side, raised once tests reach it | Raise floors in steps | Per-file floor |
| --- | --- | --- | --- |
| Fit to the ask | the asked floor | reaches 90 % only at the end | stricter than asked |
| Reliability | a drop fails the check | each step can stall | a tiny file flaps |
| Compatibility | the tools already in CI | same | vitest only |

**Chosen: one lines floor of 90 % for the host and one for the extension,
set in the phase whose tests reach it.** Nothing is excluded except
generated code (`extension/src/wire.gen.ts`), and any exclusion is named
in `docs/standards.md`. Revisit at 95 %, the user's target.

## The decision

A root `Makefile` gains `check`, `lint`, `format`, `test`, `coverage` and
`security`; `check` runs rustfmt and Clippy, Biome, tsc, both test suites
with their coverage floors, the build, osv-scanner over both lockfiles and
gitleaks, stopping at the first failure (decisions 2 to 4). CI calls the
shared security gate (decision 1) and runs `make check` in place of its
separate steps. Floors go to 90 % lines as the tests reach them
(decision 5). Every phase updates `docs/standards.md` for what it adds.

Rough cut: Phase 1 lands `make check` with the checks that exist plus the
two scanners, and the gate, so you can run it the same day.

New dependencies: `@biomejs/biome` as an extension dev dependency, pinned;
gitleaks and osv-scanner as local tools (`brew install`), named in
`docs/standards.md`. CI: the shared reusable workflow at a pinned SHA, and
every action pinned by SHA. No new secret, network host for the product,
or permission.

Standards: `docs/standards.md` (today: tsc, vitest, cargo test, the
build; after this plan, everything through `make check`).

## Where it lands

| Path | New or edit | Phase | What changes | Firm? |
| --- | --- | --- | --- | --- |
| `Makefile` | new | 1 | the targets above | fixed (the target names) |
| `.github/workflows/security.yml` | new | 1 | calls the shared gate, `ecosystem: node` | expected |
| `.github/dependabot.yml` | new | 1 | cargo, npm and github-actions updates | expected |
| `.pre-commit-config.yaml` | new | 1 | the baseline hooks | expected |
| `docs/standards.md` | edit | 1-5 | each check as it lands | reuse |
| `extension/biome.json` | new | 2 | format and lint rules | expected |
| `extension/package.json` | edit | 2 | `@biomejs/biome`, `lint` and `format` scripts | reuse |
| `host/tests/` | edit | 3 | tests for the least covered modules | reuse |
| `extension/test/` | edit | 4 | tests for the least covered modules | reuse |
| `extension/vitest.config.mjs` | edit | 4 | `thresholds.lines` 90 | reuse |
| `.github/workflows/ci.yml` | edit | 5 | runs `make check`, actions pinned by SHA, floor 90 | reuse |

*Reused, not rewritten:*

- `izam-mohammed/.github` `.github/workflows/security-scan.yml`: the gate
  itself; this repository adds only the caller.
- `repo-template` `.github/workflows/security.yml`, `.github/dependabot.yml`
  and `.pre-commit-config.yaml`: copied and set for Rust and npm, not
  written fresh.
- `project-setup/templates/Makefile.node` and `mac-notch/Makefile`: the
  target names and the `security` target's commands.
- `.github/workflows/ci.yml`: its rustfmt, Clippy, llvm-cov and vitest
  steps become `make check`'s, with the same flags.

## Security

What is protected: the repository's history from leaked secrets, and the
built binary and extension from known-vulnerable dependencies. Who can
reach it: anyone who opens a PR triggers CI with read-only contents.

| Threat | Here | Handled by | Proved by |
| --- | --- | --- | --- |
| Information disclosure | a key committed in a change | gitleaks in `make check`, the pre-commit hook and the gate's blocking stage | a planted fake key in a scratch branch fails `make security` (Phase 1 check), never committed |
| Tampering | a vulnerable or swapped crate or npm package | osv-scanner over `Cargo.lock` and `package-lock.json`, lockfiles committed, `--locked` and `npm ci` | `make security` exits 0 on `main` with no high or critical advisory |
| Elevation of privilege | a third-party action or workflow given write rights | `permissions: {}` at the top, per-job grants, actions pinned by SHA, zizmor in the gate | the gate's zizmor stage reports no finding on the PR |

Secrets: none added; the gate needs none, so no `secrets: inherit`.
Logged: scanners run with `--redact`. Checklist: the SLSA build track (slsa.dev) for the CI
parts, its current edition looked up in Phase 5.

## Open decisions

- CI cannot start until the account's billing hold is cleared (run
  `39641597066`): default, `make check` locally is the gate until then, and
  Phase 5's check waits on a green run.
- Raising the floor to the 95 % target: default, a later plan once 90 %
  holds.

## Risks

- Biome's first format rewrites many files: it lands as its own commit in
  Phase 2, with no other change in it, so review and blame stay readable.
- Some host code paths need macOS or Chrome (`install.rs`, `reload.rs`):
  tests drive them through a temporary home and a fake socket; if a path
  still cannot be reached, the gap is named in `docs/standards.md`, never
  silently excluded.

## Declined

- CodeQL default setup: fails the free-on-private-repositories must and
  has no secret stage.
- An own security workflow: the parallel version the ask rules out; lost on
  fit, compatibility and maintainability (3.15 against 4.65).
- cargo-deny and cargo-audit with `npm audit`: two tools where one covers
  both lockfiles and matches CI.
- ESLint plus Prettier: lost on efficiency (3.10 against 4.75).
- oxlint plus Prettier: lost on fit and efficiency (3.55).
- `justfile`: needs an install on every machine and runner.
- Stepped or per-file floors: reach the asked floor later, or flap.

## What the tests hold

The new host and extension tests pin the behaviour of the modules that
were least covered (each named by the test file it lands in), and the
floors stop coverage from slipping under 90 % again. The scanners are
checks, not tests: their proof is `make security` going red on a planted
fake key and green on `main`.

## Follow-ups

- A `rust` value for the shared gate's `ecosystem` (Semgrep's Rust pack,
  `cargo audit` or osv-scanner already covering it) belongs in
  `izam-mohammed/.github`, not here.
- The unticked proof phases in plans 01, 03, 05 and 06
  (`docs/built/BUILT-2026-10-22-1828.md`).

## Repository knowledge

Read root `KNOWLEDGE.md` when present before each phase. Follow the global and
repository instructions for recording useful development findings.

## Phases

### Phase 1: the rough cut: one command runs every check that exists (needs you: try it)

- [x] `make check` runs rustfmt in check mode, Clippy with `-D warnings`,
  tsc, `cargo test`, `vitest run`, the release build, osv-scanner over both
  lockfiles and gitleaks over the history, stopping at the first failure
  (expected in `Makefile`), with `lint`, `test`, `coverage` and
  `security` as their own targets.
  Landed 2026-11-17: the release build is `cargo build --release` plus
  `npm run build`, not `scripts/build.sh`, which also installs the native
  host into Chrome. osv-scanner reads `osv-scanner.toml` (two advisories
  accepted with reasons: rmcp's HTTP client, unused here and pinned to
  `~3.8`; unmaintained `ttf-parser`, no fix); `.gitleaksignore` lists four
  extension-manifest public keys read as API keys. `rustix` bumped to 1.1.6
  in `host/Cargo.lock`.
- [x] The shared gate is called on every PR and weekly with
  `ecosystem: node`, pinned by SHA (expected in
  `.github/workflows/security.yml`), with Dependabot for cargo, npm and
  actions (`.github/dependabot.yml`) and the baseline hooks
  (`.pre-commit-config.yaml`) copied from `repo-template`.
- [x] `docs/standards.md` lists every check with its command and makes
  `make check` the one command; README's Tests section points at it.
- [x] Check: `make check` passes on this branch, and `make security` fails
  on a fake key planted in a scratch copy (never committed).
  Landed 2026-11-17: `make check` passed (about 2 minutes on a loaded
  machine). The plant was an uncommitted file scanned with `gitleaks dir`
  (found); `make security` itself scans history, so it fails only once a
  key is committed, and the pre-commit hook catches it before that.
- [ ] You try it: run `make check` from the repository root and say whether
  its output and run time are what you want from it. What you want changed
  goes into the phases below.

### Phase 2: the TypeScript is formatted and linted

- [x] `@biomejs/biome`'s pinned version has no high or critical advisory on
  OSV.dev, recorded in `docs/standards.md` § Decided; one found reopens
  decision 3 before anything else in this phase.
- [x] Biome formats and lints `extension/src` and `extension/test`
  (expected in `extension/biome.json`, `extension/package.json` scripts
  `lint` and `format`), generated `wire.gen.ts` ignored, and its run time on
  `extension/` recorded in `docs/standards.md` against decision 3.
  Landed 2026-11-17: the config is `extension/biome.jsonc` (comments), with
  `noNonNullAssertion`, `useDomNodeTextContent` and, in `test/`, three
  fake-friendly rules off, each reasoned in the file; `biome ci` runs in
  0.3 s. The generated `src/options/theme.gen.css` is ignored too.
- [x] The first `npm --prefix extension run format` lands as a commit of its
  own with no other change.
- [x] `make lint` runs Biome after rustfmt and Clippy, and
  `docs/standards.md` gains the row.
- [x] Check: `make check` passes, and `npx --prefix extension biome ci`
  reports no diff and no diagnostics.

### Phase 3: the host reaches 90 % lines

- [x] Tests for the least covered host modules, lowest first
  (`install.rs`, `reload.rs`, `tools/images.rs`, `tools/files.rs`,
  `main.rs`, `mcp.rs`), driven through a temporary home directory and fake
  sockets (expected in `host/tests/install.rs`, `host/tests/reload.rs`,
  `host/tests/mcp.rs`).
  Landed 2026-11-17: host lines 83.0 % to 91.7 % with `host/tests/cli.rs`
  (the binary as Chrome and Claude run it), `launcher.rs` (fake `open` and
  `pgrep` on PATH), `host_conn.rs`, `reload.rs`, `tools.rs` and a batch
  dispatch module in `mcp.rs`; `reload::report` split out of `main` to be
  testable.
- [x] `make coverage` fails under 90 % host lines (`cargo llvm-cov
  --fail-under-lines 90`), and `docs/standards.md` records the floor.
- [x] Check: `make check` passes, and `make coverage` prints host lines at
  or over 90 %.

### Phase 4: the extension reaches 90 % lines

- [x] Tests for the least covered extension modules, taken from
  `vitest run --coverage` with the text reporter, lowest first (expected in
  `extension/test/`), with Chrome APIs faked as the existing tests do.
  Landed 2026-11-17: extension lines 77.3 % to 91.8 % with
  `test/background.test.ts` (the service worker's wiring over stand-ins
  and a fake Chrome) and `test/entries.test.ts` (claim, popup, settings,
  main-world and content entries, the page client).
- [x] `thresholds.lines` set to 90 with `src/wire.gen.ts` excluded (expected
  in `extension/vitest.config.mjs`), and the exclusion named in
  `docs/standards.md`.
- [x] Check: `make check` passes, and `make coverage` prints extension lines
  at or over 90 %.

### Phase 5: CI runs the same command

- [x] `.github/workflows/ci.yml` runs `make check` (macOS-only steps
  skipped on Linux as the host job does today), every action pinned by full
  commit SHA with its version in a comment, `persist-credentials: false`,
  and the coverage summary written to the job summary.
  Landed 2026-11-17: one job, not two; `make check` now runs `lint`,
  `coverage` (the tests inside it), `build` and `security`. The secret
  scanner is downloaded and checksum-verified because the install action
  has no gitleaks. Written, not yet run on a runner.
- [x] `docs/standards.md` § CI describes both workflows.
- [ ] Check: `make check` passes locally, and the PR shows `ci` and
  `Security` green (waits on the billing hold in `## Open decisions`).

### Phase 6: open the PR

- [ ] The branch pushed and its PR opened against the branch it was cut from
  (or, if one is already open for this branch, its body brought up to date)
  with a Conventional Commit title for the whole change, a body naming this
  plan, what changed and why, and the checks run with their result. The PR's
  URL printed as the evidence. Opened, never merged.

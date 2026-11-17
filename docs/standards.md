# browser-hand: what every change passes

Run everything: `make check`. It stops at the first failure; `make lint`,
`make test`, `make coverage` and `make security` run one part each (`make check` runs the tests inside `make coverage`).
A change is done when it passes locally and on its pull request, where
`.github/workflows/ci.yml` runs the checks below (since commit `b3bbd13`).

## Toolchain

| What | Version | Pinned in |
| --- | --- | --- |
| Rust | 1.98.0 (stable) | not pinned (`docs/research/runtime-baseline.md` records it) |
| Node | 24.9.0 | not pinned |
| npm packages | TypeScript 7.0.2, Biome 2.6.8, vitest 5.0.5, esbuild 0.28.2, jsdom 30.1.3 | `extension/package-lock.json`, committed |
| Rust crates | | `host/Cargo.lock`, committed |
| gitleaks, osv-scanner | 8.30.1, 2.7.1 | local tools for `make security`, installed by hand (`go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`) |
| Chrome | 155 (minimum 120) | `extension/manifest.json` `minimum_chrome_version` |

## Checks

| Check | Tool | Config | Command | Passing means |
| --- | --- | --- | --- | --- |
| Everything | make | `Makefile` | `make check` | lint, test, build and security all pass |
| Rust format | rustfmt | defaults | `cargo fmt --manifest-path host/Cargo.toml --check` | no diff |
| Rust lint | Clippy | defaults | `cargo clippy --manifest-path host/Cargo.toml --all-targets --locked -- -D warnings` | no warnings |
| TypeScript format and lint | Biome 2.6.8 | `extension/biome.jsonc` | `npm --prefix extension run lint` (check), `run format` (fix) | no diff, no diagnostic; `wire.gen.ts` and `theme.gen.css` (generated) ignored |
| Types | tsc | `extension/tsconfig.json` | `npm --prefix extension run typecheck` | no errors |
| Extension unit tests | vitest + jsdom | `extension/package.json` | `npm --prefix extension test` (runs tsc first) | all pass |
| Host tests | cargo test | `host/Cargo.toml`, root `.cargo/config.toml` | `cargo test --manifest-path host/Cargo.toml` | all pass; also regenerates `extension/src/wire.gen.ts` |
| Host coverage | cargo-llvm-cov | `Makefile` | `make coverage` (`cargo llvm-cov --locked --summary-only --fail-under-lines 90` in `host/`) | host lines at or over 90 % (91.7 % on 2026-11-17) |
| Extension coverage | vitest, `@vitest/coverage-v8` | `extension/vitest.config.mjs` | `make coverage` (`npm --prefix extension run coverage`) | lines at or over 90 % (91.8 % on 2026-11-17); `src/wire.gen.ts` (generated) is the only exclusion |
| Build and install | cargo, esbuild | `scripts/build.sh` | `sh scripts/build.sh` | builds and installs the native host into Chrome (not part of `make check`) |
| Build | cargo, esbuild | `Makefile` | `make build` | release host and extension build, no native-host install |
| Dependency advisories | osv-scanner | none | `osv-scanner scan source --config osv-scanner.toml -L host/Cargo.lock -L extension/package-lock.json` | no advisory (also `make security`) |
| Secrets | gitleaks | none | `gitleaks git . --redact --verbose` | none in the history (also `make security`; hook in `.pre-commit-config.yaml`) |
| Proofs | sh | `scripts/prove/` | `sh scripts/prove/<name>.sh` | prints `PASS` (needs Chrome and a person) |

## Tests

Extension tests live in `extension/test/*.test.ts` and run in jsdom; host
tests in `host/tests/*.rs`, with wire fixtures in `host/tests/fixtures/`. One
test: `npx --prefix extension vitest run test/page.test.ts`, or
`cargo test --manifest-path host/Cargo.toml --test wire`.

## Constraints

No static analysis of the Rust is run
locally yet (the CI security gate runs Semgrep's node packs);
`plans/09-quality-gates.md` plans the rest. Anything that needs a real Chrome
is a proof script or a walk with a person, because the extension's input and debugger paths do
not run in jsdom. `KNOWLEDGE.md` lists the traps (vitest's native binding,
cargo config lookup, classic content scripts).

## Conventions

Commits: lowercase subject, `area ~ what` (see `git log`), no attribution
lines. Plans follow the project-planner standard in `plans/`.

## CI

`.github/workflows/security.yml` calls the shared gate in
`izam-mohammed/.github` on every pull request and weekly, with
`ecosystem: node` (it has no Rust value; its osv-scanner stage still reads
`host/Cargo.lock`), pinned by SHA. `.github/dependabot.yml` updates cargo,
npm and actions.

`.github/workflows/ci.yml` runs on every pull request and push to `main`,
read-only (`permissions: contents: read`, `persist-credentials: false`):
one job that installs the toolchain, cargo-llvm-cov, osv-scanner and
gitleaks (the download checked against its checksum file) and runs
`make check`, so CI and the laptop run the same command. It writes the
coverage summary to the job summary. Every action is pinned by full commit
SHA with its version in a comment; Dependabot moves them. The job runs on
the linux self-hosted runner while the account's billing hold blocks
GitHub-hosted minutes. Nothing in `make check` is macOS-only, so no step is
skipped on Linux.

## Decided

Biome formats and lints the TypeScript (`plans/09-quality-gates.md`
decision 3). Checked 2026-11-17: OSV.dev lists no advisory for
`@biomejs/biome` (query by package name returns none), so decision 3 stands.
`biome ci .` over `extension/` takes 0.3 s wall clock (55 ms checking 47
files); ESLint plus Prettier was not run for comparison.
Rules switched off, each with its reason in `biome.jsonc`:
`noNonNullAssertion` (tsc is strict and DOM code asserts what the page
guarantees), `useDomNodeTextContent` (the code means `innerText`), and in
`test/` `noExplicitAny`, `noAssignInExpressions` and
`useIterableCallbackReturn` (fakes of Chrome and the DOM).

The runtime choices (Rust host, TypeScript extension) are in
`plans/01-bridge.md`.

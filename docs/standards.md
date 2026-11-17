# browser-hand: what every change passes

Run everything: `npm --prefix extension test && cargo test --manifest-path host/Cargo.toml && sh scripts/build.sh`.
A change is done when it passes locally and on its pull request, where
`.github/workflows/ci.yml` runs the checks below (since commit `b3bbd13`).

## Toolchain

| What | Version | Pinned in |
| --- | --- | --- |
| Rust | 1.98.0 (stable) | not pinned (`docs/research/runtime-baseline.md` records it) |
| Node | 24.9.0 | not pinned |
| npm packages | TypeScript 7.0.2, vitest 5.0.5, esbuild 0.28.2, jsdom 30.1.3 | `extension/package-lock.json`, committed |
| Rust crates | | `host/Cargo.lock`, committed |
| Chrome | 155 (minimum 120) | `extension/manifest.json` `minimum_chrome_version` |
| mdBook | 0.5.2 | this file; install `cargo install --locked mdbook --version 0.5.2` |
| lychee | 0.24.2 | this file; install `cargo install --locked lychee --version 0.24.2` |

## Checks

| Check | Tool | Config | Command | Passing means |
| --- | --- | --- | --- | --- |
| Rust format | rustfmt | defaults | `cargo fmt --manifest-path host/Cargo.toml --check` | no diff (CI only today) |
| Rust lint | Clippy | defaults | `cargo clippy --manifest-path host/Cargo.toml --all-targets --locked -- -D warnings` | no warnings (CI only today) |
| Types | tsc | `extension/tsconfig.json` | `npm --prefix extension run typecheck` | no errors |
| Extension unit tests | vitest + jsdom | `extension/package.json` | `npm --prefix extension test` (runs tsc first) | all pass |
| Host tests | cargo test | `host/Cargo.toml`, root `.cargo/config.toml` | `cargo test --manifest-path host/Cargo.toml` | all pass; also regenerates `extension/src/wire.gen.ts` |
| Host coverage | cargo-llvm-cov | `.github/workflows/ci.yml` | `cargo llvm-cov --locked --summary-only --fail-under-lines 70` in `host/` | lines at or over 70 % |
| Extension coverage | vitest, `@vitest/coverage-v8` | `extension/vitest.config.mjs` | `npm --prefix extension run coverage` | lines at or over 65 % |
| Docs reference | cargo test | `host/tests/docs.rs` | `cargo test --manifest-path host/Cargo.toml --test docs` (`UPDATE_DOCS=1` rewrites `docs/book/src/reference/`) | tools, settings and commands pages match the host |
| Docs book | mdBook, lychee | `docs/book/book.toml` | `sh scripts/check-docs.sh` | builds with no warning, no broken link, nothing loaded from outside, no private detail (not in `make check` or CI yet) |
| Build | cargo, esbuild | `scripts/build.sh` | `sh scripts/build.sh` | builds and installs the native host |
| Proofs | sh | `scripts/prove/` | `sh scripts/prove/<name>.sh` | prints `PASS` (needs Chrome and a person) |

## Tests

Extension tests live in `extension/test/*.test.ts` and run in jsdom; host
tests in `host/tests/*.rs`, with wire fixtures in `host/tests/fixtures/`. One
test: `npx --prefix extension vitest run test/page.test.ts`, or
`cargo test --manifest-path host/Cargo.toml --test wire`.

## Constraints

No TypeScript formatter or linter, dependency audit, secret scan or static
analysis is run today, and there is no one local command for every check;
`plans/09-quality-gates.md` plans them. Anything that needs a real Chrome
is a proof script or a walk with a person, because the extension's input and debugger paths do
not run in jsdom. `KNOWLEDGE.md` lists the traps (vitest's native binding,
cargo config lookup, classic content scripts).

## Conventions

Commits: lowercase subject, `area ~ what` (see `git log`), no attribution
lines. Plans follow the project-planner standard in `plans/`.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`,
read-only: the host job (rustfmt, Clippy, release build, tests with
coverage) and the extension job (tsc, build, vitest with coverage). Actions
are pinned by tag, not commit SHA.

## Decided

The runtime choices (Rust host, TypeScript extension) are in
`plans/01-bridge.md`.

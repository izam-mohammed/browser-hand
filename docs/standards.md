# browser-hand: what every change passes

Run everything: `npm --prefix extension test && cargo test --manifest-path host/Cargo.toml && sh scripts/build.sh`.
A change is done when it passes locally. There is no CI yet.

## Toolchain

| What | Version | Pinned in |
| --- | --- | --- |
| Rust | 1.98.0 (stable) | not pinned (`docs/research/runtime-baseline.md` records it) |
| Node | 24.9.0 | not pinned |
| npm packages | TypeScript 7.0.2, vitest 5.0.5, esbuild 0.28.2, jsdom 30.1.3 | `extension/package-lock.json`, committed |
| Rust crates | | `host/Cargo.lock`, committed |
| Chrome | 155 (minimum 120) | `extension/manifest.json` `minimum_chrome_version` |

## Checks

| Check | Tool | Config | Command | Passing means |
| --- | --- | --- | --- | --- |
| Types | tsc | `extension/tsconfig.json` | `npm --prefix extension run typecheck` | no errors |
| Extension unit tests | vitest + jsdom | `extension/package.json` | `npm --prefix extension test` (runs tsc first) | all pass |
| Host tests | cargo test | `host/Cargo.toml`, root `.cargo/config.toml` | `cargo test --manifest-path host/Cargo.toml` | all pass; also regenerates `extension/src/wire.gen.ts` |
| Build | cargo, esbuild | `scripts/build.sh` | `sh scripts/build.sh` | builds and installs the native host |
| Proofs | sh | `scripts/prove/` | `sh scripts/prove/<name>.sh` | prints `PASS` (needs Chrome and a person) |

## Tests

Extension tests live in `extension/test/*.test.ts` and run in jsdom; host
tests in `host/tests/*.rs`, with wire fixtures in `host/tests/fixtures/`. One
test: `npx --prefix extension vitest run test/page.test.ts`, or
`cargo test --manifest-path host/Cargo.toml --test wire`.

## Constraints

No formatter, linter, dependency audit or secret scan is run today; adding
one is its own decision. Anything that needs a real Chrome is a proof script
or a walk with a person, because the extension's input and debugger paths do
not run in jsdom. `KNOWLEDGE.md` lists the traps (vitest's native binding,
cargo config lookup, classic content scripts).

## Conventions

Commits: lowercase subject, `area ~ what` (see `git log`), no attribution
lines. Plans follow the project-planner standard in `plans/`.

## Decided

The runtime choices (Rust host, TypeScript extension) are in
`plans/01-bridge.md`.

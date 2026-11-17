# One command for every check: `make check`. See docs/standards.md.
# Tools needed beyond cargo and npm: gitleaks and osv-scanner (security),
# mdbook and lychee (docs, pinned in docs/standards.md).
.PHONY: help check lint format test coverage build security docs docs-serve docs-check

HOST = --manifest-path host/Cargo.toml
EXT = npm --prefix extension

help:  ## List the targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-10s %s\n",$$1,$$2}'

check: lint coverage build security docs-check  ## Every check, stopping at the first failure (tests run inside coverage)

lint:  ## rustfmt, Clippy, Biome, tsc
	cargo fmt $(HOST) --check
	cargo clippy $(HOST) --all-targets --locked -- -D warnings
	$(EXT) run lint
	$(EXT) run typecheck

format:  ## Rewrite files to the format
	cargo fmt $(HOST)
	$(EXT) run format

test:  ## Host and extension tests
	cargo test $(HOST) --locked
	$(EXT) exec vitest run

coverage:  ## Tests with the coverage floors
	cd host && cargo llvm-cov --locked --summary-only --fail-under-lines 90
	$(EXT) run coverage

build:  ## Release build of the host and the extension (no install)
	cargo build $(HOST) --release --locked
	$(EXT) run build

security:  ## Advisories in both lockfiles, secrets in the history
	osv-scanner scan source --config osv-scanner.toml -L host/Cargo.lock -L extension/package-lock.json
	gitleaks git . --redact --verbose

docs:  ## Build the docs book to docs/book/out/
	sh scripts/docs.sh

docs-serve:  ## Serve the docs book on http://localhost:3000
	sh scripts/docs.sh serve

docs-check:  ## Docs book builds clean with no broken link; the site page follows its rules
	sh scripts/check-docs.sh
	sh scripts/check-site.sh

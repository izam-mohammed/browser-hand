#!/bin/sh
# Builds or serves the docs book (docs/book). Needs mdBook, pinned in
# docs/standards.md: cargo install --locked mdbook --version 0.5.2
#   sh scripts/docs.sh         build to docs/book/out/
#   sh scripts/docs.sh serve   serve on http://localhost:3000, rebuilding on change
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
command -v mdbook >/dev/null 2>&1 || {
  echo "mdbook not found: cargo install --locked mdbook --version 0.5.2" >&2
  exit 1
}
case "${1:-build}" in
  build) mdbook build "$root/docs/book" ;;
  serve) mdbook serve "$root/docs/book" ;;
  *) echo "usage: sh scripts/docs.sh [build|serve]" >&2; exit 2 ;;
esac

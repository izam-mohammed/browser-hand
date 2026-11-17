#!/bin/sh
# The docs check (plans/11-docs.md): the book builds with no warning, no
# internal link is broken, nothing loads from outside, and no page holds a
# private detail. Needs mdbook and lychee, pinned in docs/standards.md:
#   cargo install --locked mdbook --version 0.5.2
#   cargo install --locked lychee --version 0.24.2
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
book="$root/docs/book"
fail=0
bad() { echo "check-docs: $*" >&2; fail=1; }

for tool in mdbook lychee; do
  command -v "$tool" >/dev/null 2>&1 || { echo "check-docs: $tool not found (see the top of this script)" >&2; exit 2; }
done

# 1. builds with no WARN or ERROR line
log=$(mktemp)
trap 'rm -f "$log"' EXIT
rm -rf "$book/out"
mdbook build "$book" >"$log" 2>&1 || { cat "$log" >&2; bad "mdbook build failed"; }
if grep -E '(WARN|ERROR)' "$log" >&2; then bad "mdbook build printed warnings"; fi

# 2. no broken internal link or anchor, no network
lychee --offline --include-fragments --no-progress --root-dir "$book/out" "$book/out" >"$log" 2>&1 \
  || { cat "$log" >&2; bad "lychee found a broken link"; }

# 3. nothing loads from outside the book
if grep -rEn --include='*.html' '<(script|img|iframe|link)[^>]*(src|href)="(https?:)?//' "$book/out" >&2 \
  || grep -rEn --include='*.css' '(@import|url\()[^;)]*(https?:)?//' "$book/out" >&2; then
  bad "the built book loads something from outside"
fi

# 4. no private detail in the pages
src="$book/src"
if grep -rEn '/Users/|/home/[a-z]' "$src" >&2; then bad "a page holds a home path"; fi
# an email address; the allow-list is the documentation domains
if grep -rEno '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$src" \
  | grep -Ev '@(example\.(com|org|net)|bank\.example)$' >&2; then bad "a page holds an email address"; fi
if grep -rEn 'github\.com/izam-mohammed/browser-hand' "$src" >&2; then bad "a page links into the private repository"; fi

[ "$fail" = 0 ] && echo "check-docs: PASS"
exit "$fail"

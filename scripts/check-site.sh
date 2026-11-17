#!/bin/sh
# Refuses what the one-page site must never carry: scripts, external
# URLs, a link into the private repository, a local path, unsized images.
# Usage: sh scripts/check-site.sh [file]   (default site/index.html)

f="${1:-site/index.html}"
[ -f "$f" ] || { echo "FAIL: $f not found"; exit 1; }
bad=0

fail() { echo "FAIL: $1"; bad=1; }

grep -qi '<script' "$f" && fail "contains <script"
grep -qi 'javascript:' "$f" && fail "contains a javascript: URL"
grep -q 'github.com/izam-mohammed/browser-hand' "$f" && fail "links into the private repository"
grep -Eq '/Users/|/home/' "$f" && fail "contains a local path"

# any http(s):// URL must be on the allow-list (none today)
allow='^$'
urls=$(grep -Eo 'https?://[^"'"'"' )<>]+' "$f" | grep -Ev "$allow")
[ -n "$urls" ] && fail "external URL: $(echo "$urls" | head -1)"

# an <img> needs width and height
grep -Eio '<img[^>]*>' "$f" | grep -Eiv 'width=.*height=|height=.*width=' | grep -q . && fail "<img> without width and height"

[ "$bad" = 0 ] && echo "PASS: $f"
exit "$bad"

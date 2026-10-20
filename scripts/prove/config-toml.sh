#!/bin/sh
# Prove the toml crate 1.1.8 reads plans/06-settings.md's config.toml,
# writes it back with to_string_pretty and reads that again unchanged, and
# that a parse error names its line and column, per docs/external/toml.md.
# Source: scripts/prove/config-toml/.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
crate="$here/config-toml"

cargo build --quiet --release --manifest-path "$crate/Cargo.toml"
out=$("$crate/target/release/prove-config-toml") || { echo "$out"; echo "FAIL: the proof exited non-zero"; exit 1; }
echo "$out"

fail() { echo "FAIL: $1"; exit 1; }
echo "$out" | grep -q "^round trip: ok" || fail "no round trip"
echo "$out" | grep -q "line 3, column" || fail "the parse error names no line and column"
echo "$out" | grep -q "^PASS" || fail "no PASS"

#!/bin/sh
# Prove the gif crate encodes an animated GIF from RGBA frames, per
# docs/external/gif-crate.md § Frame. Source: scripts/prove/gif-encode/.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
crate="$here/gif-encode"
cargo build --quiet --release --manifest-path "$crate/Cargo.toml"

out=$(mktemp -t prove-gif.XXXXXX)
trap 'rm -f "$out"' EXIT
"$crate/target/release/prove-gif-encode" "$out"

magic=$(head -c 6 "$out")
if [ "$magic" = "GIF89a" ]; then
  echo "PASS: gif 0.14.2 wrote a GIF89a file of $(wc -c <"$out" | tr -d ' ') bytes"
else
  echo "FAIL: file starts with '$magic', not GIF89a"
  exit 1
fi

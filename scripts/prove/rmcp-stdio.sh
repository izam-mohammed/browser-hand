#!/bin/sh
# Prove rmcp 3.5.1 serves a tool with an image result over stdio, per
# docs/external/rmcp.md § stdio transport. Source: scripts/prove/rmcp-stdio/.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
crate="$here/rmcp-stdio"

cargo build --quiet --release --manifest-path "$crate/Cargo.toml"
bin="$crate/target/release/prove-rmcp-stdio"

out=$(mktemp)
trap 'rm -f "$out"' EXIT

# Legacy handshake (2025-11-25), the one Claude Code's v1 runtime uses.
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"prove","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"screenshot","arguments":{}}}'
  sleep 2
} | "$bin" >"$out" 2>/dev/null || true

fail() { echo "FAIL: $1"; head -c 400 "$out"; echo; exit 1; }

grep -q '"id":1' "$out" || fail "no initialize reply"
grep -q '"instructions":"Proof server for browser-hand"' "$out" || fail "instructions missing"
grep -q '"name":"screenshot"' "$out" || fail "tools/list did not list screenshot"
grep '"id":3' "$out" | grep -q '"type":"image"' || fail "tools/call returned no image"
grep '"id":3' "$out" | grep -q '"mimeType":"image/png"' || fail "image has no mimeType"

echo "PASS: rmcp 3.5.1 stdio server listed a tool and returned text plus image/png"

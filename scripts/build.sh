#!/bin/sh
# Builds browser-hand end to end: the Rust binary, the extension, and the
# Claude Code plugin in plugin/, then registers the binary as Chrome's native
# host. Run from anywhere: sh scripts/build.sh
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)

echo "== host (Rust)"
cargo build --release --manifest-path "$root/host/Cargo.toml"

echo "== extension (TypeScript)"
if [ ! -d "$root/extension/node_modules" ]; then
  npm --prefix "$root/extension" ci --no-audit --no-fund
fi
npm --prefix "$root/extension" run build

echo "== plugin"
mkdir -p "$root/plugin/server"
cp "$root/host/target/release/browser-hand" "$root/plugin/server/browser-hand"

echo "== native host"
# The host manifest points at the plugin's copy, so Chrome and Claude Code
# run the same binary.
"$root/plugin/server/browser-hand" install

cat <<EOF

Built. Next:
  1. In each Chrome profile to use: chrome://extensions, Developer mode on,
     Load unpacked: $root/extension/dist
  2. Start Claude Code with the plugin:
       claude --plugin-dir $root/plugin
     (or add only the server: claude mcp add --scope user browser-hand -- $root/plugin/server/browser-hand mcp)
EOF

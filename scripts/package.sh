#!/bin/sh
# Packs the extension for the Chrome Web Store (plans/07-install-extension.md,
# Phase 2): a fresh build of extension/dist without the manifest's "key"
# (the store refuses one), zipped to dist/browser-hand-<version>.zip.
#
#   sh scripts/package.sh                      no key: the store gives a new ID
#   sh scripts/package.sh --pem <path to .pem> keep ednpkicg... (first upload only)
#
# The private key is copied into the zip as key.pem and never printed. Keep
# it outside the repository.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
pem=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pem) pem=${2:-}; shift 2 ;;
    *) echo "usage: sh scripts/package.sh [--pem <path>]" >&2; exit 2 ;;
  esac
done
if [ -n "$pem" ] && [ ! -f "$pem" ]; then
  echo "No file at $pem" >&2
  exit 1
fi

if [ ! -d "$root/extension/node_modules" ]; then
  npm --prefix "$root/extension" ci --no-audit --no-fund
fi
npm --prefix "$root/extension" run build

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R "$root/extension/dist/." "$stage/"
node -e '
  const fs = require("fs");
  const f = process.argv[1];
  const m = JSON.parse(fs.readFileSync(f, "utf8"));
  delete m.key;
  fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
' "$stage/manifest.json"
if [ -n "$pem" ]; then
  cp "$pem" "$stage/key.pem"
fi

version=$(node -p 'require(process.argv[1]).version' "$stage/manifest.json")
mkdir -p "$root/dist"
out="$root/dist/browser-hand-$version.zip"
rm -f "$out"
(cd "$stage" && zip -qrX "$out" .)

if unzip -p "$out" manifest.json | grep -q '"key"'; then
  echo "FAIL: the zip's manifest.json still has a key" >&2
  exit 1
fi
if [ -n "$pem" ]; then
  echo "Packed $out, with key.pem: the first upload should keep ednpkicgdjiiihmophoifehfeeoabjdc."
else
  echo "Packed $out, no key.pem: the store will give it a new ID."
fi

#!/bin/sh
# Download Chrome for Testing (stable, linux64) into ~/.cache/cft and print the
# path to its chrome binary. Needs: curl, unzip. A second run reuses it.
#   export CFT_CHROME=$(sh .claude/skills/test-extension-linux/scripts/cft-install.sh)
set -eu
dir=${CFT_DIR:-$HOME/.cache/cft}
if [ -x "$dir/chrome-linux64/chrome" ]; then echo "$dir/chrome-linux64/chrome"; exit 0; fi
mkdir -p "$dir"
url=$(curl -sf https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json |
  grep -o 'https://[^"]*/linux64/chrome-linux64.zip' | head -1)
[ -n "$url" ] || { echo "FAIL: no linux64 download in the CfT index" >&2; exit 1; }
curl -sf -o "$dir/chrome.zip" "$url"
unzip -q -o "$dir/chrome.zip" -d "$dir"
rm -f "$dir/chrome.zip"
echo "$dir/chrome-linux64/chrome"

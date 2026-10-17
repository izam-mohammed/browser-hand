#!/bin/sh
# Prove CDP input through chrome.debugger reaches a page as trusted events,
# and that cmd+a selects text on macOS, per docs/external/chrome-debugger-cdp.md
# § CDP methods and § isTrusted of CDP input. Source: scripts/prove/cdp-input/.
# Reuses the echo host from scripts/prove/chrome-bridge/.
#
#   sh scripts/prove/cdp-input.sh --install   build the host, install its manifest
#   sh scripts/prove/cdp-input.sh "Profile 3"  run in that profile, PASS or FAIL
set -eu

here=$(cd "$(dirname "$0")" && pwd)
src="$here/cdp-input"
target="$src/target"
bin="$target/echo-host"
log="$target/claims.log"
host_name="dev.browserhand.provecdp"
manifest="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$host_name.json"

key=$(sed -n 's/.*"key": *"\([^"]*\)".*/\1/p' "$src/extension/manifest.json")
ext_id=$(printf '%s' "$key" | base64 -d | openssl dgst -sha256 -binary \
  | xxd -p | tr -d '\n' | cut -c1-32 | tr '0-9a-f' 'a-p')

case "${1:-}" in
  --install)
    mkdir -p "$target" "$(dirname "$manifest")"
    rustc -O "$here/chrome-bridge/host/src/main.rs" -o "$bin"
    cat >"$manifest" <<EOF
{
  "name": "$host_name",
  "description": "browser-hand input proof (remove after the proof)",
  "path": "$bin",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ext_id/"]
}
EOF
    echo "Installed $manifest (extension ID $ext_id)"
    echo "Now load unpacked in one profile: $src/extension"
    exit 0 ;;
  "" | -*) sed -n '2,10p' "$0"; exit 2 ;;
esac

[ -x "$bin" ] && [ -f "$manifest" ] || { echo "FAIL: run with --install first"; exit 2; }
trap 'rm -f "$manifest"' EXIT
: >"$log"
open -na "Google Chrome" --args --profile-directory="$1" "chrome-extension://$ext_id/run.html"

i=0
until grep -q '"type":"cdp-proof"' "$log"; do
  i=$((i + 1))
  [ "$i" -gt 40 ] && { echo "FAIL: no report in 20 s (is the extension loaded in '$1'?)"; exit 1; }
  sleep 0.5
done

report=$(grep '"type":"cdp-proof"' "$log" | tail -1)
python3 -I - "$report" <<'EOF'
import json, sys
r = json.loads(sys.argv[1])
if "error" in r:
    print("FAIL:", r["error"]); sys.exit(1)
log = r.get("log", [])
seen = {e["type"] for e in log}
untrusted = sorted({e["type"] for e in log if not e["trusted"]})
checks = {
    "every event trusted": not untrusted,
    "click, keys and input all seen": {"mousedown", "mouseup", "click", "keydown", "keyup", "input"} <= seen,
    "typed text arrived": r.get("value") == "abc",
    "cmd+a selected the text": (r.get("selStart"), r.get("selEnd")) == (0, 3),
}
for name, ok in checks.items():
    print(("ok:   " if ok else "FAIL: ") + name)
if untrusted:
    print("untrusted event types:", ", ".join(untrusted))
print("navigator.webdriver:", r.get("webdriver"))
if all(checks.values()):
    print("PASS: CDP input is trusted and cmd+a selects on macOS")
else:
    sys.exit(1)
EOF

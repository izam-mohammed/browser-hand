#!/bin/sh
# Prove that an options_ui page with open_in_tab opens in a full tab from
# runtime.openOptionsPage, and that a declarativeNetRequest session rule
# with tabIds [A] stops a link click, a tabs.update and an iframe in tab A
# but not in tab B, under declarativeNetRequestWithHostAccess, per
# docs/external/chrome-extension-apis.md § Options page and
# § chrome.declarativeNetRequest. Source: scripts/prove/site-rules/.
# Needs a person at Chrome.
#
#   1. In the profile: chrome://extensions, Developer mode on, Load unpacked:
#      scripts/prove/site-rules/extension
#   2. sh scripts/prove/site-rules.sh "Profile 3"
#      then press Start on the page that opens and leave the new tabs alone.
#      Prints each result, then PASS or FAIL.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
src="$here/site-rules"
target="$src/target"
report="$target/report.json"

case "${1:-}" in
  "" | -*) sed -n '2,14p' "$0"; exit 2 ;;
esac

mkdir -p "$target"
rm -f "$report"
python3 -I "$src/serve.py" "$report" &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
sleep 0.5
open -na "Google Chrome" --args --profile-directory="$1" "http://127.0.0.1:8790/"

echo "Waiting up to 3 minutes: press Start on the proof page."
i=0
until [ -s "$report" ]; do
  i=$((i + 1))
  [ "$i" -gt 360 ] && { echo "FAIL: no report in 3 minutes (is the proof extension loaded in '$1'?)"; exit 1; }
  sleep 0.5
done

python3 -I - "$report" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
if r.get("error"):
    print("FAIL:", r["error"]); sys.exit(1)
hits = {(h["tab"], h["via"]) for h in r["hits"]}
opts = r.get("options") or {}
checks = {
    "openOptionsPage opened options.html": str(opts.get("url", "")).endswith("/options.html"),
    "options_ui with open_in_tab is a full tab": opts.get("inTab") is True,
    "the session rule was added": r.get("rule") == "added",
}
for via in ("iframe", "link", "update"):
    checks[f"tab A: {via} blocked"] = ("A", via) not in hits
    checks[f"tab B: {via} loaded"] = ("B", via) in hits
for e in r.get("errors", []):
    print("note:", e)
for label, ok in checks.items():
    print(("ok:   " if ok else "FAIL: ") + label)
a = r.get("tabs", {}).get("A")
said = sorted({d.get("error", "?") for d in r.get("navErrors", []) if d.get("tabId") == a})
print("tab A errors Chrome reported:", ", ".join(said) or "none")
if ("A", "update") in hits:
    print("the rule missed tabs.update: note it in docs/research/06-settings.md; the gate checks navigate's URL first")
if all(checks.values()):
    print("PASS: options open in a tab, and a tab-scoped session rule blocks link, tabs.update and iframe in tab A only")
else:
    sys.exit(1)
EOF

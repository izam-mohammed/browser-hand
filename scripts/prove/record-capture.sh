#!/bin/sh
# Prove a toolbar button (chrome.action, no popup) fires onClicked and takes
# a badge, and that capture-phase listeners see the person's click and typing
# and one debugger click with their ARIA names and isTrusted true, per
# docs/external/chrome-extension-apis.md § chrome.action and
# docs/external/chrome-debugger-cdp.md § isTrusted of CDP input. The steps
# are written as a UserFlow (docs/external/puppeteer-replay.md).
# Source: scripts/prove/record-capture/. Needs a person at Chrome.
#
#   1. In the profile: chrome://extensions, Developer mode on, Load unpacked:
#      scripts/prove/record-capture/extension
#   2. sh scripts/prove/record-capture.sh "Profile 3"
#      then follow the page: the toolbar button, type in Name, click Save.
#      Prints PASS or FAIL, and the UserFlow in target/flow.json.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
src="$here/record-capture"
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
open -na "Google Chrome" --args --profile-directory="$1" "http://127.0.0.1:8765/"

echo "Waiting up to 3 minutes: press the proof's toolbar button, type in Name, click Save."
i=0
until [ -s "$report" ]; do
  i=$((i + 1))
  [ "$i" -gt 360 ] && { echo "FAIL: no report in 3 minutes (is the proof extension loaded in '$1'?)"; exit 1; }
  sleep 0.5
done

python3 -I - "$report" "$target/flow.json" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
if r.get("error"):
    print("FAIL:", r["error"]); sys.exit(1)
steps, meta = r["flow"]["steps"], r["meta"]
json.dump(r["flow"], open(sys.argv[2], "w"), indent=2)

def first(kind, source, name):
    for s, m in zip(steps, meta):
        if s["type"] == kind and m.get("source") == source and any(name in sel[0] for sel in s.get("selectors", [])):
            return s, m
    return None, None

save, save_m = first("click", "person", 'aria/Save[role="button"]')
name, name_m = first("change", "person", 'aria/Name[role="textbox"]')
cdp, cdp_m = first("click", "debugger", 'aria/Debugger target[role="button"]')
checks = {
    "onClicked fired": r.get("onClicked") is True,
    "badge read REC": r.get("badge") == "REC",
    "person's click on Save arrived with its ARIA name": save is not None,
    "person's typing arrived as a change with its ARIA name": name is not None and name.get("value") != "",
    "debugger click arrived with its ARIA name": cdp is not None,
    "all three trusted": all(m and m.get("trusted") for m in (save_m, name_m, cdp_m)),
}
for label, ok in checks.items():
    print(("ok:   " if ok else "FAIL: ") + label)
print("steps:", ", ".join(s["type"] for s in steps))
if cdp_m is not None and not cdp_m.get("trusted"):
    print("the debugger click arrived untrusted: reopen Decision 6 in plans/05-record-steps.md")
if all(checks.values()):
    print("PASS: the toolbar button records trusted steps with ARIA names; UserFlow in", sys.argv[2])
else:
    sys.exit(1)
EOF

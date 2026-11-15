#!/bin/sh
# Prove that a global action.setPopup("") lets a click reach onClicked, that
# the value holds when the service worker stops, the tab navigates and a new
# window opens, that setPopup("popup.html") brings the popup back, and that
# windows.getCurrent() in the popup names the window it opened over, per
# docs/external/chrome-extension-apis.md § chrome.action. Source:
# scripts/prove/action-popup/. Needs a person at Chrome.
#
#   1. In the profile: chrome://extensions, Developer mode on, Load unpacked:
#      scripts/prove/action-popup/extension, and pin it from the puzzle piece.
#   2. sh scripts/prove/action-popup.sh "Profile 3", then in that profile:
#      a. click the proof's icon: a popup opens; press its button
#      b. click the icon again: nothing opens (onClicked fired)
#      c. chrome://serviceworker-internals, Stop the proof's worker
#      d. load any page in the tab, then open a new window (Cmd+N)
#      e. in the new window click the icon: nothing opens (onClicked again)
#      f. click the icon once more: the popup is back and says Done
#      Prints each result, then PASS or FAIL.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
src="$here/action-popup"
target="$src/target"
events="$target/events.jsonl"

case "${1:-}" in
  "" | -*) sed -n '2,19p' "$0"; exit 2 ;;
esac

mkdir -p "$target"
rm -f "$events"
touch "$events"
python3 -I "$src/serve.py" "$events" &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
sleep 0.5
open -na "Google Chrome" --args --profile-directory="$1"

echo "Waiting up to 5 minutes: follow steps a to f from this script's header."
i=0
until grep -q '"kind": "done"' "$events"; do
  i=$((i + 1))
  [ "$i" -gt 600 ] && { echo "FAIL: not done in 5 minutes (is the proof extension loaded and pinned in '$1'?)"; break; }
  sleep 0.5
done

python3 -I - "$events" <<'EOF'
import json, sys
ev = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
kinds = [e["kind"] for e in ev]
opened = [e for e in ev if e["kind"] == "popup_opened"]
clicks = [e for e in ev if e["kind"] == "clicked"]
off = [e for e in ev if e["kind"] == "popup_off"]
on = [e for e in ev if e["kind"] == "popup_on"]
first = clicks[0] if clicks else {}
second = clicks[1] if len(clicks) > 1 else {}
# A wake between the first and second click means the worker was stopped.
woke = [e for e in ev if e["kind"] == "wake" and first and e["at"] > first["at"] and (not second or e["at"] < second["at"])]
lost = [e for e in opened if e.get("clicks") == 1]
checks = {
    "the popup opened first (default_popup)": bool(opened) and opened[0].get("clicks") == 0,
    "windows.getCurrent() in the popup names a window": bool(opened) and isinstance(opened[0].get("windowId"), int),
    'setPopup("") reads back as ""': bool(off) and off[0].get("popup") == "",
    'with the popup "", a click reached onClicked': first.get("n") == 1 and first.get("popup") == "",
    "the worker was stopped and woke again": bool(woke),
    "after the worker stop, a tab load and a new window, a click still reached onClicked": second.get("n") == 2
    and second.get("popup") == ""
    and second.get("windowId") != first.get("windowId"),
    'setPopup("popup.html") reads back': bool(on) and str(on[0].get("popup", "")).endswith("/popup.html"),
    "the next click opened the popup again": "done" in kinds,
}
for label, ok in checks.items():
    print(("ok:   " if ok else "FAIL: ") + label)
if opened and opened[0].get("windowId") != opened[0].get("focusedWindowId"):
    print("note: the popup's window was not the last focused one:", opened[0])
if lost or (woke and woke[0].get("popup") != ""):
    print("note: the global popup value was lost when the worker stopped; the recorder's sync on wake (Phase 2) covers it")
if all(checks.values()):
    print("PASS: a global setPopup switch holds across a worker stop, a tab load and a new window")
else:
    sys.exit(1)
EOF

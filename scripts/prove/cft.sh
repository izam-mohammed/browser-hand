#!/bin/sh
# Start or stop a headless Chrome for Testing on a throwaway user data dir, so
# a proof can run with no person and no real profile (docs/testing.md).
#
#   CFT_CHROME=/path/to/chrome-linux64/chrome \
#     sh scripts/prove/cft.sh start <user-data-dir> <port> <extension-dir> [profile] [url]
#   sh scripts/prove/cft.sh stop <user-data-dir>
#
# Put native messaging host manifests in <user-data-dir>/NativeMessagingHosts/
# before `start`. Chrome for Testing is needed because branded Chrome (reported blocking on 157)
# blocks --load-extension. Drive the page over
# http://127.0.0.1:<port> (the DevTools protocol).
set -eu

cmd=${1:-}
udd=${2:-}
[ -n "$udd" ] || { sed -n '2,11p' "$0"; exit 2; }

# Never a real profile: refuse the places Chrome keeps one.
case "$udd" in
  */google-chrome* | */Google/Chrome* | */chromium* | "$HOME/.config" | "$HOME/.config/") echo "refusing a real Chrome dir: $udd" >&2; exit 2 ;;
esac

case "$cmd" in
  start)
    port=${3:?port}
    ext=${4:?extension dir}
    profile=${5:-Default}
    url=${6:-about:blank}
    [ -x "${CFT_CHROME:-}" ] || { echo "set CFT_CHROME to the Chrome for Testing binary" >&2; exit 2; }
    mkdir -p "$udd/NativeMessagingHosts"
    "$CFT_CHROME" --headless=new --no-sandbox --user-data-dir="$udd" \
      --profile-directory="$profile" --remote-debugging-port="$port" \
      --load-extension="$ext" --no-first-run --no-default-browser-check \
      "$url" >"$udd/chrome.log" 2>&1 &
    echo $! >"$udd/chrome.pid"
    i=0
    until curl -sf "http://127.0.0.1:$port/json/version" >/dev/null; do
      i=$((i + 1))
      [ "$i" -gt 60 ] && { echo "FAIL: no DevTools port in 15 s; see $udd/chrome.log" >&2; exit 1; }
      sleep 0.25
    done
    echo "chrome $(cat "$udd/chrome.pid") on port $port, user data dir $udd" ;;
  stop)
    [ -f "$udd/chrome.pid" ] && kill "$(cat "$udd/chrome.pid")" 2>/dev/null || true
    sleep 1
    # children carry the user data dir in their arguments
    pkill -f -- "--user-data-dir=$udd" 2>/dev/null || true
    rm -f "$udd/chrome.pid"
    echo "stopped" ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac

#!/bin/sh
# Proves the host's Linux launcher: select_profile starts a browser binary with
# --user-data-dir and --profile-directory, the profile is created, and once the
# claim page is open the extension answers and select_profile succeeds
# (plans/14-chrome-parity-2.md, Phase 1). Headless, on a throwaway user data dir.
#
#   CFT_CHROME=/path/to/chrome-linux64/chrome sh scripts/prove/linux-open.sh
#
# Needs: a release or debug host build (host/target/{release,debug}/browser-hand),
# extension/dist (npm --prefix extension run build), curl, node 22+. It never
# touches a real Chrome dir: BROWSER_HAND_CHROME_DIR points everything at a
# temp dir, and cft.sh refuses real ones.
#
# Headless limit: Chrome for Testing ignores a chrome-extension:// URL given on
# the command line (docs/testing.md), so the stand-in binary below keeps the
# claim URL aside and this script opens it over DevTools, as a person's
# Chrome would from the command line. That step is the only stand-in; a real
# Chrome is the person's try-it in the plan.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${BH_BIN:-}
if [ -z "$bin" ]; then
  for c in "$root/host/target/release/browser-hand" "$root/host/target/debug/browser-hand"; do
    [ -x "$c" ] && { bin=$c; break; }
  done
fi
[ -x "$bin" ] || { echo "FAIL: build the host first (cargo build --release --manifest-path host/Cargo.toml)" >&2; exit 2; }
[ -x "${CFT_CHROME:-}" ] || { echo "FAIL: set CFT_CHROME to the Chrome for Testing binary" >&2; exit 2; }
[ -f "$root/extension/dist/manifest.json" ] || { echo "FAIL: build the extension first (npm --prefix extension run build)" >&2; exit 2; }

work=$(mktemp -d -t bh-linux-open.XXXXXX)
udd="$work/udd"
socks=$(mktemp -d /tmp/bhs-XXXXXX)
mkdir -p "$udd" "$work/xdg"
port=$((20000 + $$ % 20000))
mcp_pid=""

cleanup() {
  [ -n "$mcp_pid" ] && kill "$mcp_pid" 2>/dev/null || true
  sh "$root/scripts/prove/cft.sh" stop "$udd" >/dev/null 2>&1 || true
  rm -rf "$work" "$socks"
}
trap cleanup EXIT

fail() { echo "FAIL: $1"; [ -f "$work/mcp.out" ] && grep "\"id\":2" "$work/mcp.out" | head -c 700; echo; exit 1; }

# The stand-in browser binary: records its arguments, keeps the claim URL
# aside, and runs Chrome for Testing headless with the extension loaded.
cat >"$work/browser" <<'EOF'
#!/bin/sh
# Reads BH_WORK, BH_PORT, BH_EXT and CFT_CHROME from the environment the
# launcher passes on.
echo "$@" >"$BH_WORK/args"
n=$#
while [ "$n" -gt 0 ]; do
  a=$1; shift
  case "$a" in
    chrome-extension://*) echo "$a" >"$BH_WORK/claim.url" ;;
    *) set -- "$@" "$a" ;;
  esac
  n=$((n - 1))
done
exec "$CFT_CHROME" --headless=new --no-sandbox --remote-debugging-port="$BH_PORT" \
  --load-extension="$BH_EXT" --no-first-run --no-default-browser-check "$@" about:blank
EOF
export BH_WORK="$work" BH_PORT="$port" BH_EXT="$root/extension/dist" CFT_CHROME
chmod +x "$work/browser"

# Profile "Proof" in Chrome's own Local State, so list and select find it.
printf '%s' '{"profile":{"last_used":"Proof","info_cache":{"Proof":{"name":"Proof"}}}}' >"$udd/Local State"

export BROWSER_HAND_CHROME_DIR="$udd" BROWSER_HAND_SOCKET_DIR="$socks" \
  BROWSER_HAND_BROWSER_BIN="$work/browser" XDG_CONFIG_HOME="$work/xdg"

"$bin" install --no-store >/dev/null
[ -f "$udd/NativeMessagingHosts/dev.browserhand.host.json" ] || fail "install wrote no host manifest in the user data dir"

{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"prove","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"select_profile","arguments":{"profile":"Proof"}}}'
  sleep 60
} | "$bin" mcp >"$work/mcp.out" 2>"$work/mcp.err" &
mcp_pid=$!

# 1. The launcher ran the binary with both flags and the claim URL.
i=0
until [ -f "$work/claim.url" ]; do
  i=$((i + 1)); [ "$i" -gt 100 ] && fail "the launcher never ran the browser binary"
  sleep 0.2
done
grep -q -- "--user-data-dir=$udd" "$work/args" || fail "no --user-data-dir in: $(cat "$work/args")"
grep -q -- '--profile-directory=Proof' "$work/args" || fail "no --profile-directory in: $(cat "$work/args")"
claim=$(cat "$work/claim.url")

# 2. Chrome came up (the DevTools port answers) on that profile.
i=0
until curl -sf "http://127.0.0.1:$port/json/version" >/dev/null; do
  i=$((i + 1)); [ "$i" -gt 80 ] && fail "no DevTools port; see $udd/chrome.log"
  sleep 0.25
done
# Chrome records the browser's own pid under the user data dir.
[ -d "$udd/Proof" ] || sleep 2
[ -d "$udd/Proof" ] || fail "Chrome made no Proof profile dir in $udd"

# 3. The claim URL, opened over DevTools, reaches the extension and the host
# answers select_profile.
node -e '
const [port, url] = process.argv.slice(1);
(async () => {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url } }));
  await new Promise((r) => (ws.onmessage = r));
  ws.close();
})();
' "$port" "$claim" || fail "could not open the claim URL over DevTools"

i=0
until grep -q '"id":2' "$work/mcp.out" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 150 ] && fail "select_profile did not answer"
  sleep 0.2
done
grep '"id":2' "$work/mcp.out" | grep -q 'selected' || fail "select_profile refused"
grep '"id":2' "$work/mcp.out" | grep -q '"isError":true' && fail "select_profile errored"

echo "PASS: the Linux launcher started a browser on a throwaway profile and select_profile reached its extension"

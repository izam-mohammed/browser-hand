#!/bin/sh
# Proves that two browsers holding a profile named Default are told apart
# (plans/15-browser-identity.md): the native host reads its parent process's
# --user-data-dir, says which browser it runs in on its hello, and the MCP
# server counts each host for its own browser only.
#
#   CFT_CHROME=/path/to/chrome-linux64/chrome sh scripts/prove/browser-identity.sh
#
# Two Chrome for Testing instances stand in for two browsers: one on
# <home>/.config/microsoft-edge, one on <home>/.config/BraveSoftware/Brave-Browser,
# under a throwaway HOME, so the host's table finds both. They run the same
# binary, so only the user data dir can tell them apart. What this cannot
# prove: the binary-name rule on a real Brave, Edge or Vivaldi, and macOS
# (`proc_pidpath`); those are a person's check.
#
# Needs: a host build (host/target/{release,debug}/browser-hand),
# extension/dist, curl, node 22+. Never touches a real Chrome dir: HOME,
# XDG_CONFIG_HOME and the socket dir are all temporary.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
bin=${BH_BIN:-}
if [ -z "$bin" ]; then
  for c in "$root/host/target/release/browser-hand" "$root/host/target/debug/browser-hand"; do
    [ -x "$c" ] && { bin=$c; break; }
  done
fi
[ -x "$bin" ] || { echo "FAIL: build the host first (cargo build --manifest-path host/Cargo.toml)" >&2; exit 2; }
[ -x "${CFT_CHROME:-}" ] || { echo "FAIL: set CFT_CHROME to the Chrome for Testing binary" >&2; exit 2; }
[ -f "$root/extension/dist/manifest.json" ] || { echo "FAIL: build the extension first (npm --prefix extension run build)" >&2; exit 2; }

ext_id=$(grep -o 'EXTENSION_ID: &str = "[a-p]*"' "$root/host/src/mcp.rs" | grep -o '"[a-p]*"' | tr -d '"')
[ -n "$ext_id" ] || { echo "FAIL: no EXTENSION_ID in host/src/mcp.rs" >&2; exit 2; }

work=$(mktemp -d -t bh-identity.XXXXXX)
socks=$(mktemp -d /tmp/bhs-XXXXXX)
home="$work/home"
edge="$home/.config/microsoft-edge"
brave="$home/.config/BraveSoftware/Brave-Browser"
mkdir -p "$edge" "$brave" "$work/xdg"
port_edge=$((20000 + $$ % 10000))
port_brave=$((port_edge + 1))

cleanup() {
  sh "$root/scripts/prove/cft.sh" stop "$edge" >/dev/null 2>&1 || true
  sh "$root/scripts/prove/cft.sh" stop "$brave" >/dev/null 2>&1 || true
  rm -rf "$work" "$socks"
}
trap cleanup EXIT
fail() { echo "FAIL: $1"; exit 1; }

# Each browser's own Local State names its Default profile.
printf '%s' '{"profile":{"last_used":"Default","info_cache":{"Default":{"name":"Edge me"}}}}' >"$edge/Local State"
printf '%s' '{"profile":{"last_used":"Default","info_cache":{"Default":{"name":"Brave me"}}}}' >"$brave/Local State"

# The host Chrome starts, and the MCP server below, see the same environment.
# BROWSER_HAND_CHROME_DIR stays unset so the host's table finds both dirs.
unset BROWSER_HAND_CHROME_DIR
export HOME="$home" XDG_CONFIG_HOME="$work/xdg" BROWSER_HAND_SOCKET_DIR="$socks"
for d in "$edge" "$brave"; do
  BROWSER_HAND_CHROME_DIR="$d" "$bin" install --no-store >/dev/null
  [ -f "$d/NativeMessagingHosts/dev.browserhand.host.json" ] || fail "no host manifest in $d"
done

sh "$root/scripts/prove/cft.sh" start "$edge" "$port_edge" "$root/extension/dist" Default >/dev/null
sh "$root/scripts/prove/cft.sh" start "$brave" "$port_brave" "$root/extension/dist" Default >/dev/null

# Opens the claim page in one browser, as select_profile's launch would.
claim() {
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
' "$1" "chrome-extension://$ext_id/claim.html#dir=Default&nonce=$2"
}
claim "$port_edge" e1 || fail "could not open the claim page in the edge stand-in"
claim "$port_brave" b1 || fail "could not open the claim page in the brave stand-in"

# list_profiles through the MCP server; prints "<id>=<connected>[!warn]" lines.
list() {
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"prove","version":"0"}}}'
    printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_profiles","arguments":{}}}'
    sleep 3
  } | "$bin" mcp 2>/dev/null | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const line = s.split("\n").find((l) => l.includes("\"id\":2"));
  if (!line) return;
  const v = JSON.parse(JSON.parse(line).result.content[0].text);
  for (const p of v.profiles) console.log(`${p.dir}=${p.connected}${p.warning ? "!warn" : ""}`);
});'
}

# 1. Both hosts answer Default, each counted once for its own browser.
want="brave:Default=true
edge:Default=true"
i=0
while :; do
  got=$(list | sort)
  [ "$got" = "$want" ] && break
  i=$((i + 1))
  [ "$i" -gt 12 ] && fail "with both browsers up, list_profiles said: $(echo "$got" | tr '\n' ' ') (wanted $(echo "$want" | tr '\n' ' '))"
  sleep 1
done

# 2. One browser quits: only its Default stops being connected.
sh "$root/scripts/prove/cft.sh" stop "$brave" >/dev/null
i=0
want="brave:Default=false
edge:Default=true"
while :; do
  got=$(list | sort)
  [ "$got" = "$want" ] && break
  i=$((i + 1))
  [ "$i" -gt 12 ] && fail "after the brave stand-in quit, list_profiles said: $(echo "$got" | tr '\n' ' ')"
  sleep 1
done

echo "PASS: two browsers with a Default profile were told apart by the host's own hello, and one quitting left the other connected"

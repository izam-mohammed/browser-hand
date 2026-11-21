#!/bin/sh
# Headless walk of the real tools on Linux: select_profile, tabs, navigate,
# read_page, form_input, click, drag, screenshot, a token hidden in the network
# read, a big get_page_text, a refused .env upload, and a worker stop mid-session.
# Prints one line per check and WALK PASS or WALK FAIL. Throwaway profile only.
#   CFT_CHROME=<chrome binary> sh .claude/skills/test-extension-linux/scripts/walk.sh
# Needs the host build (host/target/release/browser-hand), extension/dist, node 22+.
set -eu
SP=$(cd "$(dirname "$0")" && pwd)

root=$(cd "$(dirname "$0")/../../../.." && pwd)
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
echo "$bin" >"$work/binpath"
export WORK="$work" BIN="$bin" UDD="$udd" PORT="$port"
node "$SP/walk.mjs"

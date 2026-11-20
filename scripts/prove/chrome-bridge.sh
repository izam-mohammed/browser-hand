#!/bin/sh
# Prove a Chrome extension reaches a native host in each profile, and that a
# claim URL launched with --profile-directory lands in that profile, per
# docs/external/chrome-native-messaging.md and
# docs/external/chrome-profiles-and-launch.md. Source: scripts/prove/chrome-bridge/.
#
#   sh scripts/prove/chrome-bridge.sh --install
#       build the echo host, install its manifest, print what to load
#   sh scripts/prove/chrome-bridge.sh "Default" "Profile 3"
#       claim each profile, print PASS or FAIL, remove the manifest
#   sh scripts/prove/chrome-bridge.sh --uninstall
#       remove the manifest only
set -eu

here=$(cd "$(dirname "$0")" && pwd)
src="$here/chrome-bridge"
target="$src/target"
bin="$target/echo-host"
log="$target/claims.log"
host_name="dev.browserhand.prove"
manifest_dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
manifest="$manifest_dir/$host_name.json"

# Extension ID from the manifest's public key: first 16 bytes of SHA-256,
# hex digits mapped 0-f to a-p (docs/external/chrome-extension-apis.md
# § Manifest `key`).
key=$(sed -n 's/.*"key": *"\([^"]*\)".*/\1/p' "$src/extension/manifest.json")
ext_id=$(printf '%s' "$key" | base64 -d | openssl dgst -sha256 -binary \
  | xxd -p | tr -d '\n' | cut -c1-32 | tr '0-9a-f' 'a-p')

uninstall() { rm -f "$manifest"; }

install() {
  mkdir -p "$target" "$manifest_dir"
  rustc -O "$src/host/src/main.rs" -o "$bin"
  cat >"$manifest" <<EOF
{
  "name": "$host_name",
  "description": "browser-hand bridge proof (remove after the proof)",
  "path": "$bin",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ext_id/"]
}
EOF
  echo "Installed $manifest"
  echo "Extension ID: $ext_id"
  echo "Now in each profile you want to test: chrome://extensions, Developer"
  echo "mode on, Load unpacked: $src/extension"
}

case "${1:-}" in
  --install) install; exit 0 ;;
  --uninstall) uninstall; echo "Removed $manifest"; exit 0 ;;
  "" | -*) sed -n '2,14p' "$0"; exit 2 ;;
esac

[ -x "$bin" ] && [ -f "$manifest" ] || { echo "FAIL: run with --install first"; exit 2; }
[ $# -ge 2 ] || { echo "FAIL: name at least two profile dirs"; exit 2; }
trap uninstall EXIT
: >"$log"

fails=0
for dir in "$@"; do
  nonce=$(openssl rand -hex 8)
  enc=$(printf '%s' "$dir" | sed 's/ /%20/g')
  open -na "Google Chrome" --args --profile-directory="$dir" \
    "chrome-extension://$ext_id/claim.html#dir=$enc&nonce=$nonce"
  want="\"profileDir\":\"$dir\",\"nonce\":\"$nonce\""
  i=0
  until grep -qF "$want" "$log"; do
    i=$((i + 1))
    if [ "$i" -gt 30 ]; then
      echo "FAIL: no claim from '$dir' in 15 s (is the extension loaded there?)"
      fails=$((fails + 1))
      break
    fi
    sleep 0.5
  done
  [ "$i" -le 30 ] && echo "ok: '$dir' claimed with nonce $nonce"
done

grep -qF "\"origin\":\"chrome-extension://$ext_id/\"" "$log" \
  || { echo "FAIL: host never saw the extension origin"; fails=$((fails + 1)); }
pids=$(grep -c '"type":"started"' "$log" || true)
echo "host processes started during the run: $pids"

if [ "$fails" -eq 0 ]; then
  echo "PASS: native port reached and $# profiles claimed by launch URL"
else
  exit 1
fi

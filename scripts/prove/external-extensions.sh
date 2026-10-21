#!/bin/sh
# Prove that one per-user External Extensions file offers a store extension
# in every Chrome profile, per docs/external/chrome-extension-distribution.md
# § External Extensions file, per user (plans/07-install-extension.md,
# Phase 1). Needs a person at Chrome.
#
#   sh scripts/prove/external-extensions.sh <store id>
#
# Pick a public Chrome Web Store extension that no profile has yet. The file
# is removed when the script ends; an extension the person enabled stays and
# is removed from chrome://extensions as usual.
set -eu

id=${1:-}
case "$id" in
  [a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p]) ;;
  *) echo "usage: sh scripts/prove/external-extensions.sh <32 letter store id, a to p>" >&2; exit 2 ;;
esac

chrome="$HOME/Library/Application Support/Google/Chrome"
for d in "$chrome"/Default "$chrome"/Profile\ *; do
  if [ -d "$d/Extensions/$id" ]; then
    echo "FAIL: $(basename "$d") already has $id; pick an extension no profile has" >&2
    exit 1
  fi
done

dir="$chrome/External Extensions"
file="$dir/$id.json"
mkdir -p "$dir"
trap 'rm -f "$file"; echo "Removed $file"' EXIT
printf '{\n  "external_update_url": "https://clients2.google.com/service/update2/crx"\n}\n' > "$file"
echo "Wrote $file"
echo
echo "1. Quit Chrome fully (Cmd+Q) and open it again."
echo "2. Open two profiles. In each, look for an \"extension added\" prompt"
echo "   (the menu's badge, or chrome://extensions)."
echo

ask() {
  printf '%s [y/n] ' "$1"
  read -r a
  [ "$a" = y ] || [ "$a" = Y ]
}
ok=1
ask "Did the first profile offer to enable it?" || ok=0
ask "Did the second profile offer it too?" || ok=0
printf 'What did the prompt say, in a few words? '
read -r said
echo "Prompt: $said"

if [ "$ok" = 1 ]; then echo PASS; else echo "FAIL: a profile showed no prompt"; exit 1; fi

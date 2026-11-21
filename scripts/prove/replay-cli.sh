#!/bin/sh
# Proves replay-cli in a real Chrome for Testing (plans/17, see the .mjs beside it),
# headless on a throwaway profile: no person, no real profile.
#
#   CFT_CHROME=/path/to/chrome-linux64/chrome sh scripts/prove/replay-cli.sh
#
# Needs a host build and extension/dist (make build), node 22+.
exec node "$(dirname "$0")/replay-cli.mjs"

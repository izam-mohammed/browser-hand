#!/bin/sh
# Proves `wait_for` in a real Chrome for Testing (plans/17, Phase 1), headless
# on a throwaway profile: no person, no real profile.
#
#   CFT_CHROME=/path/to/chrome-linux64/chrome sh scripts/prove/wait-for.sh
#
# Needs a host build and extension/dist (make build), node 22+.
exec node "$(dirname "$0")/wait-for.mjs"

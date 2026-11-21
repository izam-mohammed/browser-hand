#!/bin/sh
# Proves audit-log in a real Chrome for Testing (plans/17, see the .mjs beside it),
# headless on a throwaway profile: no person, no real profile.
#
#   CFT_CHROME=/path/to/chrome-linux64/chrome sh scripts/prove/audit-log.sh
#
# Needs a host build and extension/dist (make build), node 22+.
exec node "$(dirname "$0")/audit-log.mjs"

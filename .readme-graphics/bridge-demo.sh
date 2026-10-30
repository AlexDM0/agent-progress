#!/usr/bin/env bash
# Starts this checkout's Overseer on the seeded demo board with the fake agent adapter, lets it launch jobs and raise
# an incident, records an intake, then shoots each view of the Bridge it serves and stops it again.
set -euo pipefail

# Usage: bridge-demo.sh <work folder seed-demo.sh filled> <shots folder>
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_CHECKOUT="$(cd "$HERE/.." && pwd)"
WORK="$(cd "${1:?usage: bridge-demo.sh <work folder> <shots folder>}" && pwd -P)"
SHOTS="${2:?usage: bridge-demo.sh <work folder> <shots folder>}"
REPOSITORY="$WORK/example-storefront"
SETTLE_SECONDS=20
export TZ="Europe/Amsterdam"
unset AGENT_PROGRESS_ROOT AGENT_PROGRESS_V2_ROOT
# The same scratch home seed-demo.sh used: no live board, real registry or real Watcher socket is reached.
# Chrome keeps the user's home: under a fresh one, headless Chrome stalled before its first screenshot.
USER_HOME="$HOME"
export HOME="$WORK/home"
# Every session the Overseer launches is the scripted fake agent, never a vendor's CLI.
export AGENT_PROGRESS_FAKE_AGENT=1 AGENT_PROGRESS_V2_FAKE_AGENT=1
[[ -d "$HOME" && -d "$REPOSITORY" ]] || { echo "Run seed-demo.sh $WORK first" >&2; exit 1; }

cd "$REPOSITORY"
cli() { bun "$TOOL_CHECKOUT/agent-progress.ts" "$@"; }

BRIDGE_URL="$(cli run --port 0 --detach --json | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p')"
[[ -n "$BRIDGE_URL" ]] || { echo "The Overseer printed no URL" >&2; exit 1; }
trap 'cli run stop --now > /dev/null 2>&1 || true' EXIT
cli run resume > /dev/null
cli intake -- "Customers want a wish list on product pages" > /dev/null
sleep "$SETTLE_SECONDS"

mkdir -p "$SHOTS"
SHOTS="$(cd "$SHOTS" && pwd -P)"
# Each view's own query string makes every shot a fresh document, so the load event fires after a hash change too.
shot() {
  local name="$1" route="$2" scheme="$3"
  printf '{"url":"%s?shot=%s#%s","width":1440,"height":900,"colorScheme":"%s","waitMilliseconds":1500,"output":"%s/%s.png"}' \
    "$BRIDGE_URL" "$name" "$route" "$scheme" "$SHOTS" "$name"
}
{
  printf '[\n'
  shot bridge-kanban kanban light; printf ',\n'
  shot bridge-kanban-dark kanban dark; printf ',\n'
  shot bridge-merge-queue kanban/merge-queue light; printf ',\n'
  shot bridge-progress progress light; printf ',\n'
  shot bridge-tickets tickets/012 light; printf ',\n'
  shot bridge-agents agents light; printf ',\n'
  shot bridge-questions questions light; printf ',\n'
  shot bridge-assistant assistant light; printf ',\n'
  shot bridge-intake intake light; printf '\n]\n'
} > "$SHOTS/bridge-jobs.json"
HOME="$USER_HOME" bun "$HERE/shoot.js" "$SHOTS/bridge-jobs.json"
# What the shots' header should say: the scripted crashes open an outage, which pauses the board again after the resume.
cli run status > "$SHOTS/run-status.txt"

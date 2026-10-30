#!/usr/bin/env bash
# Files the synthetic "Example Storefront" board through this checkout's CLI, with its clock pinned to the story
# time: two epics and sixteen tickets whose dependencies give the Bridge its waves. Every move after filing is the
# Overseer's, which `bridge-demo.sh` starts on this board with the fake agent adapter.
set -euo pipefail

# Usage: seed-demo.sh <work folder outside this checkout>
# The demo repository is built in the work folder: `init` refuses to create a tracker below another one,
# and a demo inside this checkout would sit below this repository's own tracker.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_CHECKOUT="$(cd "$HERE/.." && pwd)"
WORK="${1:?usage: seed-demo.sh <work folder>}"
BODIES="$HERE/demo-bodies"
STORY_DAY="2026-09-24"
STORY_OFFSET="+02:00"
export TZ="Europe/Amsterdam"
unset AGENT_PROGRESS_ROOT AGENT_PROGRESS_V2_ROOT

# The work folder must already exist, so the check below compares real, resolved paths.
[[ -d "$WORK" ]] || { echo "The work folder does not exist: $WORK" >&2; exit 1; }
WORK="$(cd "$WORK" && pwd -P)"
case "$WORK/" in
  "$(cd "$TOOL_CHECKOUT" && pwd -P)/"*) echo "The work folder must lie outside $TOOL_CHECKOUT" >&2; exit 1 ;;
esac
REPOSITORY="$WORK/example-storefront"
# A home of its own keeps the monitor registry, the Watcher sockets and the agent transcripts off the real ones.
export HOME="$WORK/home"
mkdir -p "$HOME"

rm -rf "$REPOSITORY"
mkdir -p "$REPOSITORY"
cd "$REPOSITORY"

STORY_CLOCK=""
at() { STORY_CLOCK="${STORY_DAY}T$1:00${STORY_OFFSET}"; }
tracker() { STORY_CLOCK="$STORY_CLOCK" bun --preload "$HERE/freeze-clock.js" "$TOOL_CHECKOUT/agent-progress.ts" "$@" > /dev/null; }
git_at() { GIT_AUTHOR_DATE="$STORY_CLOCK" GIT_COMMITTER_DATE="$STORY_CLOCK" git "$@"; }

git init -q -b main
git config user.name "Alex Example"
git config user.email "alex@example.com"
git config commit.gpgsign false
git config tag.gpgsign false
at 08:58
printf '# Example Storefront\n' > README.md
git_at add README.md && git_at commit -q -m "Initial commit"
tracker init --project "Example Storefront"
git_at add -A && git_at commit -q -m "Adopt agent-progress"

at 09:01
tracker epic add checkout-redesign "Checkout redesign" --body "One page from basket to payment, with saved cards and an express button."
tracker epic add customer-account "Customer account" --body "Account pages customers come back to: dark mode, safer resets, order history."
at 09:02; tracker ticket add "Gift card ignored" --type bug --priority high --group checkout --epic checkout-redesign --body-file "$BODIES/001.md"
at 09:04; tracker ticket add "Orders CSV export" --type ticket --group admin --body-file "$BODIES/002.md"
at 09:06; tracker ticket add "Accent-blind search" --type bug --group search --body-file "$BODIES/003.md"
at 09:08; tracker ticket add "Account pages dark mode" --type ticket --group account --epic customer-account --body-file "$BODIES/004.md"
at 09:09; tracker ticket add "Delivery ETA" --type ticket --group product --depends-on 4 --body-file "$BODIES/005.md"
at 09:10; tracker ticket add "Replace carousel" --type ticket --group product --body-file "$BODIES/006.md"
at 09:12; tracker concurrency 3
at 10:52; tracker ticket add "Gift-card field accepts spaces the API then rejects" --type bug --priority low --group checkout --epic checkout-redesign --body-file "$BODIES/007.md"
at 11:30; tracker ticket add "Rate-limit resets" --type ticket --priority high --group auth --epic customer-account --body-file "$BODIES/008.md"
at 11:52; tracker ticket add "CSV export writes dates in UTC instead of the shop's time zone" --type bug --priority low --group admin --body-file "$BODIES/009.md"
at 12:48; tracker ticket add "Stale basket badge" --type bug --group basket --body-file "$BODIES/010.md"
at 11:15; tracker ticket abandon 6 --reason "The redesign removes the carousel; nothing left to replace"

# Two chains (#004 and #008 → #011) meeting in a one-ticket wave (#012), which frees a ticket in each epic,
# and #016 ready beside them (the low tickets wait while normal work is pending).
at 13:31
tracker ticket add "Saved payment methods" --type ticket --group checkout --epic checkout-redesign --depends-on 8 --body-file "$BODIES/011.md"
tracker ticket add "One-page checkout" --type ticket --group checkout --epic checkout-redesign --depends-on 1,4,11 --body-file "$BODIES/012.md"
tracker ticket add "Express checkout button" --type ticket --priority low --group checkout --epic checkout-redesign --depends-on 12 --body-file "$BODIES/013.md"
tracker ticket add "Reorder from order history" --type ticket --priority low --group account --epic customer-account --depends-on 12 --body-file "$BODIES/014.md"
tracker ticket add "Search suggestions" --type ticket --priority low --group search --depends-on 3 --body-file "$BODIES/015.md"
tracker ticket add "Size guide on product pages" --type ticket --group product --body-file "$BODIES/016.md"
# Filed tickets start as drafts; #009 and #015 stay drafts for the Intake view.
at 13:33; tracker ticket ready 1 2 3 4 5 7 8 10 11 12 13 14 16
tracker checks "true"

echo "seeded Example Storefront in $REPOSITORY"

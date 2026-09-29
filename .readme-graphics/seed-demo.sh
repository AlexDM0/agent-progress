#!/usr/bin/env bash
# Replays one synthetic board day for "Example Storefront" through the real CLI, with its clock pinned
# to the story time, and snapshots progress.html after every step for the animated preview.
set -euo pipefail

# Usage: seed-demo.sh <work folder outside this checkout> <snapshots folder>
# The demo repository is built in the work folder: `init` refuses to create a tracker below another one,
# and a demo inside this checkout would sit below this repository's own tracker.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_CHECKOUT="$(cd "$HERE/.." && pwd)"
WORK="${1:?usage: seed-demo.sh <work folder> <snapshots folder>}"
SNAPSHOTS="${2:?usage: seed-demo.sh <work folder> <snapshots folder>}"
BODIES="$HERE/demo-bodies"
STORY_DAY="2026-09-24"
STORY_OFFSET="+02:00"
export TZ="Europe/Amsterdam"
unset AGENT_PROGRESS_ROOT

# The work folder must already exist, so the check below compares real, resolved paths.
[[ -d "$WORK" ]] || { echo "The work folder does not exist: $WORK" >&2; exit 1; }
WORK="$(cd "$WORK" && pwd -P)"
case "$WORK/" in
  "$(cd "$TOOL_CHECKOUT" && pwd -P)/"*) echo "The work folder must lie outside $TOOL_CHECKOUT" >&2; exit 1 ;;
esac
REPOSITORY="$WORK/example-storefront"

mkdir -p "$SNAPSHOTS"
SNAPSHOTS="$(cd "$SNAPSHOTS" && pwd -P)"
rm -f "$SNAPSHOTS"/*.html
rm -rf "$REPOSITORY"
mkdir -p "$REPOSITORY"
cd "$REPOSITORY"

STORY_CLOCK=""
at() { STORY_CLOCK="${STORY_DAY}T$1:00${STORY_OFFSET}"; }
tracker() { STORY_CLOCK="$STORY_CLOCK" bun --preload "$HERE/freeze-clock.js" "$TOOL_CHECKOUT/agent-progress.ts" "$@" > /dev/null; }
snapshot() { cp .agent-progress/progress.html "$SNAPSHOTS/${STORY_CLOCK:11:2}${STORY_CLOCK:14:2}.html"; }
git_at() { GIT_AUTHOR_DATE="$STORY_CLOCK" GIT_COMMITTER_DATE="$STORY_CLOCK" git "$@"; }

# A builder's branch: a worktree off main with one commit touching the named file.
build_branch() {
  local ticket_identifier="$1" file_path="$2" message="$3"
  local worktree="$REPOSITORY/.claude/worktrees/ticket-$ticket_identifier"
  git_at worktree add -q "$worktree" -b "ticket-$ticket_identifier" main
  mkdir -p "$worktree/$(dirname "$file_path")"
  printf '// %s\n' "$message" > "$worktree/$file_path"
  git_at -C "$worktree" add "$file_path"
  git_at -C "$worktree" commit -q -m "$message"
}

release_branch() {
  local ticket_identifier="$1"
  git_at -C "$REPOSITORY/.claude/worktrees/ticket-$ticket_identifier" rebase -q main
  tracker release "$ticket_identifier" --branch "ticket-$ticket_identifier" --worktree "$REPOSITORY/.claude/worktrees/ticket-$ticket_identifier" --main main
}

# What an agent writes into its ticket file by hand: the builder's Handoff, a reviewer's Review.
append_to_ticket() {
  local ticket_identifier="$1" part="$2"
  cat "$BODIES/$ticket_identifier.$part.md" >> .agent-progress/tickets/"$ticket_identifier"-*.md
}

agent_stopped() {
  local agent_identifier="$1" calls="$2" end_context="$3" input="$4" cache_read="$5" output="$6"
  tracker log "Agent $agent_identifier (agent-progress-worker) stopped: $calls calls, end context $end_context, input $input (cache read $cache_read), output $output"
}

git init -q -b main
git config user.name "Alex Example"
git config user.email "alex@example.com"
git config commit.gpgsign false
git config tag.gpgsign false
at 08:58
printf '# Example Storefront\n' > README.md
git_at add README.md && git_at commit -q -m "Initial commit"
tracker init --project "Example Storefront"
printf '.claude/worktrees/\n' >> .gitignore
git_at add -A && git_at commit -q -m "Adopt agent-progress"

at 09:00; tracker range --from "${STORY_DAY}T09:00:00${STORY_OFFSET}" --to "${STORY_DAY}T14:00:00${STORY_OFFSET}"
at 09:02; tracker ticket add "Gift card ignored" --type bug --priority high --group checkout --body-file "$BODIES/001.md"
at 09:04; tracker ticket add "Orders CSV export" --type feature --group admin --body-file "$BODIES/002.md"
at 09:06; tracker ticket add "Accent-blind search" --type bug --group search --body-file "$BODIES/003.md"
at 09:08; tracker ticket add "Account pages dark mode" --type feature --group account --body-file "$BODIES/004.md"
at 09:09; tracker ticket add "Delivery ETA" --type feature --group product --depends-on 4 --body-file "$BODIES/005.md"
at 09:10; tracker ticket add "Replace carousel" --type change --group product --body-file "$BODIES/006.md"
snapshot
at 09:12; tracker concurrency 3
at 09:13; tracker dispatcher running --run wf_example-0001
snapshot

at 09:15
tracker ticket claim 1 --owner opus --note "Built by the dispatcher on ticket-001"
tracker ticket claim 2 --owner opus --note "Built by the dispatcher on ticket-002"
tracker ticket claim 3 --owner opus --note "Built by the dispatcher on ticket-003"
snapshot

at 10:22
build_branch 001 src/checkout/Total.ts "Subtract the applied gift card before charging"
append_to_ticket 001 handoff
tracker ticket finish 1 --start-review --owner opus --note "Review 1 by a fresh agent"
agent_stopped a41c9e07 58 96.2k 2.4m 2.2m 31.7k
tracker task update 1 --tokens 2.4m
snapshot

at 10:48
build_branch 002 src/admin/export/OrdersCsv.ts "Stream the filtered orders list as CSV"
append_to_ticket 002 handoff
tracker ticket finish 2 --start-review --owner opus --note "Review 1 by a fresh agent"
agent_stopped b83f2d15 71 118k 3.1m 2.9m 42.3k
tracker task update 2 --tokens 3.1m
snapshot

at 10:52; tracker ticket add "Gift-card field accepts spaces the API then rejects" --type bug --priority low --group checkout --body-file "$BODIES/007.md"
at 10:58
append_to_ticket 001 review1
release_branch 001
agent_stopped c02e7a93 34 71.5k 1.1m 1.0m 12.9k
tracker task update 7 --tokens 1.1m
snapshot

at 11:00; tracker ticket claim 4 --owner opus --note "Built by the dispatcher on ticket-004"
snapshot
at 11:15; tracker ticket abandon 6 --reason "The redesign removes the carousel; nothing left to replace"
snapshot
at 11:30; tracker ticket add "Rate-limit resets" --type change --priority high --group auth --body-file "$BODIES/008.md"
snapshot

at 11:34
append_to_ticket 002 review1
tracker ticket rereview 2 --start-review --owner opus --note "Round 2: the first pass reworked 912 lines"
agent_stopped d5b0c4e8 46 88.1k 1.6m 1.5m 24.4k
tracker task update 8 --tokens 1.6m
snapshot

at 11:52; tracker ticket add "CSV export writes dates in UTC instead of the shop's time zone" --type bug --priority low --group admin --body-file "$BODIES/009.md"
at 12:10
append_to_ticket 002 review2
release_branch 002
agent_stopped e7a19f30 29 64.0k 0.9m 0.8m 10.2k
tracker task update 10 --tokens 900k
snapshot

at 12:11; tracker ticket claim 8 --owner opus --note "Built by the dispatcher on ticket-008"
snapshot

at 12:20
build_branch 003 src/search/Normalise.ts "Fold accents before matching"
append_to_ticket 003 handoff
tracker ticket finish 3 --start-review --owner opus --note "Review 1 by a fresh agent"
agent_stopped f1c6d2a4 83 131k 4.2m 4.0m 51.8k
tracker task update 3 --tokens 4.2m
snapshot

at 12:48; tracker ticket add "Stale basket badge" --type bug --group basket --body-file "$BODIES/010.md"
snapshot

at 13:05
build_branch 008 src/auth/PasswordReset.ts "Limit reset requests per address and per IP"
append_to_ticket 008 handoff
tracker ticket finish 8 --start-review --owner opus --note "Review 1 by a fresh agent"
agent_stopped 9a2b7c61 44 83.7k 1.8m 1.7m 22.6k
tracker task update 9 --tokens 1.8m
snapshot

at 13:28
append_to_ticket 003 review1
tracker ticket approve 3 --branch ticket-003
agent_stopped 0c8e5f12 31 69.2k 1.2m 1.1m 13.4k
tracker task update 11 --tokens 1.2m
snapshot

at 13:29; tracker ticket claim 10 --owner opus --note "Built by the dispatcher on ticket-010"
snapshot
at 13:36; tracker log "Release of #003 waits: main moved, the reviewer is rebasing ticket-003"
snapshot

echo "seeded Example Storefront: $(ls "$SNAPSHOTS" | wc -l | tr -d " ") snapshots in $SNAPSHOTS"

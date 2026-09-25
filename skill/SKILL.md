---
name: agent-progress
description: >-
  Track work with the agent-progress CLI: tasks as rows on a Gantt chart,
  stateful markdown tickets, a log, and a self-contained dashboard the user
  watches while you work. Use this skill whenever the user asks for progress
  tracking, a Gantt chart, a ticket or a bug filed, says "track this work",
  "keep me posted" or "what is the status", whenever a repository holds a
  `.agent-progress/` directory, and whenever you are asked to adopt the tracker
  with `agent-progress init`.
---

# agent-progress — tasks, tickets and a Gantt dashboard for one repository

`agent-progress` is a globally linked CLI that gives the work a place to be recorded, and gives the
person watching a page that shows it. It stores a tracker per repository, regenerates a
self-contained `progress.html` on every mutating command, and that page reloads itself every 5
minutes — so the user opens it once and then simply watches the work happen.

You drive it entirely through commands. There is no file to edit by hand and no format to remember
beyond a ticket's body.

**Running the board yourself — taking ticket requests, running the dispatcher workflow that builds
and reviews them, and keeping the chart current — is the `agent-progress-orchestrate` skill.** This one is what any session needs in
order to file a ticket, move one, and stay out of the tool's way.

## The mental model

- **One tracker per repository, shared by every worktree of it.** The root is found with
  `git rev-parse --git-common-dir`, so a subagent running in `.claude/worktrees/some-branch` writes
  into the *main* checkout's `.agent-progress/`. Outside a git repository the current directory is
  the root; the `AGENT_PROGRESS_ROOT` environment variable overrides the discovery for any command
  run from somewhere else entirely, a scratch tracker included. `--root <path>` is `init`'s own flag,
  naming the directory to adopt, and every other command refuses it.
- **A task is a row on the Gantt chart** — a name, an owner, a note, a status, two timestamps and an
  optional token count. Row ids are never reused, so a log line naming task #4 means the same work
  tomorrow. Where the `SubagentStop` hook is installed, a subagent whose brief carries the line
  `agent-progress row: 4` (or `4, 7` for a bundle) has what it processed **added** to that row when
  it stops — so a move that ends such a row takes no `--tokens`, which would overwrite the sum.
- **Every ticket owns a row too.** Filing a ticket creates its row as `pending`, except a low one,
  which gets its row when it is started or claimed; moving the ticket moves the row and stamps both.
  You never keep the two in step yourself.
- **The log** is the narrative under the chart: one line per milestone, newest first on the page.
- **The dashboard** is `.agent-progress/progress.html`, written fresh by every command that changes
  anything, with tabs **Progress** · **Kanban** · **Tickets**: the Kanban board sits beside the
  Tickets tab, not in place of it. One file, no network dependency.

## In a session

1. **Open with `agent-progress status --json`** — the working view: every row and ticket that is not
   delivered or abandoned, the last 10 log entries, and an `omitted` count of what it left out.
   `--full` when you need a settled row or the whole log. Exit 1 saying there is no tracker means
   this repository has not adopted one; **do not create it uninvited**.
2. **File a ticket for every bug, change or feature the user reports**, whether or not you fix it in
   the same breath — a ticket is how the work is still there tomorrow:

   ```
   agent-progress ticket add "Double-click a role to edit it" --type change --body-file - <<'BODY'
   ## Report
   What the user saw, in their words.

   ## Wanted
   The behaviour they asked for.

   ## Acceptance
   What has to be true before this is done.
   BODY
   ```

3. **Move it as the work moves**: `ticket start`, `ticket review`, `ticket done`, `ticket deliver`,
   `ticket abandon --reason "<why>"`. Each verb only moves a ticket that is in a status it makes
   sense from, and a move to the status it already has is refused with exit 1. When one ticket can
   only be done after another, record it: `ticket depends 5 3`.
4. **`agent-progress log "<text>"` at each milestone** — a decision taken, a direction abandoned.
   The log is what makes the chart readable a day later.
5. **`agent-progress open` once per session**, so the user has the dashboard in front of them.
6. **Backfill with `--at`.** Every state-changing command and `log` take `--at <when>`: an ISO 8601
   timestamp, `now`, or an offset (`-5m`, `-2h`, `-1d`). A row nobody registered at the time is
   registered now and stamped then.

## If you are implementing a ticket

**A ticket is picked up on a worktree, never in the main checkout**: your brief names it and the
branch, and git runs as `git -C <worktree>`, because your working directory may be the main checkout
and another agent is working there. Asked to pick a ticket up without one, create the worktree off
the main line first and work in it.

Your ticket's file path comes from `agent-progress ticket show <id>`, which also prints the body —
that body is the whole brief, its `## Brief` section first when it has one; you do not need the
frontmatter. When you finish, append a `## Handoff`
section at the end of the ticket, under 15 lines: files touched, contracts you discovered that the
ticket did not state, what is verified and how, what is not, and the next concrete step. The review
pass reads that instead of re-deriving it from the codebase. Builder or reviewer, leave the branch
ready to merge: your work committed on it, rebased onto the main line, the checks green on the result.

## The rules

- **Never edit `progress.json` by hand**, and never write into `.agent-progress/` with a file tool.
  Every command takes a lock, writes atomically and regenerates the page; a hand-written file races
  with that and loses silently.
- **A ticket body is yours to edit — below the frontmatter only.** The CLI preserves it byte for
  byte across every transition and rewrites the frontmatter itself. Unknown keys you add (`owner:`,
  `estimate:`) survive too, so use one of those if you need a field the tool does not have.
- **Run each tracker command on its own line**, not chained into other work, so its output stays
  short. Parse `--json`, never the human output.
- **Run `agent-progress open` once, not on every command** — the page refreshes itself. Give the
  user the path `.agent-progress/progress.html`, not a screenshot.
- The tracker is git-ignored on purpose. Do not commit it, and do not offer to.

## Everything else

**`agent-progress help` is the command reference** — every command with every flag, printed by the
tool, so it cannot be out of date. Run it when you need a flag you do not remember.

`Reference.md`, beside this file, is what the tool does not print: the ticket file format, what each
move does to the Gantt row, how a row's tokens are recorded, the time axis and the exit codes.

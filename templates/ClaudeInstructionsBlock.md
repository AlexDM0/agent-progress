## Progress tracking with agent-progress

This repository tracks its work with the `agent-progress` CLI. The tracker lives in the git-ignored
`.agent-progress/` folder at the repository root and is shared by every worktree of it, so subagents
in separate checkouts all write to the same chart.

- Load the `agent-progress` skill before working here, and run `agent-progress status --json` at the
  start of a session to find out what was already in flight. If this session is running the board —
  taking ticket requests and dispatching agents for them — load `agent-progress-orchestrate`
  instead; it loads the other one itself.
- Only the orchestrator runs agents for tickets, and it runs them through the dispatcher workflow,
  `.claude/workflows/agent-progress-dispatch.js`, started only on the user's go. Any other session or
  agent files a ticket when it is asked to and stops there: it never dispatches an agent to handle
  one, its own or anybody else's.
- Every agent's prompt names its row, its ticket or its review on a line of its own, and the
  `SubagentStop` hook adds every token the agent processed to that row when it stops, so where the
  hook is installed pass no `--tokens`: it would replace the sum.
- A ticket is picked up on a worktree of its own, never in the main checkout, by a builder or by a
  reviewer. The ticket's `## Brief` section, when it has one, is its builder's brief. A builder fixes
  the defects it finds beside its work when it can prove the fix, and ends by committing on its
  branch, rebasing it onto the main line and filling in its ticket's `## Handoff`: every agent leaves
  its branch ready to fast-forward into main. Nobody continues a finished agent with a follow-up
  message — a fresh agent for the remainder costs less than the one holding the whole transcript.
- A review is a clean agent following the review brief in `.agent-progress/agent-brief.md`. It starts
  from the Handoff rather than redoing the work, fixes what it finds in the branch's change and the
  ticket's Acceptance, settles its own doubts, rebases onto the main line again, and releases the
  branch itself with `agent-progress release`, which lets one branch into main at a time. Anything
  outside that, however small, is filed unfixed as a low-priority ticket. A second review is only for
  a pass that reworked over 750 lines of code (comments and documentation not counted) in its fixes
  and rebase, and is asked for, never scheduled by the reviewer.
- File every bug, change or feature the user reports as a ticket (`agent-progress ticket add
  "<title>" --type bug|change|feature`) and move it with `agent-progress ticket start|review|done|deliver <id>`.
- Record milestones with `agent-progress log "<what happened>"`; `--at -5m` backfills a stamp nobody
  registered at the time.
- Never edit `.agent-progress/progress.json` by hand, and edit a ticket only below its frontmatter —
  `agent-progress ticket show <id>` prints the file path to edit.
- Run `agent-progress open` once per session so the user has the dashboard; it reloads itself every
  5 minutes as the work moves.

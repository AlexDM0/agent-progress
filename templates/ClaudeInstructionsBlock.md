## Progress tracking with agent-progress

This repository tracks its work with the `agent-progress` CLI. The tracker lives in the git-ignored
`.agent-progress/` folder at the repository root and is shared by every worktree of it, so subagents
in separate checkouts all write to the same chart.

- Load the `agent-progress` skill before working here, and run `agent-progress status --json` at the
  start of a session to find out what was already in flight. If this session is running the board —
  taking ticket requests and dispatching agents for them — load `agent-progress-orchestrate`
  instead; it loads the other one itself.
- Only the orchestrator runs agents for tickets. Any other session or agent files a ticket when it is
  asked to and stops there: it never dispatches an agent to handle one, its own or anybody else's.
  The bullets below on spawning, briefing and reviewing are the orchestrator's.
- Register a task before spawning each subagent (`agent-progress task add "<what it will do>"
  --start`) and finish it when the result lands (`agent-progress task finish <id> --tokens <n>`,
  where `<n>` is the `input` figure on the line the `SubagentStop` hook logged for that agent —
  `3.8M`, every token it processed. The completion notification's `subagent_tokens` is roughly the
  agent's end context and understates that heavily and unevenly, so use it only where the hook is
  not installed). A row left without a number is how six sessions of subagent cost stayed invisible,
  so fill it in every time. `agent-progress task pause <id>` records a row that is waiting; `task start <id>`
  resumes it.
- Spawn each implementing agent from `.agent-progress/agent-brief.md`, filled in: one large ticket,
  one half of one, or a bundle of small tickets from one part of the code, per agent, on a worktree
  created for that agent off the main line before the spawn — a ticket is never picked up in the main
  checkout, by a builder or by a reviewer. An agent fixes the defects it finds beside its work when it
  can prove the fix, and reports only what needs a decision or a study it has not done. Never continue a finished agent with a follow-up message — a
  fresh agent for the remainder costs less than the one that already holds the whole transcript. The
  one exception is the orchestrator's one-line release-slot message to a reviewer.
- An implementing agent ends by committing on its branch, rebasing it onto the main line, and filling
  in its ticket's `## Handoff`: every agent leaves its branch ready to fast-forward into main.
- A review is a clean agent spawned from the review brief in that same file. It starts from the
  Handoff rather than redoing the work, fixes everything it finds, settles its own doubts, rebases onto the
  main line again, and asks the orchestrator for the release slot — one branch merges into main at
  a time. Only a finding far outside the ticket that is also a lot of work goes back to the orchestrator
  as a ticket. A second review is only for a pass that reworked over 750 lines of code (comments and documentation not counted) in its fixes and rebase;
  it is asked of the orchestrator, which grants it or files a new ticket for what keeps turning up.
- File every bug, change or feature the user reports as a ticket (`agent-progress ticket add
  "<title>" --type bug|change|feature`) and move it with `agent-progress ticket start|review|done|deliver <id>`.
- Record milestones with `agent-progress log "<what happened>"`; `--at -5m` backfills a stamp nobody
  registered at the time.
- Never edit `.agent-progress/progress.json` by hand, and edit a ticket only below its frontmatter —
  `agent-progress ticket show <id>` prints the file path to edit.
- Run `agent-progress open` once per session so the user has the dashboard; it reloads itself every
  5 minutes as the work moves.

## Progress tracking with agent-progress

This repository tracks its work with the `agent-progress` CLI. The tracker lives in the git-ignored
`.agent-progress/` folder at the repository root and is shared by every worktree of it, so subagents
in separate checkouts all write to the same chart.

- Load the `agent-progress` skill before working here, and run `agent-progress status --json` at the
  start of a session to find out what was already in flight.
- Register a task before spawning each subagent (`agent-progress task add "<what it will do>"
  --start`) and finish it when the result lands (`agent-progress task finish <id> --tokens <n>`,
  where `<n>` is the `subagent_tokens` figure in the completion notification — `12k`, `1.2m`).
  A row left without a number is how six sessions of subagent cost stayed invisible, so fill it in
  every time. `agent-progress task pause <id>` records a row that is waiting; `task start <id>`
  resumes it.
- Spawn each implementing agent from `.agent-progress/agent-brief.md`, filled in: one ticket, or one
  half of one, per agent. Never continue a finished agent with a follow-up message — a fresh agent
  for the remainder costs less than the one that already holds the whole transcript.
- An implementing agent ends by filling in its ticket's `## Handoff`.
- Review from that Handoff, not by redoing the work.
- File every bug, change or feature the user reports as a ticket (`agent-progress ticket add
  "<title>" --type bug|change|feature`) and move it with `agent-progress ticket start|review|done|deliver <id>`.
- Record milestones with `agent-progress log "<what happened>"`; `--at -5m` backfills a stamp nobody
  registered at the time.
- Never edit `.agent-progress/progress.json` by hand, and edit a ticket only below its frontmatter —
  `agent-progress ticket show <id>` prints the file path to edit.
- Run `agent-progress open` once per session so the user has the dashboard; it reloads itself every
  30 seconds as the work moves.

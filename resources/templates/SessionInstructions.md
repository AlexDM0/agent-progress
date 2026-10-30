## Progress tracking with {{program}}

This repository tracks its work with the `{{program}}` CLI. The tracker lives in the git-ignored `{{dataFolder}}/`
folder at the repository root and is shared by every worktree of it. An Overseer, started with `{{program}} oversee`,
drives every ticket through its build, review and merge; no session drives the board by hand.

- Run `{{program}} status --json` at the start of a session to find out what is in flight: its `jobs`, the
  `decisions` waiting for User and the open `incidents`. The Overseer's own state adds `mergeQueue`, `overseer` and
  `usage`; `{{program}} oversee status` says whether it is up.
- When User asks to file, report or track a ticket, bug or research question, load the `{{productOwnerSkill}}`
  skill. Only when User asks this session to run the board, load `{{orchestrateSkill}}`; it loads
  `{{productOwnerSkill}}` itself. Filing or editing a ticket does not make a session the orchestrator.
- A ticket is filed as a draft and builds only once `{{program}} ticket ready` readies it, which needs a numbered
  `## Acceptance` and a `## Brief` holding a non-blank line: the Brief is its builder's brief.
- A worker's finding is a low draft: it awaits the Assistant, which readies or triages it once the ticket it was
  found on is delivered, or, filed with `--needs-user`, User's Low-priority triage list.
- Work User finished and landed outside the Overseer is recorded with `{{program}} ticket deliver <id> --by-hand`,
  refused while an Overseer is live; no other lifecycle move is made by hand.
- `{{dataFolder}}/reference.md` holds the ticket format, the moves and the exit codes; `{{program}} help` holds
  every command.
- Record milestones with `{{program}} log "<what happened>"`; `--at -5m` backfills a stamp nobody registered at the
  time.
- Never edit `{{dataFolder}}/progress.json` by hand, and edit a ticket only below its frontmatter:
  `{{program}} ticket show <id>` prints the file path to edit.
- Run `{{program}} open` once per session so User has the board in the browser.

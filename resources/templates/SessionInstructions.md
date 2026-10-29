## Progress tracking with {{program}}

This repository tracks its work with the `{{program}}` CLI. The tracker lives in the git-ignored `{{dataFolder}}/`
folder at the repository root and is shared by every worktree of it. A runner, started with `{{program}} run`, drives
every ticket through its build, review and merge; no session drives the board by hand.

- Run `{{program}} status --json` at the start of a session to find out what is in flight: its `jobs`, the
  `decisions` waiting for User and the open `incidents`. The runner's own state adds `mergeQueue`, `overseer` and
  `usage`; `{{program}} run status` says whether it is up.
- When User asks to file, report or track a ticket, bug or research question, load the `{{productOwnerSkill}}`
  skill. Only when User asks this session to run the board, load `{{orchestrateSkill}}`; it loads
  `{{productOwnerSkill}}` itself. Filing or editing a ticket does not make a session the orchestrator.
- `{{dataFolder}}/reference.md` holds the ticket format, the moves and the exit codes; `{{program}} help` holds
  every command.
- Record milestones with `{{program}} log "<what happened>"`; `--at -5m` backfills a stamp nobody registered at the
  time.
- Never edit `{{dataFolder}}/progress.json` by hand, and edit a ticket only below its frontmatter:
  `{{program}} ticket show <id>` prints the file path to edit.
- Run `{{program}} open` once per session so User has the board in the browser.

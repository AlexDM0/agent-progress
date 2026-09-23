# `skill/` — the Claude Code skill every session in a tracked repository loads

One folder, symlinked to `~/.claude/skills/agent-progress` by `setup.sh` rather than copied, so an
edit here reaches every session on this device immediately and a `git pull` updates the installed
skill without an install step. `~/development/claude`'s `install.sh` would
otherwise adopt whatever it finds under `~/.claude/skills/` into its own repository and relink it,
clobbering that symlink on every run — which is why `agent-progress` is listed under `ignore` in
that repository's `skills.json`, and why `setup.sh` warns when it is not.

| file | what it is |
|---|---|
| `skill/SKILL.md` | The skill itself: frontmatter (`name`, the `description` that decides when it loads), the mental model, what to do in a session, what an implementing agent owes its ticket, and the rules. It ends by naming `agent-progress help` and `Reference.md`, which is how either is reached at all. |
| `skill/Reference.md` | What the help does not print, read only when it is needed: the ticket file format, the transition table, where a review row is drawn, how the hook adds to a row's tokens, the concurrency limit, what `agent-progress release` does — the running review rows it delivers included — and its refusal reasons, the time axis and the exit codes. |
| `skill/CLAUDE.md` | This file. |

## The rules that hold here

- **This skill is written for the session that is *not* orchestrating.** Its trigger fires in every
  session in a repository that holds a `.agent-progress/` directory, including every implementing
  subagent, and an agent pays for its whole context on every API call it makes. Material only an
  orchestrator needs — briefing, dispatch, what a subagent costs — belongs in `skill-orchestrate/`,
  which is loaded once by one session. A paragraph moved from there to here is paid for by everyone.
- **No file here lists the commands.** `agent-progress help` is the reference — it prints from
  `cli/HelpText.ts`, which `cli/HelpText.spec.ts` already holds against `cli/CommandTable.ts` in both
  directions, so a copy in this folder would be the one version nothing checks and the first to go
  stale. The same spec fails any skill file that grows a command table of its own. What belongs in
  `skill/Reference.md` is what the help does not print, and it says so in its first line.
- **`SKILL.md` must keep naming both**, and the spec asserts both: an agent not told to run
  `agent-progress help` guesses the flag instead, and nothing but `SKILL.md` points at
  `skill/Reference.md`.
- **The description in the frontmatter is the trigger, so it names the words a user says** — progress
  tracking, Gantt, tickets, "track this work" — rather than describing the tool to someone who has
  already decided to use it. A skill nobody loads is worse than one nobody has.
- Both files are read by an agent that may have no repository checked out, so every path they name
  is either a command, a path inside a tracked repository (`.agent-progress/…`) or a file beside
  them in this folder. They never cite a file of this repository.

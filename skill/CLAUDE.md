# `skill/` — the Claude Code skill shipped with the tool

One folder, symlinked to `~/.claude/skills/agent-progress` by `setup.sh` rather than copied, so an
edit here reaches every session on this device immediately and a `git pull` updates the installed
skill without an install step. `~/development/claude`'s `install.sh` would
otherwise adopt whatever it finds under `~/.claude/skills/` into its own repository and relink it,
clobbering that symlink on every run — which is why `agent-progress` is listed under `ignore` in
that repository's `skills.json`, and why `setup.sh` warns when it is not.

| file | what it is |
|---|---|
| `skill/SKILL.md` | The skill itself: frontmatter (`name`, the `description` that decides when it loads), the mental model, the session protocol an orchestrator follows, the rules, the full command reference, the ticket file format and the transition table, the time axis, and the exit codes. |
| `skill/CLAUDE.md` | This file. |

## The rules that hold here

- **The command reference is held against the tool, not trusted.** `cli/HelpText.spec.ts` asserts
  that every name in `cli/CommandTable.ts`'s `COMMAND_NAMES` appears here as `agent-progress <name>`,
  and that every `ticket` subcommand the help offers appears here too. A command added to the table
  and not to this file fails the build — which is the only reason a reference living in two places is
  allowed at all.
- **The wording is copied from `cli/HelpText.ts`**, not paraphrased. The spec pins the names and the
  subcommands; the descriptions are a human's job to keep in step, and copying them is how that job
  stays small.
- **The description in the frontmatter is the trigger, so it names the words a user says** — progress
  tracking, Gantt, tickets, "track this work" — rather than describing the tool to someone who has
  already decided to use it. A skill nobody loads is worse than one nobody has.
- `skill/SKILL.md` is read by an agent that may have no repository checked out, so every path it
  names is either a command or a path inside a tracked repository (`.agent-progress/…`). It never
  cites a file of this repository.

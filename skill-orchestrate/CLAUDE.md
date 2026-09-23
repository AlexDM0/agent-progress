# `skill-orchestrate/` — the Claude Code skill for the session that runs the board

One folder, symlinked to `~/.claude/skills/agent-progress-orchestrate` by `setup.sh` alongside
`skill/`, on the same terms: a symlink rather than a copy, and a warning when
`~/development/claude`'s `skills.json` does not list the name under `ignore`.

| file | what it is |
|---|---|
| `skill-orchestrate/SKILL.md` | The skill itself: the opening sequence — the hook, the installed dispatcher workflow and the launch arguments — how a ticket request is grilled and filed with the `## Brief` its builder reads, starting the dispatcher only on the user's go, what to do with its summary when it returns (the state, the parked tickets, the findings its reviewers filed, rows left open), the relaunch rule read from the board's dispatcher state, the triage low-priority tickets get before a run is launched for them, stopping it on the board, the one manual-path paragraph for a single ticket by hand while it is stopped, what the orchestrator keeps in its own working memory and what it drops, and the board hygiene that keeps the chart true. |
| `skill-orchestrate/CLAUDE.md` | This file. |

## The rules that hold here

- **It opens by loading the `agent-progress` skill and repeats nothing from it.** The mental model
  and the rules live there, every flag is printed by `agent-progress help`, and `cli/HelpText.spec.ts`
  fails any skill file that grows a command table of its own.
- **One session loads this, so it is the place for anything expensive.** The split exists because
  `skill/`'s trigger fires in every session in a tracked repository, including the implementing
  agents; this one fires when somebody asks to orchestrate. Length here costs one transcript.
- **Every rule in it is a rule an orchestrator can break by accident**, and is written as an
  instruction rather than as a description of the tool: when the dispatcher may start, what to do
  with a parked ticket, what to drop from context and when. What the dispatcher decides in code —
  rounds, parking, models, review bars — is not restated here as an instruction to follow by hand. Prose that merely explains how the tracker works
  belongs in `skill/`.
- **The numbers stay in the brief.** `templates/AgentBrief.md` carries the measurements behind the
  call budgets and is copied into every tracked repository as `.agent-progress/agent-brief.md`; this
  skill points the orchestrator at that file and does not restate it.
- It is read by an agent that may have no repository checked out, so every path it names is a
  command or a path inside a tracked repository (`.agent-progress/…`, `.claude/settings.json`).
  It never cites a file of this repository.

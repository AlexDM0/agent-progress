# `cli/` — the command surface

Everything a person or an agent types, and nothing else. The rules that matter here are the two
boundaries this folder owns; the rest of the conventions are in the root `CLAUDE.md`.

## Exit codes mean one thing each

The tool answers a calling script with a number, and the number is decided in exactly one place —
`cli/Main.ts`, from an `OperationRefusal`'s status.

| code | meaning | where it comes from |
|---|---|---|
| **0** | done, or there was nothing to do | a handler that returned |
| **1** | a refusal the caller can act on | `OperationRefusal` with status `refused`, and an unknown command word |
| **2** | a state the tool will not repair on its own | `OperationRefusal` with status `unrepaired`, and any other thrown error |

`--help` and `-h` are honoured after a command word as well as in place of one, and print the same
one screen: there is no per-command help, because a second help surface is a second thing to keep in
step with the table.

A command never chooses its own code and never calls `process.exit`: it writes through its
`CommandContext` and throws `OperationRefusal` when it cannot continue. `agent-progress.ts` at the
repository root is the only file in the repository that exits, and it does it with the number
`runCommandLine` returned. The help goes to standard output when it was asked for and to standard
error when it follows an "Unknown command" — a mistyped command that exits 0, or prints a help
screen into a pipe somebody is parsing, is the failure this arrangement exists to prevent.

## Every mutating command renders under the lock

`init`, `task`, `ticket`, `log`, `range` and `clear` all follow one sequence, and the order of its
last three steps is the whole of the concurrency design in `docs/plan.md`:

```
requireWorkspace → withLock → readProgressFile → mutate → writeProgressFile → write the tickets → rerenderDashboard
```

It is written once, in `cli/CommandSupport.ts`'s `openTrackerForWriting`, and no command repeats it.
**Rendering happens inside the lock**, from the file on disk rather than from the value just written:
two commands that each wrote and then rendered outside the lock can interleave so that the *older*
render lands last, leaving a page that disagrees with the file it came from until somebody runs
another command. **Ticket files are written after the progress file**, so the progress file is never
behind the tickets — the direction `ensureTaskForTicket` repairs — which is why a command queues them
through `writeTicketAfterwards` instead of writing them itself.

`render` and `open` render without mutating and take the lock for that alone. `status` takes no lock
and renders nothing: every file it reads is written atomically, so a read either sees the old file or
the new one, and the command an agent runs most often should not wait behind somebody else's write.

A store write that succeeded while the render could not finish — a page bundle that would not build,
a ticket file an agent left malformed — is reported on standard error at **exit 0**. The tracker was
changed; saying otherwise would make an orchestrator re-run a command that had already worked.

## A command takes its context, it does not reach for the process

`currentDirectory`, `now()`, both output streams, whether standard input is a terminal, the read of
everything piped in and the confirmation prompt all arrive in the `CommandContext`. That is what lets every command spec run in
the test process against a scratch directory and a frozen clock. The environment is not in the
context: `lib/platform/Environment.ts` is the one module that reads it.

## Per-file

| file | what it is |
|---|---|
| `cli/Main.ts` | `runCommandLine(commandLineArguments, context)`: rewrites a missing command word and a `--help`/`-h` anywhere before a bare `--` to `help`, dispatches through the table, maps a refusal to an exit code |
| `cli/Main.spec.ts` | the four routes and the number each produces, against a captured context |
| `cli/CommandSupport.ts` | the sequence every mutating command follows, `resolveAtOption`, `printEntity`, `renderDashboard`, and `progressOperations` — the progress store in the shape `lib/tickets/TicketTransitions.ts` asks for |
| `cli/CommandContext.ts` | the interface every handler is given, and `createProcessContext()` for the real process |
| `cli/CommandTable.ts` | name → lazy loader for all eleven commands; `COMMAND_NAMES`; `commandLoaderFor` guarded by `Object.hasOwn` |
| `cli/CommandTable.spec.ts` | every loader resolves to a function, and an inherited property of the literal is refused rather than run |
| `cli/HelpText.ts` | `helpText()`: the whole command reference, one screen, interpolating nothing |
| `cli/HelpText.spec.ts` | the help and the table agree in both directions; the entry layout that makes that checkable |
| `cli/BinarySmoke.spec.ts` | the only suite that spawns the real binary: help, an unknown word, an inherited property, a bare-repository `init` refusal, and one whole session — init through `ticket deliver`, with a pause, a `--tokens 12k` and a matrix refusal — ending on the `status --json --full` document |
| `cli/arguments/ArgumentParser.ts` | the closure factory: flags, options in both spellings, positionals, the bare `--`, and the refusals |
| `cli/arguments/ArgumentParser.spec.ts` | the shapes that fail quietly when the parser is wrong |
| `cli/arguments/OptionsWithValues.ts` | which option names take the next argument, across every command |
| `cli/init/InitCommand.ts` | `init`: discover the root, ignore the tracker, create it, render, write the managed CLAUDE.md block, and under `--hooks` the `SubagentStop` entry in `.claude/settings.json`. A re-run at the same root refreshes the block; one below an existing tracker, one inside a bare repository, and a `--root` that is not an existing directory are all refused |
| `cli/init/InitCommand.spec.ts` | the tree and all three side effects, `--no-claude-md`, `--root`, the re-run, the two refusals, and the worktree case that the one-tracker-per-repository promise rests on |
| `cli/status/StatusCommand.ts` | `status`: the working view — counts, the rows and tickets that are not delivered or abandoned, the recent log ordered by its stamps, and under `--json` an `omitted` count of what was left out. `--full` is the *whole progress file plus every ticket's frontmatter* |
| `cli/status/StatusCommand.spec.ts` | both `--json` documents' shapes, which are the contract with the orchestrating agent, plus the token column and the log's order |
| `cli/task/TaskCommand.ts` | `task add\|start\|pause\|finish\|review\|deliver\|update\|remove`: the rows that are not a ticket's. `update` is the one that does not move the row's clock, and a row a ticket owns is refused unless `--force` |
| `cli/task/TaskCommand.spec.ts` | the lifecycle, that a repeated stamp does not move, pause and resume, `--tokens`, `--at`, `--json`, the ticket-owned refusal, and the link rules on both sides |
| `cli/log/LogCommand.ts` | `log`: one line, joined from every positional so an unquoted sentence is not truncated to its first word |
| `cli/log/LogCommand.spec.ts` | the joining, the backfill, and the refusal of an empty line |
| `cli/hook/HookCommand.ts` | `hook subagent-stop`: the `SubagentStop` hook, reading the hook JSON from standard input and appending one line saying what the finished subagent cost. The tracker is resolved from the hook input's own `cwd`. **The only command that exits 0 on every failure** — no input, bad JSON, no transcript, no tracker, no calls — because the agent has already finished when this runs, so a non-zero exit prevents nothing and buys only an error the orchestrator has to read and a delay before it is told |
| `cli/hook/HookCommand.spec.ts` | the line it writes, each of the seven failures — the held lock among them — leaving the tracker untouched at exit 0, the `cwd` the tracker is found from, and the one refusal: a misspelled event |
| `cli/usage/UsageCommand.ts` | `usage`: what the subagents of this repository cost, profiled from the transcripts under `~/.claude/projects/`. One row per agent oldest first, then the cohort summary; `--since` splits the cohort and summarises both sides, `--transcripts` names a folder instead of deriving one. Read-only — no lock, no write, no render — and finding nothing is one sentence at exit 0 |
| `cli/usage/UsageCommand.spec.ts` | the rows and the summary against a scratch folder of constructed transcripts, the `--since` split, the `--json` shape, an empty folder, and the refusal of an unreadable `--since` |
| `cli/ticket/TicketCommand.ts` | `ticket add\|list\|show\|start\|review\|done\|deliver\|abandon\|reopen\|status\|link`: the markdown tickets and the rows they drive. The named verbs enforce the legality matrix and `ticket status` is the override; `show` always prints the file path |
| `cli/ticket/TicketCommand.spec.ts` | filing, every transition stamping both files, the matrix and the same-status refusal, the abandon refusal, `--tokens`, listing, showing, and linking |
| `cli/range/RangeCommand.ts` | `range`: the stored axis. A relative bound is stored verbatim; `kind` is `absolute` only when both ends are timestamps |
| `cli/range/RangeCommand.spec.ts` | each stored shape, including the mixed pair, and the refusals — an unreadable bound and a `--from` that is not before its `--to` |
| `cli/render/RenderCommand.ts` | `render`: regenerate the page under the lock, mutating nothing |
| `cli/open/OpenCommand.ts` | `open`: render only when the page is missing, then hand the path to the desktop, detached — and print it either way |
| `cli/clear/ClearCommand.ts` | `clear`: empty the rows and the log, keep `trackerId`, `project` and the task id counter, re-seed a row per surviving ticket from its frontmatter. `--all` deletes the tickets |
| `cli/clear/ClearCommand.spec.ts` | the re-seeded bars and their fresh ids, the kept tracker id, `--all`, and both halves of the confirmation |

Adding a command is one entry in `cli/CommandTable.ts`, one block in `cli/HelpText.ts`, one folder
here, and one row above. `cli/CommandTable.spec.ts` and `cli/HelpText.spec.ts` fail until all four
exist.

# agent-progress — command and file-format reference

The complete reference for someone using the tool: what `init` and `update` write into a repository,
every command and flag, the exit codes, what the dashboard shows, the files on disk
and what each ticket move does to its Gantt row. The code wins every disagreement: `agent-progress help` prints the
command reference from `cli/HelpText.ts` and is never out of step with the tool. `resources/templates/Reference.md`,
installed as `.agent-progress/reference.md`, carries a word-for-word copy of three sections of this file, the
ticket file format, the ticket moves and the exit codes, and follows it everywhere else. The overview is in the
[README](../README.md); working on this repository yourself is in [development.md](development.md).

- [Conventions](#conventions)
- [Adopting a repository](#adopting-a-repository)
- [The two skills](#the-two-skills)
- [Commands](#commands)
- [Exit codes](#exit-codes)
- [The Handoff and the token column](#the-handoff-and-the-token-column)
- [The dashboard](#the-dashboard)
- [Files on disk](#files-on-disk)
- [Ticket moves and their rows](#ticket-moves-and-their-rows)

## Conventions

| term | meaning |
|---|---|
| `<when>` | An ISO 8601 timestamp, `now`, or an offset from now: `-5m`, `-2h`, `-1d`, `+30m`. `--at <when>` backfills: a stamp already recorded is kept, so a row nobody registered at the time can be dated afterwards. |
| `<n>` | The figure on `--tokens`: a whole number or a decimal with a `k`/`m`/`b` suffix — `12000`, `12k`, `12.3k`, `1.2m`, `1.20b`, so a figure `status` or the page prints reads back. A bare decimal and a negative are refused. It is a figure the orchestrator reports, never one this tool measures, and it replaces the row's figure rather than adding to it. |
| `<id>` | A task id is a number (`17`); a ticket id is its padded number (`003`), and `3` or `#3` name the same ticket. |
| `--json` | Accepted by every command but `init`, `update`, `render`, `open`, `hook` and `help`, and prints one JSON document on standard output in place of the human output. A reading command prints the document its row describes. A command that writes prints what it wrote: the row for a `task` verb, the ticket for a `ticket` verb or setting (a list for a claim of several), the epic for `epic add` and `epic edit` (`{ key, removed: true, filePath }` for `epic remove`), the log entry for `log`, the stored axis for `range`, the new state for `concurrency <n>`, `dispatcher <state>` and `checks <command>`, and the counts for `clear`; `release` prints its own document. Nothing follows the document on standard output — no Next line, running-dispatcher notice or resume line — while a warning still goes to standard error. |
| `AGENT_PROGRESS_ROOT` | Names the repository to use instead of walking up from the current directory, for a command run from somewhere else entirely. It does not create a tracker: a value naming a directory that has none is refused with a message saying the variable is set. `init` does not choose its directory by it, and refuses at exit 1 when it names a directory other than the one `init` targets. Every variable the CLI reads is named from the build's environment prefix: the `agent-progress-v2` build reads `AGENT_PROGRESS_V2_ROOT` and `AGENT_PROGRESS_V2_REQUIRE_EVERY_TOOL`, and never the released program's. |
| product names | Every name the build goes by is `PRODUCT_NAMES` in `src/shared/constants/ProductNames.ts`. The work-in-progress build is `agent-progress-v2`, linked beside the released `agent-progress`: its data folder is `.agent-progress-v2/`, its monitor folder `~/.agent-progress-v2-monitor/`, its skills `agent-po-v2` and `agent-progress-orchestrate-v2`, its managed block `agent-progress-v2:managed`, its hooks `agent-progress-v2 hook …`, its worker agent `agent-progress-v2-worker` and its page keys `agent-progress-v2:…`. The paths below name the released program's. |

**One tracker per repository.** The tracker lives in `.agent-progress/` at the repository root, found
with `git rev-parse --git-common-dir`, so every worktree of a repository shares one tracker and one
chart.

**Locking.** Every mutating command (`init`, `task`, `ticket`, `epic`, `log`, `concurrency`, `dispatcher`,
`checks`, `range`, `release`, `clear`, `hook subagent-stop`) takes the tracker's
lock, reads, changes, writes `progress.json` atomically, writes any ticket file after it, then `log.jsonl` when it
logged something, and regenerates `progress.html` from disk, then its `progress.stamp.js` — all before releasing
the lock, so the page never describes a state the store did not hold, a ticket file is never ahead of the progress
file, and a log line never describes a change that was not stored.
`render` and `open` take the lock only to render. `status`, `ticket list`, `ticket show`, `epic list`, `epic show`,
`concurrency`, `dispatcher` and `checks` without an argument, `usage`, `rework` and `review-stats` take none: every file
they read is written atomically. `release` runs a stored check command before it takes the lock, so a
release waits for no other release's checks. `update`, and `init` on an existing tracker, never touch the tracker's
own files and take no lock.

**Help and options.** `agent-progress help` prints the whole reference. `--help` works after a
command word as well as on its own, and `-h` on its own or straight after the command word; a `-h`
further on is refused at exit 1, since it may be text (put text behind a bare `--`). An option taking
a value, given twice, is refused at exit 1. An unknown command is refused at exit 1 with the help on
standard error, so a typo never exits 0 or prints the help into a parsed pipe.

**The Next line.** `status`, `ticket add`, every ticket or task move (`task add --start` included),
`ticket depends`, `priority`, `agent`, `hold` and `unhold`, and `release` end their human output with
one line read from the board after the change:

```
Next: 1 of 2 slots free; ready: #003, #005
Next: no slot free (2 agents in flight); ready: #003
Next: 2 of 2 slots free; nothing ready
```

At most five ready ids are named, then `and N more`; a held ready ticket is left out and named apart
(`; held: #002`). The dispatcher's advice follows where it has any, addressed to the orchestrator
rather than to whichever session ran the command: `; dispatcher stopped: wait for the user's go` when
it reads `stopped`, as a stored `finished` does. While the dispatcher
is `running`, `ticket add`, `priority`, `agent`,
`depends`, `hold`, `unhold`, `reopen` and `status <id> pending` add one more line: the run picks the
change up at its next agent's return and is never stopped or relaunched for it. `--json` output
carries neither line.

## Adopting a repository

```sh
cd <the repository to track>
agent-progress init
```

`init` creates the tracker and installs everything a session needs to use it. Of the nine things
below, the first four are the tracker itself and the instructions pointing at it; the next three are
what Claude Code runs — the hook and the agent definition under `.claude/`, the dispatcher in the
tracker — each written by default and each with its own opt-out; the eighth is the two skills, with
no opt-out; the last records which install version all of them are.

| # | what | path | written by | opt-out |
|---|---|---|---|---|
| 1 | The tracker: `progress.json`, `log.jsonl`, a `tickets/` folder, the generated `progress.html` and its `progress.stamp.js`, and the `.lock` directory | `.agent-progress/` | `init` only | — |
| 2 | The briefs, generated from `resources/templates/AgentBrief.md` (the orchestrator's), `BuilderBrief.md` and `ReviewBrief.md`, and the reference they cite, from `Reference.md` | `.agent-progress/agent-brief.md`, `builder-brief.md`, `review-brief.md`, `reference.md` | `init`, `update` | — |
| 3 | A `.gitignore` entry for the tracker | `.gitignore` | `init` only | — |
| 4 | The managed block, from `resources/templates/ClaudeInstructionsBlock.md` | `CLAUDE.md` | `init`, `update` | `--no-claude-md` |
| 5 | The `SubagentStop` hook running `agent-progress hook subagent-stop`, the `PreToolUse` hook on `Bash` running `agent-progress hook pre-tool-use`, and the `PostToolUse` hook on every tool running `agent-progress hook post-tool-use`; each is kept current in `.claude/settings.json` when that file already holds it | `.claude/settings.local.json` | `init`, `update` | `--no-hooks` |
| 6 | The dispatcher workflow, generated from `dispatcher/DispatchFromWorkflowGlobals.ts` | `.agent-progress/agent-progress-dispatch.js` | `init`, `update` | `--no-workflow` |
| 7 | The worker agent definition, from `resources/templates/AgentProgressWorker.md` | `.claude/agents/agent-progress-worker.md` | `init`, `update` | `--no-agent-definition` |
| 8 | The two skills, copied from this checkout's `skills/agent-po/` and `skills/agent-progress-orchestrate/`, each with its `.gitignore` entry | `.claude/skills/agent-po/`, `.claude/skills/agent-progress-orchestrate/` | `init`, `update` | — |
| 9 | The install version | `.agent-progress/version.json` | `init`, `update` | — |

1. **The tracker.** Its root is the main checkout, found from any worktree.
2. **The briefs.** The orchestrator's, `agent-brief.md`, is what it fills in before it spawns an
   implementing agent: the scope, the facts it needs instead of a reading list, and the ticket's
   `## Brief` block. Each agent reads only its own: a builder `builder-brief.md` (call discipline, the
   call budget, when to stop, how to close and what to report), a reviewer `review-brief.md` (the review
   procedure, its budget and the rework threshold). They are guidance shipped with the tool rather than
   files a project edits, so every `init` and every `update` rewrites all three, generated with the
   call budgets and the rework threshold the dispatcher's prompts state, from the same constant. The
   managed block states that threshold the same way. Both agents' briefs cite `reference.md`, the
   ticket file's format, the ticket moves and the exit codes copied from this file, which an agent reads
   on demand and every run rewrites too. The line reports the orchestrator's brief, and `updated` when
   any of the four changed.
3. **The `.gitignore` entry**, only when the repository does not already ignore the tracker.
   `git check-ignore` decides, so a repository covered by a broader pattern, a parent `.gitignore` or
   `.git/info/exclude` gets no diff at all.
4. **The managed block**, between `<!-- agent-progress:managed:start -->` and
   `<!-- agent-progress:managed:end -->`, telling the next agent to track its work through the tool.
   The file is replaced atomically at the path its symlink resolves to, so a symlinked `CLAUDE.md`
   stays a symlink; a start marker with no end marker is refused and the file is left alone.
5. **The hook**, under an empty matcher so every subagent type is recorded. It goes into
   `.claude/settings.local.json` — the per-user file Claude Code applies over the shared one and keeps
   out of git — so an accurate token figure needs no flag and lands in nothing colleagues share. A
   repository that already keeps this hook in the shared `.claude/settings.json` has it kept current
   there instead: never moved, never a second copy that would log every agent twice. Either way it
   merges into whatever the file holds, is never added twice, refuses a document it cannot parse
   rather than replacing it, and writes nothing when the entry already says what it should.
6. **The dispatcher**, generated by every `init` and `update` from the tool's `dispatcher/` into the
   git-ignored tracker, so no generated file lands in the project's tree. The orchestrator launches it
   by its path only —
   `Workflow({ scriptPath: '<mainCheckout>/.agent-progress/agent-progress-dispatch.js', args: { mainCheckout, mainLine, checkCommand, installCommand, includeLowPriority, group } })`
   — since it is not under `.claude/workflows/` and has no name to launch it by. Its `checkCommand` is
   the line `agent-progress checks` prints, stored once in the tracker, which `release` runs itself. It is the tool's
   script, not the project's, so a hand edit is undone. A dispatcher that cannot be generated is
   exit 2, and nothing at all is written.
7. **The worker agent definition**, a Claude Code subagent whose frontmatter sets `model: opus` and
   `effort: medium` — the default for every agent that builds or reviews a ticket. The Agent tool
   takes a subagent's effort from its definition alone, so spawning `agent-progress-worker` is how an
   orchestrator working by hand gets the default pair. A ticket that names another pair
   (`ticket add --model/--effort`, `ticket agent`) is run through the dispatcher, which starts every
   builder and reviewer as this type (`agentType`) and passes each the pair from `readyTickets`. Its
   `tools` list is the shell and file tools, `ToolSearch`, `StructuredOutput` and the browser pane's
   tools, without `Skill`, so a worker carries neither the session's skill listing nor unrelated MCP
   tools on every call, and it preloads no skill: what a worker needs is in its brief and this
   definition. A hand edit is undone. Since the dispatcher cannot start a worker without it,
   `--no-agent-definition` is refused
   at exit 1, writing nothing, unless `--no-workflow` is given too. `--no-workflow` leaves an installed
   dispatcher in place, so the two together are refused the same way while
   `.agent-progress/agent-progress-dispatch.js` exists and this definition does not.
8. **The skills**, `agent-po` and `agent-progress-orchestrate` ([The two skills](#the-two-skills)),
   copied file for file from this checkout's `skills/` into `.claude/skills/<name>/`, where Claude Code
   reads a project's skills. Every `init` and `update` rewrites each file the skill ships, so a hand
   edit is undone; a file somebody else put in the folder is never touched, so one a newer skill no
   longer ships stays behind until removed by hand. Each folder gets its own `.gitignore` entry unless
   git already ignores it, since it is a copy the next `update` replaces. A skill folder an earlier
   version installed and this one retired, `.claude/skills/agent-progress/`, loses the files that version
   shipped there (`SKILL.md`, `Reference.md`) and its exact `.gitignore` entry; a file somebody else put
   in it stays, and so does the folder then. The line names each folder, `updated` or `unchanged`, and
   adds `.gitignore entry added` when it added one, and `retired` for a retired folder it cleared.
9. **The install version** ([its file](#agent-progressversionjson)): the one version of everything
   above that the tool installs, which changes only when what the CLI and those files expect of each other changes.
   `init` and `update` compute every installed file first and write this one last, after every other
   write, so a run that fails part way leaves the version it found and a second run completes it. A
   refused `CLAUDE.md` block or settings file is reported and does not hold it back.

Claude Code is the only agent host. A `version.json` naming the `agentHost` an install before version
11 recorded for a host agent-progress no longer installs for is refused by `init` and `update` at exit 1,
writing nothing and deleting nothing, naming the files that install left: remove them and the key by
hand, then run the command again.

`update`, and `init` at a root that already has a tracker, report items 2 and 4–8 on a line each:
`updated` or `unchanged`, judged from the file's bytes before and after (the hook from its entry, and
as `installed` when it was added), or `left alone` under the item's opt-out. The brief's `updated`
adds "re-read it before your next brief", so a session that read it at its start learns its copy is
stale. A first `init` prints the brief's path instead.

**Re-running.** To pick up a newer brief, block, hook, workflow or agent definition, run
`agent-progress update`, never `init` again. `init` at a root that already has a tracker does exactly
what `update` does and says so; `init` below an existing tracker, inside a bare repository, with a
`--root` that is not an existing directory, or with `AGENT_PROGRESS_ROOT` naming a directory other
than the one it would create the tracker in is refused. `init` never replaces an existing
`progress.json`: it creates the store with an exclusive create, under the lock.

Claude Code adds `**/.claude/settings.local.json` to your global git excludes the first time it
writes that file itself. If it has not yet, and the file this tool creates shows up in `git status`,
ignore it the way you ignore any personal file; this tool writes no `.gitignore` entry for it.

### Install version

`.agent-progress/version.json` records which install version the installed files are (item 9 above),
written last by `init` and `update`. Every command except `init`, `update`, `help`, `status`, `version`,
`run status` and `run stop` checks it against the running agent-progress before it does anything:

- the version it records equals this agent-progress's: the command runs;
- it records a different version, older or newer: refused;
- it is missing while the brief, `.agent-progress/agent-brief.md`, is there — the files were installed
  by an agent-progress from before versioning, since every `init` and `update` writes the brief, or a
  fresh `init`, which writes the brief first, was cut short: refused;
- it is missing and there is no brief — nothing is installed that could disagree: the command runs;
- it cannot be read or does not hold a whole number of at least 1: refused;
- a directory sits at its path: refused, saying to remove that directory and then run
  `agent-progress update`, since `update` could not replace it.

A refusal is one paragraph on standard error at exit 1, naming the tracked root and saying to run
`agent-progress update` there; nothing is locked or written first. For files a newer agent-progress
installed it says to update agent-progress itself first. Where no tracker governs the directory, the
command's own no-tracker refusal is unchanged.

- `release` runs the check itself, so `release --json` prints its refusal document,
  `{ released: false, reason: 'invalid-request', detail: <the paragraph>, cleanup: [] }`, at exit 1:
  a dispatcher of any install version knows that reason.
- `hook subagent-stop` checks the tracker the hook input's `cwd` names and, on a mismatch, reports
  `agent-progress hook subagent-stop: the line could not be recorded in <cwd>: <the paragraph>` and
  exits 0, crediting nothing, like every other hook failure. Tokens are credited again once `update`
  has run.
- `hook post-tool-use` renders nothing on a mismatch, silently, at exit 0.
- `hook bash-domains` skips the check, so a mismatch changes nothing: it still answers its call at
  exit 0.
- `update`, and `init` on an existing tracker, are what lift the refusal. They refuse, at exit 1 with
  the same paragraph and writing nothing, only files a newer agent-progress installed, so an older
  agent-progress never writes its files over a newer one's, and a directory at the file's path, which
  they could not replace.
- `status` never refuses and says nothing about a mismatch, because its output is what scripts read.
  This is a known gap: the refusal first shows at the next command.

## The two skills

`init` and `update` copy two Claude Code skills from this checkout's `skills/` into the tracked
repository's git-ignored `.claude/skills/` (item 8 of [Adopting a repository](#adopting-a-repository)),
split by audience: filing a ticket in any session, and running the board in one. No agent that builds
or reviews a ticket loads either: what it needs is in its brief (item 2) and the worker definition
(item 7), and both briefs cite `.agent-progress/reference.md` for the formats and exit codes. Neither
skill lists commands: `agent-progress help` is the reference, and both name it and the reference file.

| skill | folder | loads | holds |
|---|---|---|---|
| `agent-po` | `skills/agent-po/` | by itself in any session asked to file, report or track a ticket, bug or research question, or with `/agent-po`; and by the orchestrator for its intake | the whole filing procedure: fact-finding through subagents with capped reports, filing without questions and writing each assumption into Wanted (grilling only when the user asks, through a `grill-me` skill when the session has one, else the host's question tool), the split by mechanism, the epic check, merging or ordering tickets that share files or a mechanism, the body with its numbered Acceptance and `## Brief`, and the filing mechanics. It never dispatches, claims, starts or releases a ticket. |
| `agent-progress-orchestrate` | `skills/agent-progress-orchestrate/` | only with `/agent-progress-orchestrate` or when asked to run the board | what is the orchestrator's alone: grilling before every filing, asking every question with the question tool, judging a finding's severity, asking for the go, launching, relaunching and resuming the dispatcher, triaging low-priority tickets. It loads `agent-po` for intake and repeats none of it. |

## Commands

Options in `[brackets]` are optional; `a|b` is a choice of one.

### Setup

| command | what it does |
|---|---|
| `init [--project <name>] [--root <path>] [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]` | Create the tracker here and write the nine items in [Adopting a repository](#adopting-a-repository). `--project` names the project shown on the page (default: the root directory's name); `--root` tracks that directory instead of the discovered repository root. Refused, naming each file and deleting none, while `version.json` names a retired agent host. Refused when an ancestor already holds a tracker, when `--root` is not an existing directory, inside a bare repository, for `--no-agent-definition` without `--no-workflow` (the dispatcher starts every worker as that agent), for the two together while a dispatcher is installed without its definition, and when `AGENT_PROGRESS_ROOT` is set to a directory other than the one it would create the tracker in (the message names both, and nothing is written). A build whose program is not `agent-progress` refuses `older-program-present` at exit 1, like `update`, while the root holds the released program's `.agent-progress/`, writing nothing. A re-run refreshes only what `update` refreshes and leaves the tracker's own files alone; like `update`, it is refused at exit 1, writing nothing, over files a newer agent-progress installed ([Install version](#install-version)). |
| `update [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]` | Refresh what the tool wrote into a repository it already tracks, refusing like `init` while `version.json` names a retired agent host: the managed block, `agent-brief.md`, the hook, the workflow — generated anew into `.agent-progress/` — the agent definition and the two skills, undoing a hand edit to any of the last three; then `version.json`. Last, when the board's runner is live and its lease names a code or install version other than the one on disk, it sends `runner-restart` and prints the checked handover's outcome (see `run restart`), exiting 1 `runner-handover-failed` with the old runner still driving and what it installed standing; with no live runner it does nothing more. The tracker's own files are left alone, and the first line says so. `setup.sh --login-runner <repository> [--label <label>]` writes `~/Library/LaunchAgents/<label>.plist`, the label defaulting to `LAUNCH_AGENT_LABEL`, which runs `run --detach` in that repository at login with absolute paths to `bun` and the program; a label already naming another repository is refused, and nothing else installs it. A tracker an earlier agent-progress wrote in a format this one no longer reads — a version 1 `progress.json` holding its own log, or a status word the rename retired — is refused at exit 2 by every command that reads it, the reason ending in the advice to run `agent-progress update` with a release that still reads it, which rewrites it in the current format. It creates no tracker, so it takes no `--project` and no `--root`. With no tracker it is refused at exit 1, naming `agent-progress init`; so is `--no-agent-definition` without `--no-workflow`, or with it while a dispatcher is installed without its definition, writing nothing, as for `init`; and over files a newer agent-progress installed at exit 1, writing nothing ([Install version](#install-version)). Every command but `init`, `update`, `help` and `status` is refused until it has run over files of an older install version, and `hook subagent-stop` reports it at exit 0 ([Install version](#install-version)). |
| `help` | The command reference. |

### Reading the board

| command | what it does |
|---|---|
| `status [--json] [--full] [--tickets-only]` | The project, the counts, the rows that are not delivered or abandoned, and the last five log entries newest first, then the Next line. `--json` prints the same working view for an agent — the unsettled rows and tickets, the last 10 log entries, and an `omitted` object counting what was left out. `--full` lists everything; with `--json` it prints the whole progress file plus every ticket's frontmatter. The `version` both `--json` documents carry is the document's own shape version, `1`, with the worded log directly after `tasks`, whatever version the stored file is at. Both `--json` documents carry `concurrency` — `limit`, `agentsInFlight`, `freeSlots`, `readyTicketIds`, `dispatcherState`, `heldTicketIds`, while one is stored `dispatcherRunId`, then `inProgressTicketIds` and `inProgressReviewOfIds` — and beside it `readyTickets`, then `reviewWaitingTickets`, `pausedBuilds` and `ticketRows`, and end with `tokensByOwner`. Both carry `epics` after `tickets`, every epic with its roll-up (see Epics), and each ticket carries `epics`, its list in order, empty when it has none; then `drafts`, every open draft (see Drafts). `--tickets-only`, with or without `--json` and `--full`, leaves out the free-standing task rows — every row that is no ticket's own row (`ticket` null) and no review bar (no `reviewOf`) — while the tickets, the log and the counts stay; the working view's `omitted` then adds `freeStandingTasks`. The human output breaks the token total down per owner: owners are grouped case-insensitively on the trimmed text and shown under the group's most common spelling (the first met on a tie), most tokens first, with the reported rows that carry no owner on a `no owner` line of their own. `tokensByOwner` carries the same over every row, whatever the flags: `{ owners: [{ owner, tokens, rows }], withoutOwner: { tokens, rows }, withoutTokens: { rows } }`, whose owner and `withoutOwner` tokens add up to the reported total. Both `--json` documents then carry `ticketCountByStatus`, every ticket on the board counted per status (settled ones included, every status present, zero or not), so a reader totalling the board needs no `--full`, then `jobs`, every unsettled job as `progress.json` stores it, empty when there is none, and end with `decisions` and `incidents`, every open one as `progress.json` stores it, each empty when none is open. |
| `ticket list [--status <s>] [--priority <p>] [--json]` | The tickets with their status, priority, type and row id, the model and effort after the title where the ticket names them, and "waiting on #003" where a dependency is unsettled. `--status` and `--priority` narrow the listing. `--json` carries no bodies. |
| `ticket show <id> [--json]` | One ticket: its frontmatter, its priority, its model and effort where it names them, its body, and always its file path — which is what an agent needs in order to edit that body. Once the ticket was claimed or started it says whether the body changed since: a hash of the body now against the `claimedBodyHash` the claim recorded, never a clock; under `--json`, and in `status --json` and `ticket list --json`, that is `bodyChangedSinceClaim`, absent on a ticket never claimed. |

**Ready tickets.** A ticket is ready when it is pending and every ticket it depends on is reviewed or
delivered; priority never keeps a ticket from being ready, it only orders them. `readyTicketIds`
orders them high priority first, then normal, then low; within a priority by readiness, the log
position of the ticket's latest `ticket-readied` or `ticket-reopened` line (a ticket with neither,
readied before readiness was logged or behind a `Tracker cleared` line, comes first); then lowest id
first. `readyTickets` lists the same tickets in the same order as `{ id, priority, model, effort }` with the
defaults resolved, plus `group` on a ticket that has one (absent otherwise, as in `tickets`) and
`held: true` on a held one, so a dispatcher derives none of them itself.

**A group awaiting its release.** While a group has a release ticket (see `ticket release-of`) that
is neither delivered nor abandoned, every ticket of that group is the group run's and is left out of
the lists a whole-board run takes work from: `readyTicketIds`, `readyTickets`,
`reviewWaitingTickets` and `pausedBuilds`. Once the release ticket is delivered or abandoned, the
group has no release ticket, so its remaining open tickets list as any other. A group with no
release ticket lists as ungrouped tickets do.

**What a dispatcher reads.** Every list below is in file order, each id once, with a ticket's model,
effort and priority resolved to their defaults.

- `concurrency.inProgressTicketIds`: the `ticket` of every `in-progress` row that has one.
- `concurrency.inProgressReviewOfIds`: the `reviewOf` of every `in-progress` row that stores one, on
  any row, a ticket's own row included, as `ticket claim` and the moves out of review read it.
- `reviewWaitingTickets`: `{ id, model, effort }` for every `in-review` ticket whose id is not in
  `inProgressReviewOfIds`, a held one included; `heldTicketIds` says which are held. A group awaiting
  its release is left out (above).
- `pausedBuilds`: `{ id, note, priority, model, effort }` for every `in-progress` ticket whose row is
  `paused`, `note` being that row's note, whoever paused it; a group awaiting its release is left out.
- `ticketRows`: `{ id, row, reviewBars }` for each ticket the document lists, in its order, so the
  working view covers only the unsettled tickets. `row` is `{ id, status, note }` of the row the
  ticket's `task` names, or `null`. `reviewBars` are `{ id, status, round }` of the rows whose
  `reviewOf` is the ticket, one another ticket owns included, as `inProgressReviewOfIds` reads them,
  oldest filed first, `round` being the stored `reviewBarRound` and absent where the bar stores none.

### Tasks

A task is a row on the Gantt chart. A row a ticket owns is moved by the `ticket` verbs; the `task`
verbs refuse it, except a pause and its resume, naming the `ticket` verb that moves both, and
`--force` moves only the row.

| command | what it does |
|---|---|
| `task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--review-of <id>] [--start] [--tokens <n>] [--at <when>] [--force]` | Add a row. `--start` marks it in-progress at `--at` (default now); `--note` is the detail shown beside the bar; `--tokens` records what the work cost. `--ticket` links it to a ticket that has no row of its own, and `--force` moves that link off the row that holds it. `--review-of` marks the row as a review pass of that ticket, drawn directly above the ticket's own row, latest round first, and also stores the bar's round as `reviewBarRound`, the ticket's `## Review` sections plus one; a ticket that does not exist is refused at exit 1. A row filed without it is no review bar, whatever its name. |
| `task start\|pause\|finish\|approve\|rereview\|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]` | Move one row and stamp it. `start` sets its start and resumes a paused row; `pause` records that the work is waiting without closing the bar; `finish` and `approve` set its end; `rereview` sends a row whose review found too much into its next review pass — round 2, then 3 — without reopening the bar; `deliver` records that the work reached its destination. |
| `task update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]` | Change a row without moving its clock, and without adding to its `history`: a correction is not something that happened. At least one field is required. `--status` is for a correction the transitions cannot express, and on a row a ticket owns is refused unless `--force`, except a pause and its resume. A rename never links a row, and never moves or drops a stored `reviewOf`. |
| `task remove <id>` | Delete a row. A ticket pointing at it is unlinked rather than deleted. The id is never given to another row. |
| `log "<text>" [--at <when>]` | Append one line to the log, which `status` and the page's detail panel show. Every positional is joined, so an unquoted sentence is kept whole. |

The task statuses are `pending`, `in-progress`, `paused`, `in-review`, `re-review`, `reviewed`,
`delivered` and `abandoned`: the ticket statuses, plus `paused` and `re-review`, which only a row reaches.

Each verb is named for the status it moves to, the same on both sides: `start` → in-progress, `pause`
→ paused (tasks), `finish` → in-review, `rereview` → re-review, `approve` → reviewed, `deliver` →
delivered, `abandon` → abandoned and `reopen` → pending (tickets).

### Tickets

A ticket is a markdown file under `.agent-progress/tickets/` driving one Gantt row. Types are `bug`,
`change` (the default) and `feature`; priorities `low`, `normal` (the default) and `high`; models `haiku`,
`sonnet`, `opus` and `fable`; efforts `low`, `medium`, `high`, `xhigh` and `max`. Left unnamed, a
ticket's agents run on opus at medium effort.

| command | what it does |
|---|---|
| `ticket add "<title>" --type ticket\|bug\|research [--priority low\|normal\|high] [--size XS\|S\|M\|L\|XL\|XXL] [--model <m>] [--effort <e>] [--group <name>] [--depends-on <ids>] [--epic <keys>] [--network <domains>] [--introduced-by <id>] [--found-in-review <id>] [--body <markdown>] [--body-file <path\|->] [--at <when>] [--needs-user]` | File a draft ticket, `draft`, with no row at any priority and no task id spent: `ticket ready` makes it `pending` and files its row. A draft is edited without `--force`. The body comes from `resources/templates/TicketBody.md`, from `--body`, or from `--body-file` (`-` reads standard input); an empty body falls back to the template, and afterwards the body is preserved byte for byte, so an agent may edit everything below the frontmatter freely. `--depends-on 3,4` files it already waiting on those tickets; `--epic checkout-redesign,search` files it in those epics, the first its primary one, and an epic that does not exist is refused at exit 1 with nothing written. `--introduced-by 5` stores `introducedBy`, refused at exit 1 with nothing written as `ticket introduced-by` refuses it; `--found-in-review 5` stores `foundInReview`, the ticket whose review found this one, refused at exit 1 with nothing written when that ticket does not exist. `--network api.example.com,cdn.example.com` sets the `network` line as `ticket network` does, logged after the filing and refused the same way. `--size M` stores `size`, the expected change in code lines, comments and docs not counted: XS ≤ 20, S ≤ 100, M ≤ 300, L ≤ 750, XL ≤ 1500, XXL beyond. A model, effort or size outside the lists, or `--body` and `--body-file` together, is refused at exit 1 with nothing written. `--needs-user` routes a worker's low finding relayed under a job to User, and is refused `worker-filing-flag` anywhere else. |
| `ticket edit <id> [--title "<title>"] [--append] [--body <markdown>] [--body-file <path\|->] [--force] [--at <when>] [--json]` | Rename a ticket with `--title`, replace its body with the text of `--body` or `--body-file` (`-` reads standard input), or with `--append` add it to the end, putting one line ending before it when the body does not already end in one; a title and a body change are applied in one write. The text is written in the line ending the body already uses (the frontmatter's when the body holds none), so a CRLF ticket stays CRLF throughout. A new title rewrites the frontmatter's `title` line, the ticket's own row name (`#<id> <title>`) and a first body line still reading as generated (`# <id> — <old title>`), before any body change applies; the file name, a review row's name and every other body byte stay as they are, and one `ticket-retitled` record is logged. Every other frontmatter byte is kept, `updated` is not stamped — only a transition stamps it — and a body change of a draft or pending ticket is not logged; the write takes the tracker's lock and is atomic. Only a draft or `pending` ticket is edited, held or not: past it (claimed or started, in review, reviewed, delivered, abandoned) the edit is refused at exit 1 with nothing written unless `--force`, its status read inside the same lock hold as the write, so no claim slips between them. A forced edit that changes the body of a ticket carrying a `claimedBodyHash` logs one `ticket-body-changed-after-claim` record and shows as the body changed since the claim, while one claimed without a hash logs nothing about its claim; a rename alone moves `claimedBodyHash` along with the retitled heading, so it does not. An edit that changes nothing, an empty append or the current title included, writes nothing and exits 0; an empty replacement or `--title`, none of `--title`, `--body` and `--body-file`, or both body options are refused at exit 1. A value that starts with `--` is passed as `--body=<text>`. `--json` prints the ticket. |
| `ticket ready <id> [<id>...] [--incident <I>] [--at <when>] [--json]` | Ready draft tickets to build, all or nothing in one lock hold: each becomes `pending` with a `pending` row at any priority, and one `ticket-readied` line is logged per ticket. Refused at exit 1 with nothing written when any ticket named is not a draft ticket (`ready-of-a-ticket-not-in-draft`, naming its status), or when any is incomplete (`incomplete-tickets`, naming each ticket and its gaps): `acceptance-unnumbered` when its `## Acceptance` holds no numbered item, read as `release` reads it, and `brief-missing` when it has no `## Brief` holding a non-blank line. No move returns a ticket to `draft`, and a draft moves on only through `ticket ready` or `ticket abandon`. `--incident <I>` readies only findings the open `findings-delivered` incident lists (`finding-not-listed` otherwise), a first-run leftover by lifting its `first-run review` hold. A readied draft is struck off every incident listing it, whoever readied it. `--json` prints the ticket, or with several ids the list. |
| `ticket triage <id> [<id>...] [--incident <I>] [--at <when>] [--json]` | Put findings to User's low-priority triage in one hold: each gets `findingRoute: user`, logged `ticket-triaged`, and a `first-run review` hold stays. A `findings-delivered` incident closes (`incident-handled`) once every finding it lists is readied, triaged or abandoned; its default triages every finding still listed. `--incident` is checked as on `ticket ready`. |
| `ticket park <id> [--incident <I>] -- <reason> [--at <when>] [--json]` | Hold the ticket `parked:<incident kind>` (`parked:user` with no incident, replacing any hold) and open a `parked` decision to User, the reason its question. Under an incident whose job waits on a question, the job ends `stopped` (cause `parked`) in the same hold and the decision carries the agent's questions, the reason as its context. |
| `ticket agent <id> [--model <m>] [--effort <e>] [--at <when>]` | Change the model or effort a ticket's agents run on, or both, with one log line such as `Ticket #003 agents opus/medium → sonnet/medium`. Refused at exit 1, writing nothing, on a delivered or abandoned ticket, with neither option, with a value outside the lists, and when the resolved pair would not change. |
| `ticket priority <id> low\|normal\|high [--at <when>]` | Change a ticket's priority, with one log line. Lowering to low is refused unless the ticket is a draft or pending, and keeps its row: priority only orders the ready tickets. A draft has none at any priority; raising a low ticket that has no row gives it one at once. A low ticket with no row gets its row when `ticket start` or `ticket claim` starts it, and keeps it; abandoning a low ticket that has none creates none. |
| `ticket size <id> XS\|S\|M\|L\|XL\|XXL [--at <when>]` | Change a ticket's size, in any status, with one `ticket-size-changed` log line. A size outside the list, in capitals only, and an unchanged size are refused at exit 1 with nothing written. |
| `ticket network <id> <domain>... \| --clear [--at <when>] [--json]` | Set the public domains the ticket's agents may reach, comma- or space-separated, stored lower case and once each as the frontmatter key `network`; `--clear` removes the key. One `ticket-network-set` log line, `Ticket #003 network: api.example.com` or `Ticket #003 needs no network`; `updated` is not stamped. Refused at exit 1 with nothing written: a ticket that is not a draft or pending (`network-of-a-ticket-past-pending`), any domain that is not public — a loopback name (`localhost`, a name under `.localhost`), a `.local` name, an IPv4 literal in a loopback, private, link-local or shared range, an IPv6 literal outside global unicast, a single label or malformed text (`network-domain-not-public`, naming each) — the same list or a clear of a ticket with none (`network-unchanged`), and domains beside `--clear`. |
| `ticket hold <id> [--reason <text>] [--at <when>]` | Pause a ticket between build and review, or between review rounds, without stopping the dispatcher. While the frontmatter's `hold` key is set (to the reason, empty without one) the run starts no builder or reviewer for it and parks a row it left in progress for it, `ticket claim` refuses it, and `status --json` lists it in `concurrency.heldTicketIds` and marks its `readyTickets` entry `held: true`. An agent already running is never interrupted: a hold set after a builder's final status read is too late for the reviewer it starts. One log line; refused at exit 1 on a delivered or abandoned ticket and on one already held. |
| `ticket unhold <id> [--at <when>]` | Lift the hold, with one log line; the step it held starts at the dispatcher's next board read, and a run that ends first returns it under `held`. On a ticket in progress whose row is paused, a last line says how the build resumes: by a dispatcher run under a dispatcher claim note, by `task start <row>` under any other. Refused at exit 1 on a delivered or abandoned ticket and on one not held. |
| `ticket release-of <id> [--clear] [--at <when>] [--json]` | Mark a ticket as its group's release ticket, the one whose release takes the group's work to the main line. Only an open marked ticket — neither delivered nor abandoned — is the group's release ticket: a settled one's mark is history, so the group has none, and no release bundle, until another is marked. Its **release bundle** is the ticket plus every ticket of the same group it depends on, transitively, following no dependency outside the group; the group's other tickets are not in it. Stored as the frontmatter's `releasesGroup: true` on that ticket alone; `--clear` removes the key, leaving the file as though it had never been set. One log line either way. Refused at exit 1, writing nothing, on a ticket with no `group`, when another open ticket of the group — or this one — is already its release ticket, on a delivered or abandoned ticket, and with `--clear` on a ticket not marked. A delivered or abandoned ticket keeps its mark, and a move that takes it back to an open status — `ticket reopen`, or `ticket status`, which skips the move matrix but not this rule — is refused at exit 1, writing nothing, while another open ticket of its group carries the mark; with none, the move is made and the ticket is the group's release ticket again. `--json` prints the ticket. |
| `ticket epic <id> [<key>...] \| --add <keys> \| --remove <keys> [--at <when>] [--json]` | Set the epics a ticket belongs to, in order: the first is its primary epic. Bare keys replace its list and no keys clears it; `--add` appends (a key already there keeps its place), `--remove` takes keys out; either beside bare keys, or the two together, is refused as ambiguous at exit 1. A key naming no epic is refused at exit 1 with nothing written. One log line, `Ticket #003 belongs to epics checkout-redesign, search`; `updated` is not stamped. `--json` prints the ticket with `added` and `dropped`. Epics never affect dispatch, claiming, concurrency or release: that is `group`. |
| `ticket introduced-by <id> [<cause id>] [--at <when>] [--json]` | Name the delivered ticket whose change introduced a bug, stored as its `introducedBy`; no cause, or an empty one, removes the key. Refused at exit 1 with nothing written when the ticket is not a bug, or the cause does not exist, is the ticket itself or is not delivered. One log line, `Ticket #007 introduced by #005`; `updated` is not stamped, and every other line of the file is kept. `--json` prints the ticket. |
| `ticket depends <id> [<id>...] \| --add <ids> \| --remove <ids> [--json]` | Set the tickets this one waits on. Bare ids replace its list, and no ids clears it; the human line names what the replace dropped, `Ticket #459 waits on #473 (dropped #463)`, and each dropped ticket not yet reviewed or delivered gets a line of its own, `#463 is still open: #459 may now start before it`. `--add 3,4` appends to the list, keeping an id already there; `--remove 3,4` takes ids out. Either beside bare ids, or the two together, is refused as ambiguous at exit 1. `--json` prints the ticket with `added` and `dropped`, the ids the change put in and took out. A ticket that does not exist, or a list that would make tickets wait on each other in a circle, is refused. Until every one is reviewed or delivered, the ticket's row, table entry and card read "waiting on #003", `ticket list` says so too, and `ticket start` warns on standard error but still moves it. An abandoned dependency does not settle it. |
| `ticket link <ticketId> <taskId> [--force]` | Point a ticket at an existing row instead of the one it filed. Refused when that row already belongs to another ticket, unless `--force`, which unlinks it there first. |
| `ticket start\|finish\|approve\|deliver\|abandon\|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]` | Move a ticket and its row together, stamping both — see [Ticket moves and their rows](#ticket-moves-and-their-rows) for which status each verb moves from. A move to the status the ticket already has is refused and logs nothing. Every move out of in-review finishes and delivers the ticket's in-progress review bar, with one log line each. `start` warns on standard error, and still moves it, when the ticket is held or waiting on a dependency. `abandon` requires `--reason`; `reopen` clears the stamps and returns the row to pending. `--branch` and `--commit` record where the work landed; `--tokens` replaces the row's figure, and on a ticket with no row (a low one never started) is refused at exit 1. |
| `ticket deliver <id> --by-hand [--branch <b>] [--commit <sha>] [--at <when>] [--json]` | The one record-only lifecycle verb: records as delivered a ticket User finished and landed outside the runner, from any status but draft, in one hold, merging, landing and spawning nothing; it logs `ticket-delivered` with `byHand: true`. Refused at exit 1, writing nothing, while a runner's lease is live (`runner-owns-the-lifecycle`, naming its URL) and while a job of the ticket is live (`ticket-has-live-job`), both judged inside the hold. Never relayed. |
| `ticket claim <id> [<id>...] [--owner <who>] [--note <text>] [--after <id>] [--at <when>] [--json]` | `ticket start` and the row's `--owner` and `--note` in one write, for every ticket named, as one agent: a bundle's builder claims all its tickets in one call, and their rows share one agent key. The first command an implementing agent runs. `--after <predecessor>` claims one ticket, a pipelined successor, while its predecessor is still in review: it is accepted only when the predecessor is in-review, both are in one group's release bundle (see `ticket release-of`), and the predecessor is the one unsettled ticket it waits on; otherwise refused at exit 1 with nothing written, and the slot limit applies as for any claim. Refused at exit 1, all or nothing, when any ticket is not pending or in-review, is held, waits on a ticket outside the claim that is not reviewed or delivered (one inside it counts as settled: the bundle is worked in dependency order), has a review bar in progress, or when the agents in flight already number the concurrency limit. The count and the moves share one lock hold, so two claims racing for the last slot cannot both succeed. `--json` prints the ticket, or with several ids the list. |
| `ticket finish\|rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]` | The move to review, or to the next round, and the reviewer's in-progress bar (`Review <N> #<id> — <title>`, its `reviewOf` the ticket, N the `## Review` sections plus one, stored on the bar as `reviewBarRound`) in one lock hold, closing any bar of the round before: the builder's slot passes to its reviewer, and one round's to the next, without `status --json` ever showing it free. A bundle's bar carries its claim's agent key while other rows of the bundle still run, so it takes no second slot. `--owner` and `--note` name the bar, and are refused without the flag. |
| `ticket rereview <id> [--at <when>]` | Send a ticket already in review round again, for a fresh reviewer: the ticket stays in-review and only its `updated` moves, while its row goes one review round up, from 2, and the log says which round. The one verb legal on the status the ticket already has, and refused from every other. It takes no `--tokens`: the row's figure is the builder's, and a review pass has its own row. |
| `ticket status <id> <status> [...same options]` | The same move, naming the target status directly — pending, in-progress, in-review, reviewed, delivered or abandoned — with the same options. The documented way to make a move the verbs refuse: it skips the matrix, but never moves a ticket into `draft` (`move-to-draft`) or a draft anywhere but `abandoned` (`move-of-a-draft`). |

### Epics

An epic is a larger feature tickets are grouped under, for reading: it has no lifecycle, and its
progress is its tickets'. It never affects dispatch, claiming, concurrency or release; `group` is the
integration mechanism. A ticket belongs to any number of epics through `ticket epic` or `ticket add
--epic`.

| command | what it does |
|---|---|
| `epic add <key> "<title>" [--body <markdown>] [--body-file <path\|->] [--at <when>] [--json]` | Write `.agent-progress/epics/<key>.md` with the key, the title and a colour slot, then the description from `--body` or `--body-file` (`-` reads standard input), kept byte for byte. The key is lower-case letters and digits in words joined by single hyphens; a malformed key, a key already taken, one whose file exists but cannot be read as an epic, or `--body` and `--body-file` together is refused at exit 1 with nothing written. The slot, 1 to 6, is the one the fewest epics use, the lowest on a tie; it is stored, never reassigned. One log line. |
| `epic edit <key> [--title "<title>"] [--append] [--body <markdown>] [--body-file <path\|->] [--at <when>] [--json]` | Change the title, replace the description, or with `--append` add to its end as `ticket edit` does. One log line; an edit that changes nothing writes and logs nothing and exits 0; an empty replacement or `--title`, none of `--title`, `--body` and `--body-file`, or both body options are refused at exit 1. |
| `epic list [--json]` | Every epic, ordered by key, with its roll-up. |
| `epic show <key> [--json]` | One epic: its roll-up, its file path and its description. |
| `epic remove <key> [--at <when>] [--json]` | Delete the epic's file, with one log line. Refused at exit 1 while any ticket, of any status, names it. |

**The roll-up** is computed by the Board and is the same in `epic list --json`, `epic show --json`,
`status --json`'s `epics` and the page's `boardFacts.epics`: `{ key, title, slot, ticketIds,
ticketCountByStatus, tokens, span }`. `ticketIds` is every ticket naming the epic, in id order, in
whichever place of its list; `ticketCountByStatus` counts them per ticket status, every status
present; `tokens` adds each ticket's own row and its review rows, a row without a figure counting
nothing; `span` is `{ start, end }` over the same rows, from the earliest start to the latest end,
ordered by instant and printed as stored, `end` null while one of them that started has not ended,
and `span` itself null while none has started.

### Drafts

A filing draft is the working record a filing session builds its tickets from, never a draft ticket: it has no
status, row or move, and touches no dispatch. Its file, `.agent-progress/filing-cabinet/D<n>.json`
(see Files on disk), holds everything a rebooted session needs to resume. Ids are `D1`, `D2`, …, from
the stored `nextDraftId`, never reused, not after a close or an abandon. Every move logs one line.
Only `draft claim` checks who holds a draft; no other draft command looks at the claim.

| command | what it does |
|---|---|
| `draft open "<title>" --owner <who> [--request <text>] [--request-file <path\|->] [--json]` | Write the next `D<n>.json` with the title, the request from `--request` or `--request-file` (`-` reads standard input), kept byte for byte, and the claim held by `<who>`; the first one makes the folder and stores `nextDraftId`. Prints the id; `--json` prints the stored draft. A missing title or `--owner`, both request options, or a malformed file already at the new id's path is refused at exit 1 with nothing written. |
| `draft claim D<n> --owner <who> [--force] [--json]` | Take the claim. Refused at exit 1 with nothing written while another owner holds it, unless `--force`, whose log line names the owner it took the draft from; how long ago it was claimed is never judged. A claim the owner already holds writes and logs nothing. `--json` prints the stored draft. |
| `draft release D<n> [--json]` | Drop the claim, as a session ending with work left does. Releasing an unclaimed draft writes and logs nothing. |
| `draft note D<n> "<text>" [--assumption] [--json]` | Add a research fact, its paths written in the text, or with `--assumption` an assumption, as the next note `N<k>`. A blank text is refused at exit 1. `--json` prints the stored draft. |
| `draft ask D<n> "<question>" --context <text> --option <text> --option <text> [--option …] --recommended <letters> [--multiple] [--under Q<k>] [--json]` | Add the next question `Q<k>`, its options lettered `a` to `d` in the order given. `--multiple` makes it multi-select. `--recommended` names one letter, or on a multi-select question one or more, comma-separated (`a,c`). `--under` makes it a follow-up of an existing question, at any depth and whatever that question's answer. Refused at exit 1 with nothing written: fewer than two or more than four options, a blank question or `--context`, no `--recommended`, a recommended letter outside the options, several on a single-select question, or a `--under` question the draft does not hold. |
| `draft answer D<n> Q<k> "<answer>" [--json]` | Record the answer. A comma-separated list of option letters (`a`, `a,c`) chooses those options; anything else is free text, never both. Several letters on a single-select question, or a letter outside the options on either kind, is refused at exit 1 with nothing written, and so is a question the draft does not hold. Answering again overwrites the answer: the draft keeps only the current one, the log every one. Needs no claim, so the dashboard or any session may answer; the later write wins. |
| `draft drop D<n> N<k>\|Q<k> [--json]` | Remove a note or question made moot; dropping a question drops its follow-ups too, logging one line each. An item the draft does not hold is refused at exit 1. |
| `draft close D<n> --tickets <ids> [--json]` | End a draft once its tickets are filed: remove its file and log the ticket ids it became. `<ids>` are comma- or space-separated ticket references (`5`, `#005`); one that names no ticket is refused at exit 1 with nothing written, and so is no `--tickets`. While any question is unanswered, follow-ups included, it is refused at exit 1 with nothing written, naming the open question numbers in number order. A draft with no question closes at once, so a simple request goes open, note, tickets, close in one run. |
| `draft abandon D<n> --reason <text> [--json]` | Remove the draft's file, logging the reason. Refused at exit 1 without `--reason` or with a blank one. |
| `draft show D<n> [--json]` | One draft: its title, claim, state, file path, request, notes and question tree. `--json` prints the whole stored draft. |
| `draft list [--json]` | Every open draft, ordered by id; `--json` prints their stored documents. |

An id that is not `D` and a number, or names no open draft, is refused at exit 1. A draft numbers
its notes `N1`, `N2`, … and its questions `Q1`, `Q2`, …, each from its own stored counter, never
reused, not after a drop. A question is open while it has no answer.

Each open draft has a derived state, which no clock decides: `waiting` while any question is open,
claimed or not; `researching` when none is open and the draft is claimed; `resumable` when none is
open and nobody holds the claim. `status --json`, both documents, carries `drafts` after `epics`:
`{ id, title, claimOwner, openedAt, state, openQuestionCount, questions }` for every open draft ordered
by id, `claimOwner` null while unclaimed, `questions` the stored question tree, an empty list when
there is none. The page's `boardFacts.drafts` carries the same list from the same Board query.

### The dispatcher and concurrency

The limits and states here survive a compaction of the orchestrator's context, because they are
stored in the tracker.

| command | what it does |
|---|---|
| `concurrency [<n>] [--json]` | Print how many agents may be in flight at once, or store a new limit for every worktree: a whole number from 1 to 10. A higher one is refused at exit 1 with nothing written, and one an older tracker stored above 10 reads as 10. A tracker that never set one reads 2. A limit below the agents already in flight is accepted and simply leaves no free slot. A slot is an agent: the in-progress rows one `ticket claim` started count once, and every other in-progress row, such as a review bar, counts on its own. `--json` prints `{ limit, agentsInFlight, freeSlots }`, after a change as well. |
| `checks --install "<line>" [--json]` | Store the install line that prepares a fresh worktree before a gate, as `installCommand` in `progress.json`, written only once set, with one log line (`Install command set to <line>`, kind `install-command-set`). It is stored untried, and is part of a gate's cache key beside the tree and the check command. It goes alone: beside a check command, `--clear` or `--restamp`, or blank, it is refused at exit 1 with nothing written. `--json` prints `{ installCommand, previousInstallCommand }`. |
| `checks --definition-files ("<pattern> <pattern>…" \| --clear) [--json]` | Store the files the check line resolves through, as `checksDefinitionFiles` in `progress.json`, written only once set, with one log line (`Checks definition files set to <patterns>`, `Checks definition files cleared`, kind `checks-definition-files-set`). The patterns are git pathspec-style globs, separated by spaces and quoted as one argument: `*` and `?` stay inside one folder, `**` crosses folders, a pattern without an inner `/` matches its name at any depth (`package.json` matches `packages/a/package.json`), one with an inner `/` is anchored at the repository root, and a trailing `/` takes a folder's whole content (`.githooks/`). The runner's check V11 refuses a job (`checks-definition-changed`) when a commit in its range changes a matching path its ticket body does not name. With no list stored V11 checks no definition files and refuses nothing. `--clear` removes the key. It goes alone: beside a check command, `--install` or `--restamp`, blank, or beside both patterns and `--clear`, it is refused at exit 1 with nothing written. `--json` prints `{ checksDefinitionFiles, previousChecksDefinitionFiles }`, `null` when none. |
| `checks --key-command ("<line>" \| --clear) [--json]` | Store a shell line whose standard output joins a gate's cache key, as `gateKeyCommand` in `progress.json`, written only once set, with one log line (`Gate key command set to <line>`, `Gate key command cleared`, kind `gate-key-command-set`). It names what else invalidates a cached pass, such as the toolchain: `bun --version`, `python --version && uv --version`. It is stored untried. Before each gate cache lookup the runner runs it as it runs the gate — in the gate's sandboxed process host with the gate's profile, on the gated tree, never in the runner's own process; a merged tree's gate runs it beside that gate — and hashes its standard output, trailing newlines dropped, into the key with the tree, the check command and the install line. One that exits non-zero, or cannot run, caches nothing: the gate records `cannot-run` and opens `gate-cannot-run`. With none stored the key is exactly the tree, the check command and the install line, so no cached pass changes meaning. `--clear` removes the key. It goes alone: beside a check command, `--install`, `--definition-files` or `--restamp`, blank, or beside both a line and `--clear`, it is refused at exit 1 with nothing written. `--json` prints `{ gateKeyCommand, previousGateKeyCommand }`, `null` when none. |
| `checks --cache-paths ("<path> <path>…" \| --clear) [--json]` | Store the folders a gate and an install line may write besides the worktree, its git admin folder and temp, as `gateCachePaths` in `progress.json`, written only once set, with one log line (`Gate cache paths set to <paths>`, `Gate cache paths cleared`, kind `gate-cache-paths-set`). Each path is absolute or home-relative (`~/.bun/install/cache`), separated by spaces and quoted as one argument. With none stored a gate writes only its worktree, its admin folder and temp. A path that is, sits in or holds a `bin` folder, or is, sits in or holds a folder on the runner's `PATH`, is refused at exit 1 with nothing written (`~/.bun` and `~/.bun/bin` are, `~/.bun/install/cache` is not); one that became so after it was stored is left out of the gate's profile. Whatever is stored, the `bin` beside each of a cache path's ancestors is not writable to a gate; a folder inside a cache path is, a `bin` included. The stored lines also decide what a builder or reviewer may run unasked: the first word of each command in the checks line and the install line (split outside quotes on `&&`, `\|\|`, `;`, `\|` and parentheses, past a leading `NAME=value`), beside the git verbs it reads and commits with; no toolchain is allowed otherwise. `--clear` removes the key. It goes alone: beside a check command, `--install`, `--definition-files`, `--key-command` or `--restamp`, blank, or beside both paths and `--clear`, it is refused at exit 1 with nothing written. `--json` prints `{ gateCachePaths, previousGateCachePaths }`, `null` when none. |
| `checks ["<command>" \| --clear] [--restamp] [--json]` | Print the check command `release` runs on a branch's tip before it changes anything, or store one for every worktree with one log line (`Check command set to <command>`, `Check command cleared`): the repository's full check line, quoted as one argument. It lives in the tracker, never in the branch being released, and runs through the user's shell — `$SHELL`, else `/bin/sh` — in the branch's worktree. A new line is first run the same way in the main checkout, outside the lock: when it exits non-zero, nothing is stored or logged and it is refused at exit 1 with its last 20 lines, so a typo never stalls a release. `--clear` removes the key; `release` refuses a tracker that never set one (`checks-not-set`), and the read writes nothing. Every move of a ticket into in-progress (`ticket start`, `ticket claim`) stamps the stored line on its row as `checkCommand`, or removes the stamp when none is stored; so setting or clearing it while a ticket whose stamp would then differ is in progress or in review is refused at exit 1 (naming those tickets) unless `--restamp` is given, which stamps every in-progress and in-review ticket's row with the new line in the same write and logs a `ticket-check-command-restamped` line for each. A blank command, a command beside `--clear`, `--restamp` with neither, or `--clear` with none stored and no `--restamp` is refused at exit 1 with nothing written. Only the orchestrator's session changes it: `hook pre-tool-use` blocks a subagent's change. `--json` prints `{ checkCommand }`, `null` when none is stored, and a change adds `previousCheckCommand` and `restampedTicketIds`. |
| `dispatcher [running\|finished\|stopped] [--run <runId>] [--json]` | Print where the dispatcher was left, or store a new state with one log line. `running`: a dispatcher is at work. `finished`: it ended by itself; it is stored as written and reads as `stopped`, which fails closed. `stopped`: never started, or ended by the user, and it waits for the user's go however many tickets are filed meanwhile. A tracker that never set one reads `stopped`, and the read writes nothing; any other word is refused at exit 1. `running --run <runId>` stores the Workflow run beside the state — the one a killed run is resumed by, with the same args — and every write without `--run` clears it; `--run` beside another state or none, or an empty id, is refused at exit 1. `status --json` carries both as `concurrency.dispatcherState` and `concurrency.dispatcherRunId`. `--json` prints `{ dispatcherState, dispatcherRunId }`, the run id only while one is stored, and a change adds `previousState`. |

**A slot is an agent.** `ticket claim 3 4 5` writes the same `agent` key on each of a bundle's rows,
the claimed ids joined (`"003,004,005"`). The agents in flight are the `in-progress` rows grouped by
that key, each group counted once, plus every `in-progress` row with no key — a review bar started
while none of its claim's rows still runs, a `task add --start` row, a ticket started by
`ticket start` — each an agent of its own. A bundle whose tickets go to review one at a time keeps its
slot until its last row leaves in-progress, and a row that returns to in-progress other than from a
pause loses its key, so a reopened bundle ticket is a new agent.

**The dispatcher** is the Workflow script `.agent-progress/agent-progress-dispatch.js`
([Adopting a repository](#adopting-a-repository), item 6). It runs a builder per ready ticket, each on
a worktree of its own, within the board's limit, and hands each rebased branch to a clean reviewer
that releases it with `agent-progress release`. Builders and reviewers run on opus at medium effort
unless their ticket names another pair; the dispatcher's survey and parking agents run on haiku at low
effort. A finding a reviewer does not fix it files as a low-priority ticket. A second review round
runs only when a pass reworked more lines of code than the rework threshold the installed brief
states, and the dispatcher decides that in code. It starts no low ticket unless launched with
`includeLowPriority: true`, returning the low ones ready as `lowPriorityWaiting` instead.

- **A single-ticket run**, launched with `ticketIds: ['<id>']` and `readyTickets` (those tickets'
  entries copied from `status --json`), runs beside the whole-board one: no survey, one agent at a
  time, exactly those tickets through build, review rounds and release or parking, and the same
  summary; it never starts another ticket. A ticket given no `readyTickets` entry — one in progress,
  whose paused build it resumes — has its model and effort read with `ticket show <id> --json` before
  any builder or reviewer starts. When one names a `group`, the lookup also copies that group's
  tickets from `status --json`, and a ticket in the group's release bundle is refused, building
  nothing: the bundle is the group run's. A grouped ticket outside the bundle is built like any
  other; when the lookup lists no group tickets at all, every grouped ticket is refused.
- **A group run**, launched with `group: '<name>'` and no `ticketIds`, builds the group's release
  bundle, read from the board, on the branch `group-<name>` in the worktree
  `<mainCheckout>/.claude/worktrees/group-<name>`, both made off the main line on first use. The
  bundle runs in dependency order, lowest id first among equals, as a pipeline of at most one builder
  and one reviewer: builder N+1 claims with `ticket claim <n+1> --after <n>` on a branch forked off
  N's built tip while reviewer N rebases N onto the group branch, fast-forwards the group branch to
  it and approves it; reviewer N+1 starts only once N is integrated. The release ticket, last in the
  order, is reviewed once every other bundle ticket is integrated, and its reviewer alone reaches the
  main line: it integrates its own ticket onto the group branch, rebases the group branch onto the
  main line in the group worktree, runs the full checks and the root `CLAUDE.md`'s pre-release step
  there, and runs one `release` over every open bundle ticket with `--branch group-<name> --worktree
  <group worktree>`, which delivers them all and removes the group worktree and branch. A
  `main-moved` it returns takes one more review round on the bar it left running, and the next parks
  the release ticket, as in a whole-board run; a release reported by any other bundle ticket's
  reviewer parks that ticket and starts nothing more. The summary names the released tickets under
  `delivered`, with `integrated` and, behind a parked ticket, `waitingOnPredecessor`. It never
  reads or writes the board's dispatcher state or run id, shares the board's slot limit (a group
  builder waits for a free slot by its own background poll), ends on a board stop like a whole-board
  run, and a relaunch picks the pipeline up from the board alone.
- **A dirty main checkout.** A whole-board run's survey also lists the main checkout's uncommitted
  tracked files (`git status -s -uno`). When there are any, the run starts no
  agent and returns them as `dirtyMainCheckoutFiles`: a release git refuses over one of them
  (`merge-refused`) would come only after that ticket's build and review were paid for. Commit or
  stash them, then relaunch. A survey that does not say starts nothing either. A ticket parked on a
  refused release names, in its reason, the files the release's `blockingFiles` named.
- **Two agents in a row that return nothing**, across tickets, stop a run the way a board stop does,
  and it returns `stoppedByFailures: true`: those deaths count as no failed pass and park nothing.
- **What a run leaves.** A run that ends while a ticket it claimed is held, or is stopped before a
  build finished, leaves that build's row `paused` and the ticket in progress. Its summary names the
  builds it left paused and not held as `pausedBuilds`, the reviews it left waiting as `reviewsLeft`,
  each absent when empty, and a held ticket's step under `held: [{ id, waitingFor }]`. The next
  whole-board run resumes them.
- **Resuming a paused build.** A whole-board run's survey reads `pausedBuilds` and
  `reviewWaitingTickets` from `status --json`. It resumes every in-progress ticket whose own row is
  `paused` under a dispatcher run's claim note (`Built by the … dispatcher run on ticket-<id>`), whose
  worktree exists and which is not held: its builder resumes the row with `task start` and carries on
  in the ticket's worktree, keeping its uncommitted edits, without a new claim. It is ordered like a
  ready ticket of the same priority, just before one, and a low one only with
  `includeLowPriority: true`, until then named in `lowPriorityWaiting` as well. A paused row with any
  other note is a person's pause, left alone, and a paused build whose worktree is gone is never
  resumed. Of two runs that want one ticket, the atomic `ticket claim` gives it to one: each builder's
  claim note names its run, so a builder refused as in-progress carries on only past its own run's
  claim and otherwise returns. Every builder ends with `ticket finish <id> --start-review`, and its
  reviewer takes that bar over, so the ticket's slot is held from claim to release.
- **A run that died or was killed** is resumed rather than relaunched:
  `Workflow({ scriptPath, resumeFromRunId, args })`, with the id `dispatcher running --run` stored and
  the launch's args.

### Release and rework

| command | what it does |
|---|---|
| `release <id> [<id>...] --branch <b> [--worktree <path>] [--main <line>] [--json]` | Release a reviewed branch, and the only way one reaches the main line: allowing this command in the harness is the release permission, and a reviewer never runs `git merge` itself. In one lock hold, so two releases never race, it checks that each ticket is in-progress or in-review — or reviewed, when it is in a group's release bundle and that group's in-progress or in-review release ticket is released with it —, that the main checkout — the tracker's root, wherever this runs from — is on `--main` (default `main`), and that `<b>` is a local branch descending from it; fast-forwards; and moves each ticket to reviewed (unless it already is, so it is approved once) and delivered with `--branch <b>` and `--commit` set to the merged tip. In the same hold every `in-progress` review row whose `reviewOf` names a released ticket is finished and delivered at the release time and named. Several ids are the tickets of one bundle on one branch. A merge never lands ungated: a tracker with no check command stored (`checks`) is refused `checks-not-set` before anything runs. It first, outside the lock so no other release waits on it, needs `--worktree`, refuses unless that worktree's HEAD is `<b>`'s tip and it holds no uncommitted or untracked file, and runs the command there; it refuses when the command exits non-zero or changed a tracked file, and inside the lock when `<b>` moved or the stored command changed since. Before the command runs and again in the lock, each ticket's latest `## Review` must account for every numbered item of its `## Acceptance` (see the ticket file's format). Every refusal changes nothing, the review rows and the main checkout included. Afterwards it runs `git worktree remove` on `--worktree`, never forced, and `git branch -d <b>`; what git declines — a worktree holding untracked files, say — is named with its files at exit 0, since the release happened. |
| `rework [--since <commit>] [--rebased-from <old tip>] [--main <branch>] [--merge <commit>] [--worktree <path>] [--files] [--json]` | How many lines of code a review reworked on a branch — added plus removed lines, never blank lines, comments or documentation (`*.md`, `*.mdx`, `*.rst`, `*.txt` and anything under the repository's `docs/`) — so that a threshold on it gives every reviewer the same verdict; no threshold is built in. `--since` counts every commit in `<commit>..HEAD`, and is refused at exit 1 when `<commit>` is not an ancestor of HEAD or a merge lies in between: count a merge with `--merge`. `--rebased-from` counts what a rebase changed in the branch's own work — the hand resolution of its conflicts — as the added lines in which the branch's patch against `--main` (default `main`) differs before and after, so a line resolved by hand counts 2, main's own change none, and a rebase without conflicts 0; it is measured up to HEAD, so run it right after the rebase. See below for combining the two. `--merge` counts what a merge commit's resolution changed against git's automatic merge of its two parents (`git merge-tree --write-tree`), leaving out the conflict markers git wrote: a merge git made by itself counts 0, and a commit that is not a merge of two parents is refused at exit 1. `--worktree` reads that working tree instead of the current directory; `--files` adds a per-file breakdown. It needs no tracker, takes no lock and writes nothing. |
| `review record <id> --worktree <path> --since <review start> --findings-file <path\|-> [--rebased-from <pre-rebase tip> ...] [--main <main line> ...] [--bar <row>] [--json]` | Record one review pass as a `review-recorded` line in `log.jsonl` (see there), on the ticket's newest in-progress review bar, whose stored round it takes; a bundle's review runs on one bar, so its reviewer runs it once per ticket of the bundle, each with `--bar <row>` naming that bar, which must be an in-progress review bar of `<id>` itself or of a ticket claimed with it (their own rows sharing one agent key), or the record is refused at exit 1 and nothing is written; a reviewer runs it once per pass, on every outcome, before step 7 of the review brief, and again after a `main-moved` rebase or a `checks-failed` fix, the latest record of a round being the one that counts. It counts the rework with `rework`'s own reads, so the reviewer adds nothing: the fix lines are the commits in `<review start>..` the first `--rebased-from` (HEAD without one), what `rework --since` printed before the rebase, and each `--rebased-from` is counted as `rework --rebased-from` does, up to the next one's tip, HEAD for the last; it prints the total, which the reviewer reports as `reworkedLines`. One `--main` names every rebase's main line and the builder change's (default `main`), or one is given per `--rebased-from`. The builder's change is `git diff --shortstat <main>...<review start>`, kept because it is lost once the branch is released. The findings file (`-` reads standard input) is a JSON object: `verdict` (`released`, `round-requested`, `does-not-hold`, `not-released`, `integrated`); `claims`, one per Fails-review claim and Acceptance item, each `item`, `result` (`holds`, `does-not-hold`, `waived`, `waiver-proposed`) and `handoffContradicted` (true when the reviewer's measurement disagreed with the Handoff); and `findings`, each `class` (`correctness`, `acceptance-gap`, `test-gap`, `handoff-claim-false`, `convention`, `docs`, `rebase`, `out-of-scope`), `severity` (`would-ship-a-bug`, `acceptance-fails`, `quality`, `nit`), `file`, `summary`, `evidence` (`watched-fail`, `probe`, `reading`) and `outcome`, `fixed` with its `commit` or `filed` with its `filedTicketId`; other keys are dropped. A word outside those, a missing field, or a ticket with no in-progress review bar is refused at exit 1 and nothing is written. The dispatcher's reviewer reply takes the same `class` and `severity` words. |
| `review-stats [--json]` | What the recorded reviews catch, miss and cost. A *recorded ticket* is one with at least one `review-recorded` line in `log.jsonl`; each `round` of a ticket is one *pass*, its latest line the one that counts as `review record` says, so a ticket with two passes counts two passes and one ticket. Every other ticket appears in no table and is counted on the last line (`unrecordedTicketCount`); with no recorded ticket at all it prints one sentence saying so, at exit 0. It prints one table over every recorded ticket (`all`), then one per split, a column per group that has a ticket: by ticket `type` (`byType`); by the builder's change size, the `builderInsertions` plus `builderDeletions` of the ticket's first pass, `<=50 lines`, `<=200 lines`, `<=750 lines` or `>750 lines` (`byChangeSize`: `small`, `medium`, `large`, `oversized`); and by the ticket's builder `model` and `effort`, the defaults filled in (`byBuilder`). Per group: *tickets recorded* (`ticketCount`); *review passes* (`reviewPassCount`); *rounds per ticket*, the distinct `round` values of each ticket's passes summed and divided by the tickets (`roundsPerTicket`); *verdict* counts over the passes (`verdictCounts`); *findings* over the passes by `class` (`findingCountByClass`) and by `severity` (`findingCountBySeverity`); *serious findings*, those of severity `would-ship-a-bug` or `acceptance-fails` (`seriousFindingCount`), and per ticket (`seriousFindingsPerTicket`); *review tokens per ticket*, the `tokens` of every row whose `reviewOf` is the ticket, ticket-owned rows excepted (`reviewTokens`, `reviewTokensPerTicket`); *builder tokens per ticket*, the `tokens` of the ticket's own row (`builderTokens`, `builderTokensPerTicket`); *review tokens per serious finding* (`reviewTokensPerSeriousFinding`); for the delivered tickets whose last pass in log order had a serious finding (`afterSeriousLastReview`) and those whose last pass had none (`afterCleanLastReview`): *delivered* (`deliveredTicketCount`), *escaped bugs*, the bug tickets whose `introducedBy` names one of them (`escapedBugCount`), and *escaped bugs per delivered* (`escapedBugsPerDeliveredTicket`); *tickets filed from reviews*, the tickets whose `foundInReview` names the ticket (`ticketsFiledFromReviewsCount`); *claims* over the passes (`claimCount`) and the share whose `handoffContradicted` is true (`handoffContradictedClaimCount`, `handoffContradictedShare`, a percentage in the text); *fix lines per ticket* and *rebase lines per ticket*, the passes' `fixReworkedCodeLines` and `rebaseReworkedCodeLines` summed and divided by the tickets (`fixLines`, `fixLinesPerTicket`, `rebaseLines`, `rebaseLinesPerTicket`). Rates print with two decimals and tokens rounded to whole numbers; a rate over nothing is `-` in the text and `null` in `--json`, which prints the same numbers unrounded as one document. A line naming a ticket the board does not hold is left out. It takes no lock and writes and renders nothing, as `status` does. |

**Release refusals.** `--json` prints, on a refusal, `{released: false, reason, detail, blockingFiles, cleanup: []}`,
`cleanup` always empty because nothing ran, `blockingFiles` the main checkout's uncommitted files, tracked or
untracked, that the merge would overwrite (on `merge-refused`; empty otherwise), and `reason` is one of:

| reason | exit | when |
|---|---|---|
| `invalid-request` | 1 | the arguments do not describe a release — no id or no `--branch`, a branch named like an option or after the main line, an unknown option — or there is no tracker here, or its installed files are of another install version |
| `unknown-ticket` | 1 | a ticket id names no ticket |
| `ticket-not-releasable` | 1 | a ticket is not in-progress or in-review, nor a reviewed ticket of a group's release bundle released with that group's release ticket |
| `unknown-branch` | 1 | `<b>` is not a local branch |
| `not-on-main-line` | 1 | the main checkout is not on `--main`, or `--main` is not a local branch |
| `checks-not-set` | 1 | the tracker stores no check command, and a release never lands a branch ungated: set one with `agent-progress checks "<command>"` and release again |
| `worktree-not-at-tip` | 1 | a check command is stored and the `--worktree` HEAD is not `<b>`'s tip, before the command runs or after it moved it |
| `worktree-dirty` | 1 | a check command is stored and the worktree holds an uncommitted or untracked file before it runs, or a tracked file it changed: commit or remove them, and release again |
| `checks-failed` | 1 | the stored check command exited non-zero or could not be started; `detail` ends with its last 20 lines of output, standard error included: fix, commit, and release again |
| `check-command-changed` | 1 | the stored check command changed, or was set or cleared, while the release ran it |
| `check-command-differs-from-start` | 1 | a released ticket's row was stamped, when it moved into in-progress, with another check command than the stored one, no command on either side counting as a value; with or without a stored command, before it runs and again in the lock. The detail names both lines and the orchestrator's remedy, `agent-progress checks "<line>" --restamp` |
| `acceptance-unnumbered` | 1 | a released ticket's `## Acceptance` holds no numbered item (`A1.` at the start of a line); read before the check command runs and again in the lock, each ticket of a bundle on its own, as are the two below |
| `acceptance-unaccounted` | 1 | an Acceptance item has no `holds` or `waived` line in the ticket's latest `## Review`, or has a `does not hold` one; the detail names the items |
| `acceptance-waived` | 1 | every item is accounted for, but the Review waives one the Acceptance does not mark `Waived:`; the detail names the items and their reasons. Only the user waives: once agreed, the item is marked `A3. Waived: <reason>` and the release runs again |
| `branch-moved` | 1 | `<b>` moved off the commit the checks passed on while they ran: release again |
| `main-moved` | 1 | `<b>` does not descend from the main line: rebase `<b>` onto it, re-run the checks, count the rebase with `rework --rebased-from`, and release again |
| `merge-refused` | 1 | git will not fast-forward, typically over the main checkout's own uncommitted changes, which `blockingFiles` names and a refusal leaves as they were — never the branch's files: whoever made them stashes them, or commits them when they belong on the main line, and the release runs again |
| `git-failed` | 2 | git could not be read |
| `tracker-failed` | 2 | the tracker could not be read, or its lock could not be taken |

`--json` prints, on success,
`{released: true, tickets, branch, mainLine, commit, checkCommand, closedReviewRows, cleanup}`: `tickets` the ids just
delivered, `checkCommand` the stored check command that passed, `closedReviewRows` the
ids of the review rows it delivered with them, and `cleanup` each step, the worktree's first when `--worktree` was
given, as one of these, `reason` being git's:

```
{target: worktree, path, outcome: removed}
{target: worktree, path, outcome: left, reason, untrackedFiles, changedFiles}
{target: branch, name, outcome: deleted}
{target: branch, name, outcome: left, reason}
```

**Counting a rebase.** A rebase rewrites the commits after `<commit>`, so either count `--since`
before rebasing and `--rebased-from ORIG_HEAD` after it, or rebase first and take `<commit>` from the
rebased tip: both options in one call then measure the rebase up to `<commit>` and print one total
and the two parts, counting nothing twice. Comments are read per file type — `//` and `/* */`, `#`,
`<!-- -->`, Python docstrings, a `<script>` or `<style>` inside HTML — a line of code with a trailing
comment is code, and a file type it does not know counts every non-blank line.

### Cost: the hook and usage

| command | what it does |
|---|---|
| `hook bash-domains --allow <domains>` | Keep a job's network inside its ticket's `network` line: the `PreToolUse` guard a runner renders into a job's settings for a role with a `network` line, since auto mode's classifier may grant a domain the session asks for. It denies, through the hook's JSON on standard output (`hookSpecificOutput.permissionDecision` `deny`, with a reason), a `Bash` call whose `allowed_domains`, or a `WebFetch` whose URL host, names a domain outside the comma-separated `--allow` list; an entry `*.example.com` admits that domain's subdomains, never the domain itself. Every other call passes, printing nothing and granting nothing. It reads no tracker, skips the install-version check, runs directly under a job, and exits 0 whatever happens, answering deny on any failure: no input, input that is not a JSON object, a url naming no host, an `allowed_domains` that is no list of domains, an unknown option. |
| `hook post-tool-use` | Keep the page live while agents work. `init` and `update` wire it as a `PostToolUse` hook on every tool beside `hook subagent-stop`. It regenerates `progress.html` and its stamp, as `render` does, only when the page file is more than 5 minutes old (half the page's 10-minute live limit), and otherwise does nothing. It finds the tracker from its own working directory and reads no hook input. It never waits on the tracker lock: a lock another process holds skips the render. It never prints, and every run exits 0, whatever goes wrong — no tracker, installed files of another install version, an unreadable tracker — since its exit would otherwise reach the agent's tool call; `render` reports what is wrong. |
| `hook pre-tool-use` | Keep the check command the orchestrator's. `init` and `update` wire it as a `PreToolUse` hook on `Bash` beside `hook subagent-stop`. It blocks, at exit 2 with the reason on standard error, a subagent's Bash call whose command line runs `agent-progress checks` with a command line, `--clear` or `--restamp`, anywhere in it (after a `cd <dir> &&`, behind `;`, in `$( )`); a read (`checks`, `checks --json`), every other call, and unreadable input pass at exit 0. It tells a subagent's call from the main session's by `agent_id` alone: it relies on Claude Code setting `agent_id` (and `agent_type`) in the hook input only on a subagent's tool call, so a main-session call is never blocked. It reads no tracker and checks no install version. |
| `hook subagent-stop` | Record what a finished subagent cost, as one log line. The hook JSON arrives on standard input, and the agent's transcript is summed per API call rather than per line. When the agent's brief — its first message — holds a line `agent-progress row: <id>`, or several ids separated by commas, the log line's `input` total is also added to those rows' tokens, divided evenly. A line `agent-progress ticket: <id>` names tickets instead, each resolved to the row it holds when the hook runs. A line `agent-progress review: <id>` names one ticket whose review row the reviewer files itself: the total goes to the most recently added row reviewing that ticket (its `--review-of`; the name is not read), whatever its status; a row a ticket owns is never a review row. A brief with several is read by one alone: `row:` over `ticket:` over `review:`. The tracker is found from the hook input's own `cwd`. `init` and `update` wire it into `.claude/settings.local.json`; nobody types it. Once its arguments are read (the event word alone, no option; anything else is refused at exit 1) it exits 0 whatever goes wrong — no input, an unreadable transcript, no tracker, installed files of another install version, a row or a ticket's row that does not exist — and writes the reason to standard error: the agent has already finished, so a non-zero exit would prevent nothing and only give the orchestrator an error to read. |
| `usage [--since <when>] [--transcripts <folder>] [--json]` | What this repository's subagents cost, read out of the transcripts the harness wrote for them under `~/.claude/projects/`, a workflow's agents under `subagents/workflows/<run>/` included: one row per agent, oldest first, with its start, its API calls, its end context, its input and output, its browser calls, the characters the harness injected into it and the first line of its brief; then the cohort summary — median calls and end context, mean input and output, and the mean of each figure below. Three columns catch a brief being breached without anyone reading a transcript: `over 200k` is the share of an agent's input sent at a context past 200,000 tokens (a raw token count under `--json`), `bash edits` counts the edits it made through a shell command — a heredoc, an inline interpreter or an in-place editor — instead of the editing tools, and `checks` counts the full test, type-check and lint runs it made per edit instead of per batch. `--since` splits the cohort on an instant and summarises both sides, which is how a change in the way agents are briefed is measured. `--transcripts` reads a folder other than the one this repository's path resolves to. It writes nothing, takes no lock and regenerates no page; a repository with no transcripts is one sentence at exit 0. |

### The page and the board's lifetime

| command | what it does |
|---|---|
| `range --from <when> --to <when> [--tick <15m\|1h\|1d>]` | Store the default axis of the chart, with one log line. `--tick` takes any positive whole number of minutes, hours or days (`15m`, `2h`, `1d`), or a bare number of minutes. Besides a `<when>`, a bound may be `start`, the earliest visible row. A relative bound is stored as written, so `--from -2h` keeps meaning "the last two hours" on every refresh. A pair that is not in order is refused at exit 1 when both are timestamps or both are relative to now; a pair naming `start` or mixing the two is not judged. The page's own range menu overrides it per browser. |
| `range --auto` | Reset the axis to the automatic span. It takes no `--from`, `--to` or `--tick`; any of them beside it is refused at exit 1. |
| `render` | Regenerate `progress.html` from the progress file, `log.jsonl` and the tickets, changing nothing else — for a page lost to a crash, or after a ticket body was edited by hand. An unreadable tracker is exit 2. |
| `open` | Open the live runner's URL when the newest lease in `.agent-progress/runner/` names a live process; otherwise open `progress.html` in the default browser (`open` on macOS, `xdg-open` elsewhere), rendering it first when it is missing; a page that cannot be rendered is exit 2, as for `render`. |
| `run [--port <n>] [--detach] [--json]` | Start the board's one runner, in the foreground, logging to standard error and appending to `.agent-progress/runner.log`. It binds `127.0.0.1` with `reusePort: false` on the port `RUNNER_PORT_FIRST` plus the first four bytes of `sha256(trackerId)` modulo `RUNNER_PORT_COUNT` (100), moving upward past a port in use, so a board keeps its port across restarts; `--port` binds the one given, `0` any free one. It then creates `.agent-progress/runner/lease-<n>.json` exclusively — `{processId, processStartEpochSeconds, bootIdentity, port, url, tokenFile, codeVersion, installVersion, hostProtocolVersion}` — writes a fresh API token to `.agent-progress/runner/token` (mode 0600, the folder 0700), logs `runner-started`, adds `runner: {url, processId, startedAt}` to its monitor registry entry, and prints the URL (`--json`: `{url, generation}`). The newest lease naming a live process (its pid, start and boot all matching) refuses `runner-already-running` with its URL at exit 1; one naming a dead process lets the starter create the next generation, as after a crash, and a starter that then finds a newer generation refuses `runner-contended` at exit 1. The holder removes older generations; nobody unlinks a lease it does not hold. Before each effect batch the runner checks that its generation is still the newest and otherwise stops `lease-taken-over` at exit 2, touching nothing. `GET /api/identity` answers `{application, trackerId, project, codeVersion, installVersion, hostProtocolVersion, processId}`; `POST /api/commands` takes `{kind: runner-stop\|runner-restart, now}` with the bearer token. A stop logs `runner-stopped`, removes the registry key and then the lease. `--detach` starts the same command detached and prints the URL once `/api/identity` answers, within a bounded number of tries, or refuses `runner-did-not-start` at exit 1. |
| `run --successor-of <generation> [--port <n>]` | The successor's side of `run restart`'s handover, which only the live runner starts; see `run restart`. |
| `run stop [--now] [--json]` | Stop the live runner: the command goes to its API with the token from the file the lease names, or, when the API does not answer, SIGTERM goes to the process the lease names, its identity checked first. It waits a bounded number of tries for the lease to be gone or to name a dead process, else refuses `runner-still-live` at exit 1. Agent hosts are never touched; `--now` also stops process hosts. With no live runner it has nothing to do (exit 0). It checks no install version. |
| `run restart [--now] [--json]` | The checked handover to the code on disk, which checks the install version first. The live runner writes `requested` to `.agent-progress/runner/handover-<generation>.json` and spawns `run --successor-of <generation> --port <its port>` detached, its standard error appended to `runner.log`, and keeps driving. The successor, holding no lease, builds its host and page bundles, reads the board, every job record and every claimed host file and its event log, checks the manifest against its own install version, and writes `ready`, or `successor-failed` with the step (`build-bundles`, `read-board`, `read-jobs`, `read-host-files`, `install-version`) and its error. On `ready` the old runner finishes a pass in progress (a landing included), starts no other, logs `runner-stopped` `handed-over`, closes its listener and writes `released`; no host is sent anything. The successor then binds the port, takes generation n+1 (the handover file admits it beside the live identity), logs `runner-started`, reattaches every host from its stored cursor and writes `serving`; the old runner exits. A successor that fails before `released`, exits without a report, or reports nothing within `HANDOVER_READY_TRIES` × `HANDOVER_READY_INTERVAL_MILLISECONDS` (it is then killed, identity checked) leaves the old runner driving; one that fails after it (`bind-port`, `take-lease`, `reattach`) gives its generation up, and the old runner takes n+2, rebinds and reattaches. Either way the old runner logs `runner-handover-failed`, writes `failed` and shows the failure as a warning in `run status` until a handover succeeds, and `restart` refuses `runner-handover-failed` at exit 1. A successor whose old runner dies while it waits starts as after a crash. On success it prints `Runner handed over to code <codeVersion> at <url>` (`--json`: `{outcome: done, url, codeVersion}`). A runner whose API does not take the command is stopped and started again detached on its port; with none live one is started. The runner never restarts itself. |
| `run pause\|resume [--json]` | Store `dispatcherState` `stopped` or `running` through the write pipeline, logged as the dispatcher state, with the runner up or down: a paused runner starts no new job. `--json` prints `{dispatcherState, previousState}`. |
| `run status [--json]` | The newest lease, the URL, the runtime state from the runner's `GET /api/state` (`serving`, `held-by-install-change`, `handing-over`; `starting` while the API does not answer yet, or `down`), whether the board is paused, the code version on disk against the live runner's, the runner's notices, and the warning of a failed handover. Read-only, no lock, no install-version check. `--json` prints `{state, paused, url, lease, codeVersionOnDisk, codeVersionInMemory, notices, handoverWarning}`. At each sweep and after each landing (a move of the main line's tip) the runner runs the on-disk binary's `version --json` as a child, and it reads the manifest on every pass: an install version that differs from its own holds launches (`held-by-install-change`, the stored `dispatcherState` untouched) with the notice `install-version-changed`, "run `agent-progress update`", until the versions match; code that differs alone only shows the notice `new-code`, "new code: run `agent-progress update`". A host on a protocol below `HOST_PROTOCOL_OLDEST_SUPPORTED` is a legacy host, listed in the state's `legacyHostJobIds`: sent no frame, its host file and event log read in its own `EVENT_LOG_FORMAT_VERSION`, and stopped by signalling its recorded process group, identity checked. A relayed request of a `relayFormatVersion` the runner does not read stays pending, unanswered, until a runner that reads it. |
| `version [--json]` | Print `{codeVersion, installVersion}`: a content hash of the program's shipping files on disk, and the install version this program writes. Read-only; it needs no tracker and checks no install version. |
| `merges [--json]` | The merge queue, read as `status` reads the tracker (no lock, nothing written): each held slot `{target, jobId, ticketIds, phase, targetTip, branchTip}`, then each queued ticket `{ticketId, target, priority, queuedAt}` by target, priority, then queue order (the slot's own pick also weighs predicted conflicts), `queuedAt` its `merge-queued` record's place in the log. `--json` prints `{slots, queue}`. |
| `decisions [--json]` | The open decisions for User, read from `progress.json` (no lock, nothing written), in opening order, each question's options lettered `a`, `b`, `c` as `decide` takes them. `--json` prints `{decisions}`, each `{id, kind, ticketIds, jobId, askedBy, requestId, questions, context, openedAt}`. |
| `decide <decision> <letters>... \| -- <text> [--json]` | Answer an open decision through the write pipeline, with the runner up or down: one choice of option letters per question (`decide E7 b`; `decide E7 b ac` when the second question is multi-select, its labels joined by `, `), or free text after `--` for a decision asking one question (`decision-has-several-questions` otherwise). A letter naming no option is refused `decision-option-unknown`, several letters on a single-choice question `decision-single-choice`, a wrong number of choices `decision-answer-count`. The first answer wins (`decision-already-answered`). The answer is stored as `{question: answer}` and logged `decision-answered` with the question request it answers; the request id joins the asking job's `answeredRequestIds`, and a job waiting on that answer alone moves back to `running`. The runner then delivers it: a live host still holding the request gets the `control_response` allow with `updatedInput.answers`; a resumed session takes it as its first user line. A question whose ticket job ended `replaced` or `stopped` was held on its ticket `awaiting answer (E<n>)`: the answer goes under the ticket's `## Questions` and lifts the hold. `--json` prints `{decisionId, answer}`. |
| `incidents [--json]` | The open incidents for the runner's orchestrator, read from `progress.json` (no lock, nothing written), in opening order, each with its facts, the moves its kind allows and its default. `--json` prints `{incidents}` as `progress.json` stores them. |
| `incident answer <I> -- <text> [--json]` | Answer a `system-question` or `malformed-ticket` (`incident-not-a-question` for another kind): logged `incident-handled` and `incident-answered` with the question's request, which joins the waiting job's `answeredRequestIds`, so the runner delivers it as it delivers a decision's answer and the job runs again once nothing else it asked is open. A `malformed-ticket`'s answer, or one no job waits on, is also written under the ticket's `## Questions`. |
| `incident note <I> -- <text> [--json]` | Record a finding under the incident, logged `incident-noted`; the incident stays open. |
| `incident escalate <I> [--json]` | Close the incident and put exactly the agent's questions to User as an `agent-question` decision on the same tickets, job and request, logged `incident-escalated`; one carrying no questions is refused `decision-without-questions`. Every move naming an incident, here or through `--incident`, is refused (`incident-move-not-allowed`, `finding-not-listed`) unless the incident is open and its kind's row of `ALLOWED_MOVES_BY_INCIDENT_KIND` allows the move, and marks it handled in the same hold. |
| `jobs [--json]` | The live jobs, one line each (id, kind and role, state, tickets, attempt, host instance, a stop asked), then the runner (`live` with its URL, or `down`), paused or not, agents against the limit, the open decisions and incidents, and a warning line per incident that took its default since the runner last started. Read-only, no lock. `--json` prints `{jobs, runner, paused, agentsInFlight, limit, openDecisions, openIncidents, defaultedIncidents}`, each defaulted one `{incidentId, move, cause, at}`. |
| `job show <J> [--json]` | The job's record from `progress.json`, or for a finished job what its `job-launched` and `job-ended` records hold, and its job folder; an unknown job is refused. Read-only, no lock. `--json` prints `{job, jobFolder}`. |
| `job attach <J> [--json]` | Every host instance's event log in instance order through the adapter's mapper, then the newest followed while the job is on the board; it never connects to a host. Read-only, no lock. `--json` prints `{jobId, lines}` of the replay and follows nothing. |
| `job message <J> [--incident <I>] -- <text> [--json]` | Record a chat turn in a hold, logged `job-messaged`, with the runner up or down; the runner writes it to the live session in log order, once. A finished job, or a session whose input is closing, is refused `job-finished`. Under an incident it is refused `job-awaits-user-answer` for a job in `waiting-for-answer` or whose ticket has an open `agent-question`, and `job-is-product-owner` for User's product-owner session. |
| `job fresh <J> [--incident <I>] [--json]` | See `job wind-down\|stop`; `--incident` names the incident it handles. |
| `job wind-down\|stop <J> [--json]` | Logged `job-stop-requested` with its mode and kept as the job's `stopRequest`, with the runner up or down. `stop` and `wind-down` hold the job's ticket `stopped by User (J<n>)` or `wound down by User (J<n>)` in the same hold (an already held ticket keeps its hold), which the policy never undoes; `ticket unhold` lets a fresh agent take it. `wind-down` sends the wind-down turn; `stop` moves the job to `stopping` and the runner stops its host, the job ending `stopped`; a job with no session yet (launching, preparing, interrupted, awaiting an answer) ends `stopped` in the same hold. A stopped product owner is finished: its open decisions are withdrawn (`decision-withdrawn`), its drafts stay drafts, and it is never resumed. `fresh` holds nothing and ends the job `replaced`, so the next attempt starts on its worktree with the earlier-session note; a job with no ticket is refused `job-has-no-ticket`. |
| `job stop --all [--wind-down] [--json]` | `run pause`, then a stop (or wind-down) of every build, review and product-owner job, in one hold. |
| `intake -- <text> [--json]` | Record a `product-owner` job with no ticket and no build slot, `launching`, with the runner up or down; several may run at once. The runner launches it in `<worktrees>/sessions/<J>/`, its first line `/<agent-po skill> <text>`, skills on, WebFetch and WebSearch allowed and Bash `allowedDomains: []`; it files drafts through its relay folder and never readies one. Follow-ups are `job message` turns. |
| `intake close <J> [--set <id,id>]... [--json]` | Close the product owner's input (`job-not-intake` for another kind of job, `job-finished` once closed). Once no host of it is live the runner ends it `closed` and opens a `ready-drafts` decision listing the drafts it (and any session it took over from) filed, each with its priority and `network` domains: one option per `--set` of readiable drafts, else one of all of them, and `None`; a draft without a numbered Acceptance or a Brief is listed as not readiable. Answering readies the chosen drafts in the answering hold. Under the product owner's own job it names no job: the runner stamps its own. A product owner interrupted by a reboot resumes by id once its question is answered; one past the crash bound with a question open waits `awaiting-answer`, and once answered a fresh session takes over with its drafts and the answers in its first message, never a resume. |
| `await [--json] [--after <n>]` | Wait until the log holds a `decision-opened` or `incident-escalated` record past position `<n>` (the log's length at the start when absent; positions count from 1), then print them and stop. `--json` prints `{after, position, records}`, each record with its `position`; the next wait is `await --after <position>`. A stop signal ends the wait with nothing printed. Read-only, no lock. |
| `clear [--all] [--yes]` | Throw away every task row and the log, restart the clock and reset the stored axis to automatic, leaving one `Tracker cleared` log line, and keep the tickets: each surviving ticket is given a fresh row seeded from its own frontmatter, with a new id, except a low ticket with no row. Row ids are not reused, and every epic file is kept untouched. `--all` deletes the tickets and every epic too and restarts the ticket ids at 001; `--json` prints `removedTaskCount`, `removedLogCount`, `deletedTicketCount`, `deletedEpicCount` and `reseededTicketCount`. `--yes` skips the confirmation, and is required when standard input is not a terminal. |

### A build job

A readied ticket's build job moves through job states, each one a pass of the runner. `launching` becomes `preparing`
(the ticket goes `in-progress`): the runner adds `<worktrees>/ticket-<id>/` on branch `ticket-<id>` from the target's
tip and runs the install line there in a process host under `sandbox-exec` with the job's profile, network on. Once
it ends at exit 0 (or with no install line stored) the job is `running` and the builder launches, its first message
holding the ticket and the checks line, confined by the per-job settings: writes denied to the data folder, the
monitor folder, the worktree's `.claude/`, `packed-refs`, the target refs, every other ticket branch and every other
worktree's admin folder; reads denied of the runner token, the launch files, the host sockets, `~/.ssh`, `~/.aws` and
`~/.gnupg` (only its private keys when the gpg-agent socket signs); writes outside the worktree only to its own relay
folder; a ticket's `network` line its only network. Its closing `result` moves it to `verifying`, the runner closes
its input and verifies; a verified `built` report is `gating`, the checks line run in a second sandboxed process host,
network on only for a ticket with a `network` line. On a pass the runner writes the gate cache entry
`<data>/gates/<key>.json`, replaces the ticket's `## Handoff` with the report's handoff and Acceptance evidence, moves
the ticket `in-review` and ends the job `built`; the policy then launches the review job in the same hold.

| what happens | what the runner does |
| --- | --- |
| worktree creation or the install line fails | incident `setup-failed`; the job ends `stopped` |
| the session exits without a valid report | a failed pass: `job-ended` `failed`, cause `no-report` |
| a commit in range carries an attribution trailer | a failed pass, cause `attribution`; the ticket shows the `attribution-found` notice until its next job ends |
| any other verification refusal, or the gate fails | a failed pass, its cause the refusal reason or `gate-failed` |
| the report says `blocked` | incident `blocked`; the job ends `blocked` |
| the report says `wound-down` | incident `out-of-calls`; the job ends `wound-down` |
| the call budget is reached | the wind-down message is sent once |
| the budget plus `WIND_DOWN_GRACE_CALLS` (10) is reached | incident `out-of-calls`; the job is `stopping`, then ends `stopped` |
| the checks process exits 126 or 127, or is killed by a signal | incident `gate-cannot-run`; the job ends `stopped` |
| no checks line is stored | the `checks-not-set` decision; nothing launches |
| a running build or review's event log stands still for `QUIET_JOB_SWEEPS` (6) sweeps | incident `quiet-job`; its default opens the `quiet-job` decision |

A ticket an open incident names launches no new job until the incident is settled. An incident's default applies when
its delivery turn closes; while no orchestrator runs, a `merge-gate-failed` or `resolution-over-threshold` takes it at
once, and while none can come up (`FAILED_ORCHESTRATOR_BOOTS_BEFORE_DEFAULTING` failed boots, or a usage limit) every
incident does, each logged `incident-defaulted {move, cause}`. A park or a merge abort holds the ticket
`parked:<kind>` with a `parked` decision, a triage triages what is still listed, the quiet-job default opens its
decision, and a repair, gate retry or fresh agent is taken once per ticket, the next one of its kind parking. Where
`sandbox-exec` cannot apply
a profile, the process hosts run unconfined and gate passes are kept in the runner's memory only.

### The merge slots

After each pass the runner sweeps one merge slot per target: the main line and each `group-<name>` with an open
ticket. A queued ticket (in review, `mergeQueued`, unheld,
no open `waiver` or `landing-refused` decision) is a candidate; candidates are predicted with `git merge-tree` and
ordered by priority, clean before conflicting, fewest conflicts caused, readiness, then id. The claim, in its own
hold, refuses while a merge job holds the slot, when either tip moved since the prediction, and
`higher-priority-queued` when a candidate of a strictly higher priority waits; it launches a `merge` job whose record
carries `slot: {target, targetTip, branchTip, phase}` and logs `merge-started`. Each phase is written on the slot in
its own hold. The merge-in merges the recorded `targetTip`, never the moving name, once, in the ticket's worktree; a
conflict launches a `merge-agent` job, role `resolver`, which cannot ask and has `RESOLVER_API_CALL_BUDGET` calls. The
merged tree is gated, then landed by a compare-and-swap fast-forward in the main checkout, logging `merge-landed` and
delivering the ticket. `git log --first-parent` of the main line therefore runs through ticket branches; the
`merge-landed` records keep the per-ticket view.

A group integrates in its own worktree, `<worktrees>/group-<name>/` on `group-<name>`, created from the main line's
tip at the group's first launch; each group ticket's branch forks off the group's tip. A group ticket's slot targets
`group-<name>`: after the compare-and-swap it lands by `merge --ff-only` in the group worktree, logging `merge-landed`
of kind `integrated`, and the ticket moves to `reviewed`. Only landings touch the group worktree. A refresh is due when
`git rev-list --count group-<name>..<main line>` reaches `GROUP_REFRESH_AFTER_MAIN_COMMITS` (30) or the group's tip is
predicted to conflict with the main line, and never while the group's release ticket is queued or holds the main
line's slot, nor while a refused refresh's `merge-refused` decision is open. It is a `refresh` job holding the group's
slot, with `slot.branchTip` the main line's tip: it merges that tip in a temporary detached worktree
`<worktrees>/refresh-group-<name>/`, gates, lands by the same `merge --ff-only`, ends `refreshed` and removes the
temporary worktree; the claim refuses `refresh-beside-a-queued-release`, and `merge-slot-held` while the slot is held,
so there are never two refreshes. The group's release ticket targets the main line, a candidate only once every other
ticket of its bundle (walked through `dependsOn`) is `reviewed` and no refresh holds the group's slot, with the
bundle's highest priority. A release whose branch does not hold the group's tip is refused (`merge-refused`, cause
`release-behind-group`) before its merge-in. It merges the main line once in its own worktree, gates, fast-forwards
the main line and delivers the whole bundle; the group worktree is then removed and `group-<name>` deleted with
`branch -d`, never forced.

| what happens | what the runner does |
| --- | --- |
| the resolver reaches its budget, reports `cannot-resolve`, or V10 fails | the merge aborts, the slot frees, the ticket leaves the queue and the `merge-refused` decision opens with the report's `notes`; a `reportKind` of `malformed-ticket` or `system-blocker` also opens a `malformed-ticket` or `system-question` incident with no job waiting |
| the resolution changes over `RESOLUTION_REVIEW_THRESHOLD_LINES` (150) lines against git's automatic merge | incident `resolution-over-threshold`; the slot waits for its move |
| the merged tree fails its gate | incident `merge-gate-failed`; the slot waits for its move |
| the main line moved to a tip a `merge-landed` names, or to another one | the worktree is reset to `branchTip` and the ticket requeued silently; after `TARGET_MOVED_MERGES_BEFORE_PARKING` (2) unrecorded moves in a row the ticket parks |
| the main checkout is off the main line, or its changes block the fast-forward | the slot frees and that target's landings wait under the `dirty-main-checkout` notice, rechecked every sweep; builds and reviews launch on |
| the check stamp differs or the Acceptance is not accounted for | `mergeQueued` cleared, the ticket held, decision `landing-refused` |
| the main line already holds the merged commit (a crash after the fast-forward) | the board side is finished |
| a merge-in left `MERGE_HEAD` with no live holder, or the resolver ended with no usable result | `git merge --abort`, a reset to `branchTip`, and a requeue; a live or interrupted resolver keeps the slot |

When a session is first launched the runner writes `<data>/jobs/<jobId>/start.json`: the worktree's HEAD, the ticket
body's hash, every ref's commit from `git for-each-ref`, each detached worktree's HEAD and a digest of the hooks
folder. Verification then also runs, for every role, V13 (no commit in range and no worktree file changes `.claude/`,
`.mcp.json` or the hooks folder, `core.hooksPath` read from git, `.git/hooks` otherwise) and V14 (no ref but the
job's own branch, another live job's branch, or a target a recorded landing moved to its commit has moved since
launch, refusal `foreign-ref-moved`); a reviewer's also runs V12 (every `filed` finding names, by `filedTicketId` or
by the `relayRequestId` its `relay-applied` record carries, a ticket whose `ticket-filed` record says `draft`, `low`,
`findingRoute` `orchestrator` or `user` and `filedByJob` this job, whatever the ticket is now). V13 also runs before
every launch and resume on a ticket's branch, against the branch's commits past its target and its worktree: a hit,
or a V13 refusal after a job, opens the `branch-touches-agent-config` decision once, and no session launches or
resumes on the ticket while it is open; an answered one settles the hit until another job on the ticket ends.

### A review job

An `in-review` ticket's review job, which the policy launches for round `<n>` as its `attempt`, starts a review bar
for its round, reuses the ticket's worktree (made again from its branch when missing) and moves through the same
states as a build job, its first message the review prompt and its budget `REVIEWER_API_CALL_BUDGET`. Once verified
and gated, the runner counts the rework from the review's start to its HEAD in code lines, as `rework` does; commits
`Review round <n> of #<id>: no changes` when the reviewer committed nothing; appends `## Review <n>` from the report's
`reviewText`, claims and findings; records the review on the bar; and takes the round verdict.

| the review | what the runner does |
| --- | --- |
| claims an item `does-not-hold` | a failed pass back to a fixer: the job ends `does-not-hold`, the ticket goes `in-progress` |
| reworked over `REWORK_ROUND_THRESHOLD_LINES` (750) and the round verdict grants another round | the job ends `round-granted`; the policy launches a fresh reviewer one round on |
| reworked over the threshold and was refused another round | it passes on; the ticket shows the `rounds-not-converging` notice until it is delivered or reviewed again |
| claims an item `waiver-proposed` | the `waiver` decision opens and the job waits `awaiting-answer`, the ticket out of the merge queue and held; granting it writes `A<n>. Waived: <reason>` (the reviewer's note) in the answering hold and queues the ticket; any answer starting `refuse` is a failed pass back to a fixer |
| otherwise | the job ends `reviewed`, the ticket is marked `mergeQueued` and `merge-queued` is logged with its target; a queued ticket gets no further review |

### Under a job: the relay

A session the runner launched cannot write the data folder. With both `AGENT_PROGRESS_JOB_ID` and
`AGENT_PROGRESS_RELAY_DIRECTORY` set (named from the build's environment prefix), the read-only verbs (`help`,
`status`, `usage`, `review-stats`, `ticket show|list`, `epic show|list`, `draft show|list`) run directly. A verb of
a control command parses its arguments as usual, then, before any install-version check, writes
`<relay>/requests/<requestId>.json` atomically, `{relayFormatVersion: 1, requestId, command, bodyText?}`, the body it
read travelling beside the command. It waits for `<relay>/replies/<requestId>.json`, `RELAY_REPLY_TRIES` times
`RELAY_REPLY_INTERVAL_MILLISECONDS` apart (`src/shared/constants/RunnerLimits.ts`), and prints `done <requestId>` or
`nothing-to-do <requestId>` with the tickets it touched at exit 0, or the refusal worded as a direct run words it; with
no reply it prints `queued <requestId>` at exit 0. Every other verb is refused at exit 1. A request names no job and no
role: the runner takes both from the relay folder's job record, refuses a request carrying either
`relay-identity-mismatch`, and admits a command only as `RoleCommandPolicy` allows the job's role. `ticket add
--needs-user` exists only for a worker's relayed low finding and is refused `worker-filing-flag` anywhere else. An
admitted filing is stamped with two more frontmatter keys: `filedByJob`, the filing job's id, and on a worker's
finding `findingRoute`, `orchestrator` or `user`, which only `ticket triage` changes afterwards; any other route
makes the file malformed. Neither is in the installed reference's ticket format, nor are the relay's exit codes,
until the group's install version bump; the exit-code table below holds them then.

## Exit codes

| code | meaning | examples |
|---|---|---|
| **0** | done, or there was nothing to do | also a store write whose page could not be rebuilt (reported on standard error, with an error banner on the page when only its script failed; `render` rebuilds it), a release whose cleanup git declined, every `hook subagent-stop` run as `init` and `update` wire it (a wrong event word, an extra argument or an option is refused at exit 1), every `hook pre-tool-use` run it lets through, every `hook post-tool-use` run, and every `hook bash-domains` run, a deny answered through its JSON |
| **1** | a refusal the caller can act on | no tracker here (run `{{program}} init`), no such task or ticket, a missing `--reason`, a move the matrix refuses, a claim with no free slot, lowering a ticket that is not pending, a `network` domain that is not public, a release refused (`main-moved` among them), installed files of another install version (every command but `init`, `update`, `help`, `status` and `hook subagent-stop`, which reports it at exit 0; run `{{program}} update`), `init` or `update` over files a newer {{program}} installed or a `version.json` naming a retired agent host, `hook` given a wrong event word, an extra argument or an option, and an unknown command |
| **2** | a state the tool will not repair on its own | an unreadable or malformed progress file, an unreadable or malformed log.jsonl, a malformed ticket file a command names, a lock it could not take, a release reason `git-failed` or `tracker-failed`, `hook pre-tool-use` blocking a subagent's change to the check command (exit 2 is how Claude Code reads a block), and any error the tool did not expect |

Check the code rather than the wording.

## The Handoff and the token column

A ticket's body ends with a **Handoff** section, written by the agent that implemented the ticket as
the last thing it does, in under 15 lines, with what the ticket template
(`resources/templates/TicketBody.md`) and the installed brief's Report block list. The review pass and
whoever picks the work up next read it instead of re-deriving it from the diff.

Every row carries a token count, shown beside the bar. With the `SubagentStop` hook installed it
fills itself in: a brief names its row on a line of its own, `agent-progress row: 4` (`4, 7` for a
bundle), or its tickets or its review as `hook subagent-stop` says, and when the agent stops the hook
adds its `input` figure — every token it processed — to that row, divided over several rows floored,
the remainder to the first. An unset count plus an amount is the amount, so a row two agents worked on
carries both. A resumed agent stops again with the same agent id and a transcript that still holds its
earlier calls, so a stop whose agent id the log already records adds only what its `input` grew by
since the largest total logged for that id; a stop whose input names no agent id is added whole. The hook
reads the line only from the agent's brief, its first message. A workflow agent's first message is the harness
relaying the session user's request, beginning `[Workflow harness — user request]`; its brief is then the message
right after it, the one beginning `[Workflow harness — computed task]`, and a relay followed by anything else has no
brief at all. The orchestrator then passes no `--tokens`, which would replace the sum. Without the hook, `--tokens`
stores the harness's own `subagent_tokens`, which reports roughly the agent's end context rather than
everything it read to reach it. A row without a figure (`null`) is not a row that cost nothing; it is
a row nobody measured.

## The dashboard

`.agent-progress/progress.html` is one file with no CDN and no server, regenerated by every
mutating command and reloading itself when idle, keeping the viewer's place. Open it with `agent-progress open`.
Every render also writes `.agent-progress/progress.stamp.js` after the page, one line,
`window.apStamp = <generatedAtEpochMilliseconds>;`. The page loads it as a script every 60 s, which
works from `file://` where `fetch` does not, and reloads only once the stamp differs from its own
render; while the stamp is missing or unreadable it falls back to reloading every 5 minutes. A
missing stamp, as a render from an older CLI, a hand deletion or a failed stamp write leaves, shows
as one browser network line (`404` or `ERR_FILE_NOT_FOUND`) per page load, not a script error; no
script can suppress that line, and the next render ends it.

The tabs are **Kanban · Waves · Progress · Epics · Tickets**, in that order; the chosen one is kept in
the browser, Epics is hidden on a board without epics, and Waves on one where no ticket waits on
another.

- **Kanban tab**: one card per ticket in six lanes — To do, In progress, Review, Awaiting merge, Done
  and Abandoned — each card in the lane its state names. The open lanes run high → normal → low, then
  by id, with a divider per priority when a lane holds more than one; a card shows its priority mark,
  tokens, epic chips, waiting-on links, `held`, `no row yet` for a low ticket never started, and what it
  is waiting for (`paused since 11:45 · 1h 51m`, `no reviewer yet · 16m`, `reviewer since 13:05`). Done
  and Abandoned run newest first and show the latest 15, then 25 more at a time; Abandoned is collapsed
  until clicked. The finished-work choice decides what both closed lanes hold, and each ends with how
  many earlier cards it leaves out and a "show all". On a board with epics, the filter menu's Epic
  section narrows the board to the epics pressed, each with its roll-up; the choice is kept in the
  browser. On a board with dependencies, the menu's "Order To do" switches To do between filed and by wave: the
  lane says how many of its cards are ready and how many wait, then one group per dependency wave,
  headed with how wide the wave is (the first also with how many are ready), a one-ticket wave marked
  "one at a time", and a pending low-priority ticket, in no wave, closing the lane; the choice is kept
  in the browser. Pointing at a card draws arrows from the cards
  it waits on directly and marks them "needed first"; an open card's `↦ N` counts the tickets that
  wait on it, directly or further down the chain.
- **Progress tab**: the Gantt chart, filling the window below its head and scrolling its rows
  inside it, one row per task, newest on top, each with its number, name, ticket badge, token count,
  status pill and bar, one segment per phase it went through; and a now-marker. The log shows only in
  the detail panel, per row and ticket. A ticket's review passes are drawn as segments on its own row;
  "Review passes as rows" in the chart head's Row options menu draws each as a row of its own instead, indented
  directly above the ticket it reviews, latest round first, a bundle's review, `Review 1 #13, #5 — …`,
  once above the first ticket it names. A review whose ticket has no row on the chart — a low ticket
  not started, or one hidden as long done — is always a row of its own, drawn where its filing puts
  it. Beside it in that menu, "Wide titles" widens the name column; both are kept in the browser. On a board
  with epics the rows are grouped under a head per epic, a ticket under its primary epic only, then
  "No epic"; a head folds its rows away, and the folds are kept in the browser.
- **Tickets tab**: a table of the tickets with a count above it, searched by id, title, epic,
  branch, group and body text, narrowed by type, status and (on a board with epics) epic chips, and
  sorted by any column; on a board with epics it can be grouped by epic, a choice kept in the
  browser. A ticket's body shows only in the detail panel.
- **Epics tab**: one card per epic, open ones first, with its key, its description's first paragraph,
  a roll-up of its tickets by status, three dependency rows and the list of its tickets; the title
  opens the epic in the detail panel and a ticket opens that ticket. The rows, by primary epic: "Waits
  on", the other epics' tickets its own wait on; its tickets in the board's waves, Done first, a
  pending low-priority ticket left out; and
  "Frees", the epics waiting on it, with the tickets they wait through. The finished-work choice hides
  a finished epic, one with tickets that are all delivered or abandoned, whose span ended before its
  window; an open or empty epic always shows, its card whole. When it hides every epic, the tab says
  so in one line naming the window, such as "No epic finished in the last day."
- **Waves tab**: the open tickets' waves left to right, a Done column first holding the settled
  tickets an open one waits on, then "Now" (nothing open in front of it), "Wave 2" and on; each
  column says how many tickets in it can run side by side against the board's slots, and a one-ticket
  wave is marked "one at a time". A low-priority ticket is drawn only once it has been started: a
  pending one is left out of every wave and every count, yet a ticket waiting on it is still kept
  out of "Now", which can then stand empty. A ticket shows its state (ready, in progress, in review or held)
  and how many wait on it; an arrow runs from each ticket to the ones waiting on it, dashed from a
  settled one. Pointing at a ticket fades in its whole chain, before and after, and dims the rest;
  pointing off a ticket clears the highlight after a moment, so moving to a neighbour switches it
  without a flash. A click opens a ticket in the detail panel.
- **The header** above the tabs: a status line, `LIVE` while the page is under ten minutes old and
  `SNAPSHOT` after, with how long ago it was generated, re-checked every minute so an open page turns
  into a snapshot without a reload; the project name; the Auto · Light · Dark theme switch; and four
  figures: agents working (running rows over the concurrency limit), tickets delivered today, the
  tokens of rows that ended today or still run, and tickets waiting in the queue, with a fifth, the
  paused builds, only while there are some. Each figure but the tokens opens its Kanban lane. Below
  them, the activity banner lists every running row, longest-running first, as `BUILDING` or, for a
  row with `--review-of`, `REVIEWING`, with its ticket and a running timer; a snapshot freezes the
  timers at the moment the page was generated. The tab row holds the tabs and, at its right end, the
  filter line.
- **Embedded mode**, for a dashboard framing the page: `progress.html?embedded=dashboard` (that
  literal value only, read once at load) hides the status line, the project name, the four figures,
  the theme switch and the activity banner, whose job the Kanban's live cards take over, and puts one
  summary line above the tab row: `N building`, `N reviewing`, `N waiting in queue` and `N paused`,
  the building and reviewing dots pulsing while the page is live, then `N done today` and `N tokens
  today`. The theme switch stays in the document, undisplayed, so a framing page can still click it.
  Any other value, or none, is the normal page.
- **Click any row**, in the chart or the ticket table, or press Enter or Space on it, for the whole
  story of that task in the detail panel on the right: its facts, every phase it went through with
  how long it sat in each, the ticket with its body, and the log lines about either (a line the tool
  wrote by its task and ticket ids, a note by the numbers it names). A row filed before phases were
  recorded says so and shows what can be derived from its stamps instead. **Click a Kanban card**, or
  press Enter or Space on it, for the ticket instead: its facts, a Timeline of that ticket alone — a
  quiet Filed bar from filing to the build's start, the build's in-progress and paused segments, one
  row per review pass, the waits after the build, and a marker at now or at its delivery or
  abandonment — with the time spent in each state under it, then its description. The Filed bar is
  drawn only there, never on the Progress chart. **Click an epic** for its roll-up, description and
  tickets. Esc, ×, a link inside the panel or a second click on the open item closes it.
- **The range menu**, opened from the range button in the chart's head: the presets Fit · 1h · 4h ·
  12h · 24h · 7d, then Custom… with free-text bounds that accept `start`, `now` and `-2h` as well as
  timestamps, and a tick-step selector. Fit, the default,
  spans the rows shown from their earliest start to now with a small margin, and re-fits whenever the
  finished-work choice or the data changes; the default stored by `agent-progress range` takes its
  place when there is one. Any other choice holds until Fit is pressed again, and is kept in the
  browser. Bars outside the window are clipped and marked, never dropped.
- **The filter line** at the end of the tab row names what is hidden (`Hiding closed > 1 day`,
  `before 09-24`, `Showing all closed` when nothing is) and, on Kanban with an epic pressed, that
  epic; it opens a menu of three sections, every choice applying at once and kept in the browser.
  **Finished work** (delivered or abandoned), on every tab, is one choice shared by Kanban, Progress,
  Tickets and Epics: the last hour, day (the default), 3 days, all, or since a day; a 6 or 12 hours
  chosen before still applies. Unfinished work, awaiting merge included, always shows; the ticket
  search looks through every ticket. It says how many tickets are hidden, and epics when any are
  (`218 tickets · 1 epic hidden`), never task rows, with a "show all". **Epic** and **Order To do**
  show only on Kanban, the latter only on a board with dependencies. "Reset filters" puts all three
  back; Esc, a click outside or the line closes the menu.
- **Stamps are as short as the day allows**: one from today shows only its clock (`21:56`), one from
  another day of the year its month and day too (`09-17 23:48`), one from another year the full date;
  hover a shortened one for the full stamp.
- **A ✓ beside a delivered pill** when that task was reviewed before it was delivered; hover it for
  the review time. A delivered task without it went straight from in-review to delivered.
- **An error banner** when a command wrote the store but could not rebuild the page script.

**The pill names the state the row is actually in, and `Done` means merged.** The stored status and
the word on the pill are different vocabularies, and the same word labels the state on every tab:

| stored status | pill | what it means |
|---|---|---|
| `pending` | `To do` | filed, nobody on it |
| `in-progress` | `In progress` | an agent is working |
| `paused` | `Paused` | the work is waiting on something |
| `in-review`, no review bar of its ticket in progress | `Awaiting review` | handed in, no reviewer started yet |
| `in-review`, ticket `in-review` with a review bar in progress | `Reviewing` | a reviewer is on the ticket |
| `re-review` | `Reviewing (round 2)`, `Reviewing (round 3)`, … | a further review pass, numbered from the second |
| `reviewed` | `Awaiting merge` | the review passed, the branch is not in yet |
| `delivered` | `Done` | merged; nothing more has to happen to this row |
| `abandoned` | `Abandoned` | called off, kept for the record |

A row with nothing to merge — a review pass, a chore — still reaches `Done`, through
`agent-progress task deliver <id>`. A dispatched reviewer's bar is closed by `release`; the
orchestrator closes every row left open, and a chart whose rows stop at `Awaiting review` is a chart
nobody closed.

## Files on disk

```
.agent-progress/
  progress.json          the rows, the view, the limits
  log.jsonl              the log, one record per line
  progress.html          the generated dashboard
  progress.stamp.js      the render stamp the open dashboard polls, written after it
  agent-brief.md         the orchestrator's brief, rewritten by init and update
  builder-brief.md       the builder's brief, rewritten by init and update
  review-brief.md        the reviewer's brief, rewritten by init and update
  agent-progress-dispatch.js  the dispatcher, generated by init and update
  version.json           the install version, written last by init and update
  tickets/003-<slug>.md  one file per ticket
  epics/<key>.md         one file per epic, the folder made by the first epic add
  filing-cabinet/D1.json one file per open draft, the folder made by the first draft open
  .lock/                 the lock's generation records
  hold-journal.json      the write a lock hold committed to, present only until its files are written
```

A mutating command writes, under one lock hold, the progress file, then the tickets it changed, then
the epics it added, changed or removed, then the drafts it opened, changed or removed, then
`log.jsonl`, then the page, so a log line never describes
an unstored change. Before the first of those files it writes `hold-journal.json` with every file's new contents, and
removes the journal after the last; before the journal and before each file it checks that no newer command took its
lock over as stale, and one that was stops at exit 2 writing nothing further. Every file a reader may hold open is
written atomically: a temporary file beside the target, fsync, rename. Timestamps carry the offset of the machine that
wrote them and are displayed as written, never re-parsed into a viewer's zone.

### `.agent-progress/progress.json`

```jsonc
{
  "version": 2,                                  // guards a future migration
  "trackerId": "…",                              // namespaces the page's browser storage per tracker
  "project": "Example Agency",
  "startedAt": "2026-09-18T20:55:10+02:00",
  "view": { "kind": "auto" },                    // or kind absolute|relative with from, to and tickMinutes (a number or null)
  "nextTaskId": 18,                              // never wound back, so an id is never reused
  "concurrencyLimit": 2,                         // optional: absent reads 2, above 10 reads 10
  "dispatcherState": "running",                  // optional: running|finished|stopped, absent or finished reads stopped
  "dispatcherRunId": "wf_example-run-1",         // optional: the Workflow run to resume, only beside running
  "checkCommand": "bun run typecheck && bun test", // optional: the shell line release runs; absent refuses every release
  "installCommand": "bun install --frozen-lockfile", // optional: the line that prepares a fresh worktree before a gate
  "checksDefinitionFiles": ["package.json", ".githooks/"], // optional: the patterns V11 holds a job to; absent checks none
  "gateKeyCommand": "bun --version",             // optional: the line whose output joins a gate's cache key; absent keys none
  "gateCachePaths": ["~/.bun/install/cache"],    // optional: the folders a gate may write besides worktree and temp; absent allows none
  "nextDraftId": 3,                              // optional: the number the next draft takes, written by the first draft open, never wound back
  "nextJobId": 5,                                // optional: the number the next job takes (J5), written by the first launch, never wound back
  "jobs": [                                      // optional: the unsettled jobs in launch order, written by the first launch
    {
      "id": "J4",
      "kind": "merge",                           // build|review|merge|merge-agent|refresh|orchestrator|product-owner
      "role": null,                              // builder|reviewer|merge-fix|resolver|resolution-review|orchestrator|product-owner, or null for a merge or refresh job
      "ticketIds": ["003"],
      "parentJobId": null,                       // a merge agent's merge or refresh job, else null
      "attempt": 1,                              // from 1
      "target": "main",                          // the main line or group-<name>, or null for a session
      "state": "merging",                        // launching|preparing|running|waiting-for-answer|interrupted|awaiting-answer|verifying|gating|merging|landing|stopping
      "interruption": "reboot",                  // optional: host-lost|agent-crashed|reboot|answer-delivery|usage-limit, why it was last interrupted
      "hostInstance": 1,                         // the newest host instance spawned or to spawn, from 1
      "eventCursor": { "instance": 1, "sequence": 12 }, // the last host event applied
      "answeredRequestIds": [],                  // the question requests already answered
      "crashResumes": 0,                         // resumes after host-lost or agent-crashed only
      "slot": { "target": "main", "targetTip": "a1b2c3d", "branchTip": "b2c3d4e", "phase": "merge-in" } // optional: while it holds its target's slot; phase merge-in|resolving|reviewing-resolution|gating|fixing|landing
    }
  ],
  "nextDecisionId": 3,                           // optional: the number the next decision takes (E3), written by the first opening, never wound back
  "decisions": [                                 // optional: the open decisions for the user in opening order, written by the first opening
    {
      "id": "E2",
      "kind": "agent-question",                  // agent-question|ready-drafts|parked|waiver|landing-refused|merge-refused|checks-not-set|target-moved|branch-touches-agent-config|outage|quiet-job|leftover-worktree
      "ticketIds": ["003"],
      "jobId": "J4",                             // or null
      "askedBy": "builder",                      // a job role, runner or orchestrator
      "requestId": "toolu_example",              // the question request it was opened for, or null for one code opened
      "questions": [                             // AskUserQuestion's own shape
        { "question": "Which export format?", "header": "Format", "multiSelect": false,
          "options": [{ "label": "CSV", "description": "Comma separated" }] }
      ],
      "context": "Rewrite the importer",
      "openedAt": "2026-09-18T21:40:00+02:00"
    }
  ],
  "nextIncidentId": 2,                           // optional: the number the next incident takes (I2), written by the first opening, never wound back
  "incidents": [                                 // optional: the open incidents for the runner's orchestrator in opening order
    {
      "id": "I1",
      "kind": "setup-failed",                    // system-question|malformed-ticket|setup-failed|out-of-calls|blocked|job-lost|resume-failed|gate-cannot-run|merge-gate-failed|resolution-over-threshold|quiet-job|findings-delivered
      "ticketIds": ["003"],
      "jobId": "J4",                             // or null
      "facts": { "step": "install" },            // text the runner names; requestId when a question opened it
      "defaultMove": "worktree-repair",          // the move it takes when its delivery turn closes unhandled
      "deliveredInTurn": null,                   // or { "jobId", "chatSequence" }: the orchestrator's chat turn it went out in
      "openedAt": "2026-09-18T21:41:00+02:00"
    }
  ],
  "overseerFirstStartedAt": "2026-09-18T21:00:00+02:00", // optional: the runner's first start on this board, kept by clear
  "tasks": [
    {
      "id": 17,
      "name": "Rewrite the importer",
      "status": "in-progress",                   // pending|in-progress|paused|in-review|re-review|reviewed|delivered|abandoned
      "start": "2026-09-18T21:30:54+02:00",
      "end": null,
      "owner": "opus",
      "note": "",
      "ticket": "003",                           // or null for a free-standing row
      "tokens": 48000,                           // or null: "nobody said", which is not "it used none"
      "agent": "003",                            // optional: the ids one ticket claim started, joined; one slot
      "reviewed": "2026-09-18T22:10:00+02:00",   // optional: when the row first reached reviewed; kept through delivery
      "reviewRound": 2,                          // optional: the review pass, from the second
      "mergeQueued": true,                       // optional: once the ticket's review passed, until it lands or leaves in-review
      "history": [                               // optional: every status the row reached, oldest first,
        { "status": "pending",                   // starting with its filing; absent on a row filed
          "at": "2026-09-18T21:12:00+02:00" },   // before the field existed
        { "status": "in-progress",
          "at": "2026-09-18T21:30:54+02:00" }
      ]
    },
    {
      "id": 18,
      "name": "Review 1 #003 — Rewrite the importer",
      "status": "in-progress",
      "start": "2026-09-18T22:00:00+02:00",
      "end": null,
      "owner": "opus",
      "note": "",
      "ticket": null,
      "tokens": null,
      "reviewOf": "003",                         // optional: the ticket this row reviews
      "reviewBarRound": 1,                       // optional: which review of that ticket this bar is, from 1
      "checkCommand": "bun test"                 // optional: the stored check command when the row's ticket last moved into in-progress, or was restamped
    }
  ]
}
```

A version 2 file holding `log`, or a version other than 2, is unreadable (exit 2). A file at version 1,
written before the log moved to `log.jsonl`, is not read: its reason ends in the advice to run
`agent-progress update` with a release that still reads it, which rewrites it as version 2. Keys the tool
does not know survive a read and a write, at the top level and on a row, in the file's order, as a
ticket's unknown frontmatter lines do.

A present `concurrencyLimit` that is not a whole number of at least 1, a `dispatcherState` outside
the three, an empty or blank `dispatcherRunId`, a `checkCommand` that is not text or is blank, or a
`nextDraftId` that is not a whole number of at least 1 makes the file unreadable (exit 2), and so does a
present optional row key of the wrong shape: `reviewRound` below 2, `reviewBarRound` below 1, a row
`checkCommand` that is not text or is blank, or a
`history` that is not a list of known statuses with their stamps, or a `mergeQueued` that is not `true`. A task is
linked to at most one ticket. Task ids are never reused, not even after `task remove` or `clear`.

`jobs`, `nextJobId` and a row's `mergeQueued` are each written only once set, so a file without them stays
byte-identical; keys the tool does not know on a job, its `eventCursor` and its `slot` survive in the file's order. A
`nextJobId` below 1, or a job whose field is missing, outside its vocabulary or of the wrong shape, makes the file
unreadable (exit 2). Job ids are `J<n>`, never reused or gap-filled. A job ends only through `job-ended`, which takes it
off `jobs` in the same write; a later move of an ended job is refused `job-finished`, and a move the job's state does
not allow `job-move-illegal`. A job's state lives here and is never logged; no process identity is stored on the board.
A job's optional `stopRequest` (`stop`, `wind-down` or `fresh`) is written once User asked it, and a product-owner
job's `intake` holds `{text}`, then `proposedDraftSets` once its intake closed and `carriedAnswers` on a fresh session
that took over a replaced one.
A stored `dispatcherState` of `finished` is never rewritten and reads as `stopped`, in `dispatcher` and in
`status --json`.

`decisions`, `nextDecisionId`, `incidents` and `nextIncidentId` are likewise each written only once set; keys the tool
does not know on a decision, its questions and their options, an incident and its `deliveredInTurn` survive in the
file's order. A counter below 1, or a decision or incident whose field is missing, outside its vocabulary or of the
wrong shape, makes the file unreadable (exit 2). Decision ids are `E<n>` and incident ids `I<n>`, never reused or
gap-filled. Both lists hold only what is open: an answered or withdrawn decision, and a handled, defaulted or
escalated incident, leave in the same write and live on in the log. The first answer wins: a later one, or one to a
withdrawn decision, is refused `decision-already-answered`, an id never handed out `unknown-decision`, and an answer
that does not give one text per question `decision-answer-count`; a decision asking no question, opened or escalated,
is refused `decision-without-questions`, and one asking two questions of the same text `decision-questions-repeat`,
since its answer is kept by question text; a closed incident is refused `incident-closed`, an unknown one
`unknown-incident`. A question is keyed by its `requestId` (an incident's by its `requestId` fact) against
the open decisions and incidents and its job's `answeredRequestIds`, which an answer joins, so a replayed request opens
nothing twice.

`overseerFirstStartedAt` is written once, by the runner's first `runner-started` on the board, and never rewritten;
`clear` keeps it. Only a start on a board with neither it nor a `runner-started` log record holds every low `pending`
ticket `first-run review` under one `findings-delivered` incident, so a start after `clear` holds nothing. A value that
is not text makes the file unreadable (exit 2).

A row or history phase in a status the file format does not know, the retired `running` or
`finished` included, makes the file unreadable (exit 2) with the same advice. A row is a review bar
by its `reviewOf` alone, never by its name.

### `.agent-progress/log.jsonl`

One record per line, each a JSON object ending in a newline: `at`, `kind`, then `taskId`,
`ticketId`, `epicKey`, `draftId`, `jobId`, `decisionId` or `incidentId` where the kind names them, then `fields`.
`status` and the page word each
record as a sentence; a note's sentence is its text.

| kind | ids | fields |
|---|---|---|
| `note` | — | `text` |
| `ticket-filed` | `ticketId` | `title`; for a ticket a job filed also `status`, `priority`, `filedByJob` and `findingRoute` (when set) as filed |
| `merge-queued` | `ticketId` | `target`: a passing review queued the ticket to land there |
| `ticket-reopened`, `ticket-started`, `ticket-finished`, `ticket-approved`, `ticket-unheld`, `ticket-release-cleared` | `ticketId` | none |
| `ticket-delivered` | `ticketId` | `byHand`: `true`, only when `ticket deliver --by-hand` recorded it |
| `ticket-abandoned`, `ticket-held` | `ticketId` | `reason` |
| `ticket-retitled` | `ticketId` | `from`, `to`: titles |
| `ticket-body-changed-after-claim` | `ticketId` | none |
| `ticket-rereviewed` | `ticketId` | `round`, from 2 |
| `ticket-priority-changed` | `ticketId` | `from`, `to`: priorities |
| `ticket-size-changed` | `ticketId` | `from`, `to`: sizes, `from` absent when the ticket had none |
| `ticket-agents-changed` | `ticketId` | `from`, `to`: each `{ model, effort }` |
| `ticket-dependencies-set` | `ticketId` | `dependsOn`: ticket ids |
| `ticket-introduced-by-set` | `ticketId` | `introducedBy`: the cause's ticket id, absent when it was cleared |
| `ticket-epics-set` | `ticketId` | `epics`: epic keys |
| `ticket-release-marked` | `ticketId` | `group` |
| `ticket-check-command-restamped` | `ticketId` | `command` (the line stamped on its row, or `null`), logged per ticket by `checks --restamp` |
| `epic-added`, `epic-edited` | `epicKey` | `title` |
| `epic-removed` | `epicKey` | none |
| `review-bar-started`, `review-bar-closed` | `taskId`, `ticketId` | `name` |
| `review-recorded` | `taskId`, `ticketId` | `round` (the bar's, from 1), `verdict`, `reviewStartCommit`, `fixReworkedCodeLines`, `rebaseReworkedCodeLines`, `totalReworkedCodeLines`, `builderChangedFiles`, `builderInsertions`, `builderDeletions`, `claims` and `findings` as `review record`'s findings file holds them, logged by `review record` |
| `chart-range-set` | — | `view`, shaped as `progress.json`'s |
| `concurrency-limit-set` | — | `limit` |
| `check-command-set` | — | `command` (the shell line, or `null` when cleared) |
| `install-command-set` | — | `command` (the install line) |
| `checks-definition-files-set` | — | `patterns` (the stored patterns, empty when cleared) |
| `gate-key-command-set` | — | `command` (the key command, or `null` when cleared) |
| `gate-cache-paths-set` | — | `paths` (the stored cache paths, empty when cleared) |
| `gate-ran` | — | `tree` (the gated tree's object id), `outcome` (`passed`, `failed`, `cannot-run`), `cached` (true for a cache hit, which ran nothing) |
| `dispatcher-set` | — | `state`, `runId` (a run id or `null`) |
| `tracker-cleared` | — | none |
| `agent-stopped` | — | below |
| `runner-started` | — | `codeVersion`, `installVersion` |
| `runner-stopped` | — | `reason`: `stopped` or `handed-over` |
| `runner-handover-failed` | — | `successorCodeVersion`, `step`, `error` |
| `job-launched` | `jobId` | `kind`, `role` (or `null`), `ticketIds`, `attempt`, `target` and `parentJobId` (each or `null`) |
| `job-interrupted` | `jobId` | `cause`, `hostInstance`: the instance that was lost |
| `job-resumed` | `jobId` | `hostInstance`: the instance spawned, `cause`: the interruption it resumes from |
| `usage-limit-hit` | `jobId` | `window` (as the vendor names it, such as `five_hour`), `resetsAt` (ISO): the vendor refused the job's requests, and nothing launches or resumes before `resetsAt` |
| `job-ended` | `jobId` | `outcome`, `cause` and `commit` each only when named, `deniedPermissions` |
| `job-stop-requested` | `jobId` | `mode`: `stop`, `wind-down` or `fresh`, User's `job stop`, `job wind-down` or `job fresh` |
| `job-messaged` | `jobId` | `text`: a chat turn the runner writes to the session in log order |
| `merge-started` | `jobId` | `target`, `targetTip`, `branchTip`, `predictedConflictFiles` (empty for a clean prediction): the merge job claimed the target's slot |
| `merge-landed` | `jobId` | `target`, `commit`, `kind` (`landed` on the main line, `integrated` on a group branch): the runner's list of tips it landed |
| `ticket-triaged` | `ticketId` | none: a finding put to the user's low-priority triage |
| `decision-opened` | `decisionId` | `kind`, `ticketIds` |
| `decision-answered` | `decisionId` | `answer`: one answer per question, keyed by the question's text |
| `decision-withdrawn` | `decisionId` | `reason` |
| `incident-opened` | `incidentId` | `kind`, `ticketIds` |
| `incident-handled` | `incidentId` | `move`: the move that closed it |
| `incident-defaulted` | `incidentId` | `move`: its default move, `cause`: `turn-closed`, `turn-budget` or `no-orchestrator` |
| `incident-escalated` | `incidentId` | `decisionId`: the `agent-question` decision it became |
| `relay-applied` | `jobId` | `requestId`, `commandKind`, `outcome` (`done`, `nothing-to-do` or `refused`): a relayed request the runner answered, never applied again |

```
{"at":"2026-09-18T21:30:54+02:00","kind":"ticket-started","ticketId":"003","fields":{}}
{"at":"2026-09-18T22:00:00+02:00","kind":"review-bar-started","taskId":18,"ticketId":"003","fields":{"name":"Review 1 #003 — Rewrite the importer"}}
{"at":"2026-09-18T22:05:00+02:00","kind":"note","fields":{"text":"Wave 1 landed."}}
```

The file is always written whole, atomically; an absent file is an empty log, and a blank line is
skipped. A line that is not a well-formed record of a known kind makes the log unreadable (exit 2),
naming the line and the field. A record
is kept with only the keys its kind names, so a key added by hand is dropped the next time the file is
written.

An `agent-stopped` record's `fields` are `agentId`, `agentType`, `apiCallCount`, `endContextTokens`,
`totalInputTokens` (fresh input plus both cache figures), `cacheReadInputTokens` and `outputTokens`. An agent a
workflow run spawned, whose transcript sits at `…/subagents/workflows/<runId>/agent-<id>.jsonl`, also carries
`workflowRunId`, that `<runId>`, and `agentLabel`, the `description` of the `agent-<id>.meta.json` beside the
transcript when it has one; each is written only when known, so a plain subagent's record holds neither.

```
{"at":"2026-09-18T22:10:00+02:00","kind":"agent-stopped","fields":{"agentId":"a1","agentType":"workflow-subagent","apiCallCount":2,"endContextTokens":140020,"totalInputTokens":230030,"cacheReadInputTokens":230000,"outputTokens":2000,"workflowRunId":"wf_example","agentLabel":"build #7"}}
```

### `.agent-progress/hold-journal.json`

```
{
  "version": 1,
  "files": [
    {
      "path": "progress.json",
      "contents": "{\n  \"version\": 1,\n  …\n}\n"
    },
    {
      "path": "epics/checkout-redesign.md",
      "removed": true
    },
    {
      "path": "log.jsonl",
      "contents": "{\"at\":\"2026-09-18T20:05:00+02:00\",\"kind\":\"note\",\"fields\":{\"text\":\"Example\"}}\n"
    }
  ]
}
```

The write one lock hold committed to, in the order it writes the files, indented two spaces and ending in a newline,
written atomically. Each entry's `path` is relative to the data folder and never leaves it; it carries either the
file's whole new `contents`, `log.jsonl` included, or `"removed": true`. Every command that takes the lock first
finishes a journal it finds, rewriting or removing each file verbatim, then removes it. A journal that cannot be read,
another `version`, or an entry breaking these rules stops every write at exit 2 until it is repaired or removed;
`status`, which takes no lock, reports it on standard error and replays nothing.

### `.agent-progress/version.json`

```
{
  "installVersion": 1
}
```

The install version of the files `init` and `update` installed, indented two spaces and ending in a
newline, written atomically by both after every other file they write. It is read as a JSON object
whose `installVersion` is a whole number of at least 1. An `agentHost` naming the retired host an
install before version 11 recorded makes `init` and `update` refuse ([Adopting a
repository](#adopting-a-repository)); any other key is ignored and not written back.
A file recording another version, holding anything else or unreadable is a mismatch, and so is an
absent file while `agent-brief.md` is installed; an absent file with no brief is none.
[Install version](#install-version) says what a mismatch does.

### `~/.agent-progress-monitor/projects.json`

```
{
  "version": 1,
  "projects": {
    "5f0c2a9e-7b1d-4c3e-9a8f-2d6b4e1c0a37": {
      "project": "Example Agency",
      "root": "/Users/alex.example/development/example-agency",
      "progressHtml": "/Users/alex.example/development/example-agency/.agent-progress/progress.html",
      "progressJson": "/Users/alex.example/development/example-agency/.agent-progress/progress.json",
      "gitOrigin": "git@example.invalid:example/example-agency.git",
      "registeredAt": "2026-10-21T10:00:00+02:00",
      "lastChangedAt": "2026-10-21T11:30:00+02:00",
      "lastCommand": "ticket finish"
    }
  }
}
```

The machine-wide registry of every project whose dashboard this machine's agent-progress wrote, in the home folder,
for a monitor to find each project's page and data; a folder, so the monitor can keep its own files beside it. A
project registers, its entry added or updated, exactly when the call wrote its `progress.html`: a mutating command
whose render succeeded, `render`, `open` when it renders a missing page, and `init`. `update` never renders the page,
so it never registers; neither does a read-only call or a store write
whose render failed. A tracker whose root lies under a temp folder is never registered: the system temp folder
(`os.tmpdir()`, on macOS `$TMPDIR` under `/var/folders`), `/tmp` and `/var/tmp`, each compared after resolving
symlinks (`/tmp` to `/private/tmp` on macOS). An entry already in the registry stays.

An entry is keyed by the tracker's `trackerId`, so a moved or renamed folder updates its one entry. It holds the
page's `project` name, the `root` folder, the absolute paths of `progressHtml` and `progressJson`, `gitOrigin` (the
`origin` remote's URL, or `null`), `registeredAt` (the first registration, kept), `lastChangedAt` (this write) and
`lastCommand` (the verb that wrote, the command word and its subcommand). No board summary is copied: the monitor
reads each project's own files. The CLI never removes an entry and has no command for the registry.

The read-modify-write holds the registry's own lock, `.agent-progress-monitor/.lock/`, and writes the file
atomically, indented two spaces and ending in a newline. Unknown keys, at the top level and on an entry, are kept in
order. A file whose `version` is newer than 1 is left untouched and a warning is printed. A malformed file is reported
and rewritten with every entry that is still an object, plus this one. A registry that cannot be read or written, its
lock included, is a warning on standard error: the command keeps its exit code, 0 when it succeeded.

### `{{dataFolder}}/tickets/003-double-click-a-role-to-edit-it.md`

The file name is the padded id and a slug of the title; the ticket is known by its frontmatter `id`.
The CLI writes its keys in this order, omitting an optional key it does not have:

```
---
id: "003"
title: "Double-click a role to edit it"
type: "ticket"
priority: "high"
model: "sonnet"
effort: "high"
hold: "waiting for the design review"
status: "in-progress"
filed: "2026-09-18T20:11:03+02:00"
updated: "2026-09-18T20:40:00+02:00"
started: "2026-09-18T20:40:00+02:00"
finished: null
delivered: null
abandonedAt: null
group: "role-editor"
branch: "ticket/role-editor"
commit: "0a1b2c3"
reason: "…"
releasesGroup: true
dependsOn: "001, 002"
epics: "loyalty-programme, checkout-redesign"
network: "api.example.com, cdn.example.com"
claimedBodyHash: "5f1d3c9a0b7e2468"
task: 17
owner: Alex Example
---
# 003 — Double-click a role to edit it

## Report
…
```

| key | written | value |
|---|---|---|
| `id`, `title`, `type`, `status`, `filed`, `updated` | always; required | `type`: ticket, bug, research; a stored change or feature reads as ticket and is written back as stored. `status`: draft, pending, in-progress, in-review, reviewed, delivered, abandoned. `updated` is stamped on every move. |
| `priority`, `size`, `model`, `effort` | only once named | `priority`: low, normal, high. `size`: XS, S, M, L, XL, XXL, in capitals. `model`: haiku, sonnet, opus, fable. `effort`: low, medium, high, xhigh, max. Absent reads as normal, as no size, and as opus and medium, so an older ticket is never rewritten to gain them. |
| `hold` | only while held | the hold's reason, empty without one; any value but `null`, a bare `hold:` included, is held. Set and remove it with `ticket hold` and `unhold`. |
| `started`, `finished`, `delivered`, `abandonedAt` | always | a timestamp or `null`; an absent one reads as `null` |
| `group`, `branch`, `commit`, `reason` | when given | text; `reason` is dropped by `reopen` |
| `releasesGroup` | only on a group's release ticket | `true`; absent or `null` is not the release ticket, any other value makes the file malformed. Set and remove it with `ticket release-of`. |
| `dependsOn` | when non-empty | ticket ids, written `"001, 002"`, read from any mix of commas and spaces with or without `#` or padding. Set it with `ticket depends`, which refuses a missing id or a circle; bare ids replace the list, `--add` and `--remove` change it. |
| `epics` | when non-empty | epic keys, written `"loyalty-programme, checkout-redesign"` and read like `dependsOn`, in order: the first is the primary epic. A part that is not an epic key makes the file malformed; a key whose epic is gone is kept. Set it with `ticket epic`, which refuses an epic that does not exist. |
| `network` | only once set | the public domains the ticket's agents may reach, written `"api.example.com, cdn.example.com"` and read like `epics`, lower case, in order. A domain that is not public makes the file malformed. Set it with `ticket add --network` or `ticket network`, only while the ticket is a draft or pending; `--clear` removes it. |
| `introducedBy` | only once named, on a bug | one ticket id, written `"005"`, read like a `dependsOn` entry: the delivered ticket whose change introduced the bug. Set it with `ticket add --introduced-by` or `ticket introduced-by`, which refuse a ticket that is not a bug and a cause that is missing, the ticket itself or not delivered; an empty cause removes it. |
| `foundInReview` | only once named | one ticket id, written and read like `introducedBy`: the ticket whose review found this one. Set only at filing, with `ticket add --found-in-review`, which refuses a ticket that does not exist. |
| `claimedBodyHash` | once the ticket was claimed or started | the content hash (64-bit FNV-1a, 16 hex digits) of the body as it read at the last `ticket claim` or `ticket start`; absent on a ticket never claimed. `ticket show` compares it with a hash of the body now to say whether the body changed since the claim. |
| `task` | always | the row's id as an unquoted integer, or `null` for a low ticket never started; a quoted `task` makes the file malformed |

**The frontmatter is a deliberately small YAML subset.** One `key: value` per line, split at the
first `': '`, so `title: Fix: the thing` keeps its second colon; `key:` alone is an empty value.
A value is `null`, a double-quoted JSON string, or an unquoted scalar kept as text; only `task` reads
an unquoted integer as a number, so any other value keeps its leading zeros. A `#` comment starts in
column 0 with one hash; a line opening on two to six `#` followed by whitespace or nothing, indented
or not, is a markdown heading and makes the file malformed, as does any other indented line, a list
item or a bare word. There are no nested maps, lists or block scalars. The closing fence is the
*first later* line equal to `---`, so a body may contain horizontal rules. A leading byte order mark
is dropped and CRLF is kept.

A ticket stored with a status that is not a ticket status, the retired `open` or `done` included, is
malformed at its status line, the reason ending in the advice to run `{{program}} update` with a
release that still reads it.

**Unknown keys, comments and blank lines are kept and written back**, so a field you add by hand —
`owner: Alex Example` above — survives every transition. The CLI's own keys are rewritten at the top
in the order above and everything else follows, keeping its order among itself, so a hand-written
line moves below the CLI's block once and never again.

The body is preserved byte for byte from the ticket template (Report, Wanted, Acceptance, Handoff),
`--body` or `--body-file`; an empty body falls back to the template. `ticket edit` replaces the body or
appends to it and leaves the frontmatter's bytes as they are, a hand-written layout included; `ticket edit --title`
rewrites only the `title` line, and a first body line still reading `# <id> — <old title>`, never the file name; on a
claimed ticket whose body is unchanged since the claim it moves `claimedBodyHash` along. Past `pending`, `ticket edit`
needs `--force`. A malformed ticket file is listed as ignored rather than failing `status` or `render`. A new ticket
id is one past the highest of every file name, every parsed id and every ticket a row names;
gaps are tolerated, never filled.

**The Acceptance is numbered.** Each item of `## Acceptance` starts a line with `A1.`, `A2.`, …, its
continuation lines beneath it up to a blank line or the next item; an item is never renumbered and its
number never reused. `A3. Waived: <reason>` marks an item the user waived. A review's `## Review` holds
one line per item, bulleted or not: `A2 holds — <evidence>`, `A2 does not hold — <gap>` or
`A3 waived — <reason>`. `release` reads only the latest `## Review`, a heading inside a code fence not
counting as one: an item is accounted for when the Acceptance marks it waived, or when that Review has a
`holds` or `waived` line for it and no `does not hold` one.

### `.agent-progress/epics/checkout-redesign.md`

The file name is the key, and an epic is known by it: a file whose `key` says otherwise is listed as
ignored. The CLI writes, unknown lines after its three:

```
---
key: "checkout-redesign"
title: "Checkout redesign"
slot: 2
---
The description, kept byte for byte.
```

| key | written | value |
|---|---|---|
| `key` | always; required | lower-case letters and digits in words joined by single hyphens, the file name without `.md` |
| `title` | always; required | text |
| `slot` | always; required | the colour, a whole number from 1 to 6 written without quotes, assigned once by `epic add` |

The frontmatter follows the ticket file's subset: a quoted value is a JSON string, an unquoted one is
kept as text, and unknown keys, comments and blank lines are kept and written back after the CLI's
three. Unlike a ticket's, every line starting with `#` is a comment, two or more hashes included. The
closing fence is the first later `---` line, and a description edit leaves the frontmatter's bytes as
they are. A malformed epic file is listed as ignored on
standard error rather than failing `status` or `render`, and `epic add` refuses to overwrite it. A
tracker that never added an epic has no `epics/` folder.

### `.agent-progress/filing-cabinet/D1.json`

The file name is the draft id, and a draft is known by it: a file whose `id` says otherwise is listed
as ignored. Only the `draft` commands write it, through the lock, atomically:

```jsonc
{
  "version": 1,                                  // only this version is read
  "id": "D1",
  "title": "Example feature",
  "request": "The user's request, kept byte for byte.",
  "openedAt": "2026-10-24T22:01:45+02:00",
  "claim": { "owner": "opus", "claimedAt": "2026-10-24T22:01:45+02:00" }, // or null while unclaimed
  "notes": [
    { "id": "N1", "kind": "fact", "text": "The export lives in src/export/" } // kind: fact | assumption
  ],
  "questions": [                                 // the top-level questions, each holding its follow-ups
    {
      "id": "Q1",
      "question": "Which format?",
      "context": "What the user needs to answer it",
      "options": [{ "letter": "a", "text": "CSV" }, { "letter": "b", "text": "JSON" }],
      "multiple": false,                         // true for a multi-select question
      "recommended": ["a"],                      // one letter, or several on a multi-select question
      "answer": { "letters": ["a"], "answeredAt": "2026-10-24T22:05:00+02:00" }, // or { "text", "answeredAt" }, or null while open
      "followUps": []                            // questions of the same shape, asked --under Q1
    }
  ],
  "nextNoteNumber": 2,                           // the number the next note and question take, never wound back
  "nextQuestionNumber": 2
}
```

Keys the CLI does not know are kept, in their stored order, after its own. A draft file that is not
JSON, lacks a field, holds one of the wrong shape, or has another `version` (older or newer, refused
with the advice to run `agent-progress update` with a release that still reads it) is listed as ignored
on standard error by `status` and `draft list`, rather than failing them or `render`, and `draft open`
refuses to overwrite it. A closed or abandoned draft's file is removed; the log keeps what it became. A
tracker that never opened a draft has no `filing-cabinet/` folder and no `nextDraftId`.

## Ticket moves and their rows

The **from** column is the matrix the named verbs enforce; `ticket status <id> <status>` skips it.
**its row** is the status stored; **pill** is what that row then reads on the chart.

| command | from | ticket status | its row | pill | stamps written | log line |
|---|---|---|---|---|---|---|
| `ticket add` | — | draft | none, at any priority | `Draft` | `filed` | `Ticket #003 filed: <title>` |
| `ticket ready` | draft, for every id named, each with a numbered `## Acceptance` and a `## Brief` holding a non-blank line | pending | created `pending`, at any priority | `To do` | — | `Ticket #003 ready to build`, one per ticket |
| `ticket start` | pending, in-review | in-progress | `in-progress`, its claim's `agent` key dropped; created for a low ticket | `In progress` | `started` if null; the row's end cleared | `Ticket #003 started` |
| `ticket claim` | pending, in-review, and for every id named: not held, no review bar in progress, dependencies settled (one on a ticket in the same claim is, and with `--after` the in-review predecessor of its release bundle), and a free slot | in-progress | `in-progress`, created for a low ticket; with `--owner`, `--note` and the claim's `agent` key | `In progress` | as `start` | `Ticket #003 started`, one per ticket |
| `ticket finish` | in-progress | in-review | `in-review` | `Awaiting review`; `Reviewing` while a review bar of the ticket is in progress | `finished` if null | `Ticket #003 in review` |
| `ticket finish --start-review` | in-progress | in-review | `in-review`, plus an in-progress review row | `Reviewing` | as `finish` | as `finish`, and `Review row #18 started: <name>` |
| `ticket rereview` | in-review | in-review, unchanged | `re-review`, one round up from 2 | `Reviewing (round 2)` | `updated` only | `Ticket #003 in review, round 2` |
| `ticket rereview --start-review` | in-review | in-review, unchanged | as `rereview`, plus an in-progress review row; the round before's row delivered | `Reviewing (round 2)` | as `rereview` | as `rereview`, then `Closed the review row #18, delivered: <name>` and `Review row #19 started: <name>` |
| `ticket approve` | in-progress, in-review | reviewed | `reviewed`, its `reviewed` stamp set if unset | `Awaiting merge` | `finished` if null | `Ticket #003 reviewed` |
| `ticket deliver` | reviewed | delivered | `delivered` | `Done` | `delivered` if null | `Ticket #003 delivered` |
| `release` | in-progress, in-review; reviewed for a release bundle's ticket released with its group's release ticket | reviewed (unless already), then delivered | `delivered`; in-progress review rows delivered | `Done` | `finished` and `delivered` if null; `branch`, `commit` | the reviewed and delivered lines, and one per review row closed |
| `ticket abandon` | anything but delivered, abandoned | abandoned | `abandoned`; none created for a low ticket without one | `Abandoned` | `abandonedAt`, always; the row's end if it had started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | anything but draft and pending; a group's release ticket only while no other release ticket of its group is open | pending | `pending`, its start, end, `reviewed` and `reviewRound` cleared | `To do` | all four cleared; `reason` dropped | `Ticket #003 reopened` |
| `ticket priority … low` | draft, pending | unchanged | kept | — | — | `Ticket #003 priority normal → low` |
| `ticket priority` from low | any | unchanged | created when it has none: `pending` while the ticket is pending, else seeded from its stamps | per status | — | `Ticket #003 priority low → normal` |

A closing stamp is written only while it is still null, while `abandonedAt` is written every time:
re-entering a status is a correction, abandoning twice is deciding twice. Every move to a status other
than in-review — `start`, `approve`, `deliver`, `abandon`, `reopen`, `status` — finishes and delivers the
ticket's in-progress review bar, with one log line each; a plain `ticket rereview` leaves it in progress.

Filing the row is the first entry in its `history`, and each move appends another, so the detail
panel can say when the row reached each state and how long it sat there — the wait
between `To do` and `In progress` being the queue time. `task update --status` is not appended: it
corrects a row rather than moving it.

Moving a ticket to the status it already has is refused and logs nothing; `ticket rereview` is the one
exception, since every review pass is still review and the round is counted on the row. A ticket
taken straight to in-review, reviewed or delivered with `ticket status`, having never started, gets a row
whose start is stamped along with its end — an end without a start would draw from the origin of the chart. There
is no `paused` ticket status: `task pause <id>` records a waiting row and the ticket stays where it
was.

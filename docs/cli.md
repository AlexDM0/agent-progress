# agent-progress — command and file-format reference

The complete reference for someone using the tool: what `init` and `update` write into a repository,
every command and flag, the exit codes, what the dashboard shows, the files on disk and what each
ticket move does to its Gantt row. The code wins every disagreement: `agent-progress help` prints the
command reference from `cli/HelpText.ts` and is never out of step with the tool. `skill/Reference.md`
carries a word-for-word copy of three sections of this file, the ticket file format, the ticket moves
and the exit codes, and follows it everywhere else. The overview is in the [README](../README.md); working on this repository yourself
is in [development.md](development.md).

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
| `--json` | Accepted by every command but `init`, `update`, `render`, `open`, `hook` and `help`, and prints one JSON document on standard output in place of the human output. A reading command prints the document its row describes. A command that writes prints what it wrote: the row for a `task` verb, the ticket for a `ticket` verb or setting (a list for a claim of several), the epic for `epic add` and `epic edit` (`{ key, removed: true, filePath }` for `epic remove`), the log entry for `log`, the stored axis for `range`, the new state for `concurrency <n>` and `dispatcher <state>`, and the counts for `clear`; `release` prints its own document. Nothing follows the document on standard output — no Next line, running-dispatcher notice or resume line — while a warning still goes to standard error. |
| `AGENT_PROGRESS_ROOT` | Names the repository to use instead of walking up from the current directory, for a command run from somewhere else entirely. It does not create a tracker: a value naming a directory that has none is refused with a message saying the variable is set. `init` does not choose its directory by it, and refuses at exit 1 when it names a directory other than the one `init` targets. |

**One tracker per repository.** The tracker lives in `.agent-progress/` at the repository root, found
with `git rev-parse --git-common-dir`, so every worktree of a repository shares one tracker and one
chart.

**Locking.** Every mutating command (`init`, `task`, `ticket`, `epic`, `log`, `concurrency`, `dispatcher`,
`range`, `release`, `clear`, `hook subagent-stop`) takes the tracker's lock, reads, changes, writes
`progress.json` atomically, writes any ticket file after it, then `log.jsonl` when it logged something,
and regenerates `progress.html` from disk, then its `progress.stamp.js` — all before releasing the lock, so the page never describes
a state the store did not hold, a ticket file is never ahead of the progress file, and a log line never
describes a change that was not stored.
`render` and `open` take the lock only to render. `status`, `ticket list`, `ticket show`, `epic list`, `epic show`,
`concurrency` and `dispatcher` without an argument, `usage` and `rework` take none: every file they
read is written atomically. `update`, and `init` on an existing tracker, never touch the tracker's
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
(`; held: #002`). The dispatcher's advice follows where it has any: `; launch the dispatcher` when it
is `finished` and a normal or high ticket is ready, `; only low priority ready: triage, then launch`
when it is `finished` and only low tickets are ready, `; dispatcher stopped: wait for the user's go`
when it is `stopped`. While the dispatcher is `running`, `ticket add`, `priority`, `agent`,
`depends`, `hold`, `unhold`, `reopen` and `status <id> pending` add one more line: the run picks the
change up at its next agent's return and is never stopped or relaunched for it. `--json` output
carries neither line.

## Adopting a repository

```sh
cd <the repository to track>
agent-progress init
```

`init` creates the tracker and installs everything a session needs to use it. Of the eight things
below, the first four are the tracker itself and the instructions pointing at it; the next three are
what Claude Code runs — the hook and the agent definition under `.claude/`, the dispatcher in the
tracker — each written by default and each with its own opt-out; the last records which install
version all of them are.

| # | what | path | written by | opt-out |
|---|---|---|---|---|
| 1 | The tracker: `progress.json`, `log.jsonl`, a `tickets/` folder, the generated `progress.html` and its `progress.stamp.js`, and the `.lock` directory | `.agent-progress/` | `init` only | — |
| 2 | The briefs, generated from `resources/templates/AgentBrief.md` (the orchestrator's), `BuilderBrief.md` and `ReviewBrief.md` | `.agent-progress/agent-brief.md`, `builder-brief.md`, `review-brief.md` | `init`, `update` | — |
| 3 | A `.gitignore` entry for the tracker | `.gitignore` | `init` only | — |
| 4 | The managed block, from `resources/templates/ClaudeInstructionsBlock.md` | `CLAUDE.md` | `init`, `update` | `--no-claude-md` |
| 5 | The `SubagentStop` hook running `agent-progress hook subagent-stop` | `.claude/settings.local.json` | `init`, `update` | `--no-hooks` |
| 6 | The dispatcher workflow, generated from `dispatcher/DispatchFromWorkflowGlobals.ts` | `.agent-progress/agent-progress-dispatch.js` | `init`, `update` | `--no-workflow` |
| 7 | The worker agent definition, from `resources/templates/AgentProgressWorker.md` | `.claude/agents/agent-progress-worker.md` | `init`, `update` | `--no-agent-definition` |
| 8 | The install version | `.agent-progress/version.json` | `init`, `update` | — |

1. **The tracker.** Its root is the main checkout, found from any worktree.
2. **The briefs.** The orchestrator's, `agent-brief.md`, is what it fills in before it spawns an
   implementing agent: the scope, the facts it needs instead of a reading list, and the ticket's
   `## Brief` block. Each agent reads only its own: a builder `builder-brief.md` (call discipline, the
   call budget, when to stop, how to close and what to report), a reviewer `review-brief.md` (the review
   procedure, its budget and the rework threshold). They are guidance shipped with the tool rather than
   files a project edits, so every `init` and every `update` rewrites all three, generated with the
   call budgets and the rework threshold the dispatcher's prompts state, from the same constant. The
   managed block states that threshold the same way. The line reports the orchestrator's brief, and
   `updated` when any of the three changed.
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
   — since it is not under `.claude/workflows/` and has no name to launch it by. It is the tool's
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
   tools on every call; `skills: agent-progress` preloads the tracker skill instead. A hand edit is
   undone. Since the dispatcher cannot start a worker without it, `--no-agent-definition` is refused
   at exit 1, writing nothing, unless `--no-workflow` is given too. `--no-workflow` leaves an installed
   dispatcher in place, so the two together are refused the same way while
   `.agent-progress/agent-progress-dispatch.js` exists and this definition does not.
8. **The install version** ([its file](#agent-progressversionjson)): the one version of everything
   above that the tool installs, which changes only when what the CLI and those files expect of each other changes.
   `init` and `update` compute every installed file first and write this one last, after every other
   write, so a run that fails part way leaves the version it found and a second run completes it. A
   refused `CLAUDE.md` block or settings file is reported and does not hold it back.

`update`, and `init` at a root that already has a tracker, report items 2 and 4–7 on a line each:
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

`.agent-progress/version.json` records which install version the installed files are (item 8 above),
written last by `init` and `update`. Every command except `init`, `update`, `help` and `status` checks
it against the running agent-progress before it does anything:

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
- `update`, and `init` on an existing tracker, are what lift the refusal. They refuse, at exit 1 with
  the same paragraph and writing nothing, only files a newer agent-progress installed, so an older
  agent-progress never writes its files over a newer one's, and a directory at the file's path, which
  they could not replace.
- `status` never refuses and says nothing about a mismatch, because its output is what scripts read.
  This is a known gap: the refusal first shows at the next command.

## The two skills

`setup.sh` links two Claude Code skills into `~/.claude/skills/`, split by audience because the
first one's trigger fires in every session in a tracked repository, every implementing subagent
included.

| skill | folder | for | holds |
|---|---|---|---|
| `agent-progress` | `skill/` | any session in a tracked repository | the model, how to file and move a ticket, what an implementing agent owes its `## Handoff`, the rules. No command list: `agent-progress help` is the reference, and `skill/Reference.md` holds what the help does not print. |
| `agent-progress-orchestrate` | `skill-orchestrate/` | the one session running the board, started with `/agent-progress-orchestrate` | intake (grilling each request until its acceptance is unambiguous, filing it with a `## Brief`), launching, relaunching and resuming the dispatcher, triaging low-priority tickets. |

## Commands

Options in `[brackets]` are optional; `a|b` is a choice of one.

### Setup

| command | what it does |
|---|---|
| `init [--project <name>] [--root <path>] [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]` | Create the tracker here and write the eight items in [Adopting a repository](#adopting-a-repository). `--project` names the project shown on the page (default: the root directory's name); `--root` tracks that directory instead of the discovered repository root. Refused when an ancestor already holds a tracker, when `--root` is not an existing directory, inside a bare repository, for `--no-agent-definition` without `--no-workflow` (the dispatcher starts every worker as that agent), for the two together while a dispatcher is installed without its definition, and when `AGENT_PROGRESS_ROOT` is set to a directory other than the one it would create the tracker in (the message names both, and nothing is written). A re-run refreshes only what `update` refreshes and leaves the tracker's own files alone; like `update`, it is refused at exit 1, writing nothing, over files a newer agent-progress installed ([Install version](#install-version)). |
| `update [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]` | Refresh what the tool wrote into a repository it already tracks: the managed block, `agent-brief.md`, the hook, the workflow — generated anew into `.agent-progress/` — and the agent definition, undoing a hand edit to either of the last two; then, last, `version.json`. The tracker's own files are left alone, and the first line says so. A tracker an earlier agent-progress wrote in a format this one no longer reads — a version 1 `progress.json` holding its own log, or a status word the rename retired — is refused at exit 2 by every command that reads it, the reason ending in the advice to run `agent-progress update` with a release that still reads it, which rewrites it in the current format. It creates no tracker, so it takes no `--project` and no `--root`. With no tracker it is refused at exit 1, naming `agent-progress init`; so is `--no-agent-definition` without `--no-workflow`, or with it while a dispatcher is installed without its definition, writing nothing, as for `init`; and over files a newer agent-progress installed at exit 1, writing nothing ([Install version](#install-version)). Every command but `init`, `update`, `help` and `status` is refused until it has run over files of an older install version, and `hook subagent-stop` reports it at exit 0 ([Install version](#install-version)). |
| `help` | The command reference. |

### Reading the board

| command | what it does |
|---|---|
| `status [--json] [--full] [--tickets-only]` | The project, the counts, the rows that are not delivered or abandoned, and the last five log entries newest first, then the Next line. `--json` prints the same working view for an agent — the unsettled rows and tickets, the last 10 log entries, and an `omitted` object counting what was left out. `--full` lists everything; with `--json` it prints the whole progress file plus every ticket's frontmatter. The `version` both `--json` documents carry is the document's own shape version, `1`, with the worded log directly after `tasks`, whatever version the stored file is at. Both `--json` documents carry `concurrency` — `limit`, `agentsInFlight`, `freeSlots`, `readyTicketIds`, `dispatcherState`, `heldTicketIds`, while one is stored `dispatcherRunId`, then `inProgressTicketIds` and `inProgressReviewOfIds` — and beside it `readyTickets`, then `reviewWaitingTickets`, `pausedBuilds` and `ticketRows`, and end with `tokensByOwner`. Both carry `epics` after `tickets`, every epic with its roll-up (see Epics), and each ticket carries `epics`, its list in order, empty when it has none. `--tickets-only`, with or without `--json` and `--full`, leaves out the free-standing task rows — every row that is no ticket's own row (`ticket` null) and no review bar (no `reviewOf`) — while the tickets, the log and the counts stay; the working view's `omitted` then adds `freeStandingTasks`. The human output breaks the token total down per owner: owners are grouped case-insensitively on the trimmed text and shown under the group's most common spelling (the first met on a tie), most tokens first, with the reported rows that carry no owner on a `no owner` line of their own. `tokensByOwner` carries the same over every row, whatever the flags: `{ owners: [{ owner, tokens, rows }], withoutOwner: { tokens, rows }, withoutTokens: { rows } }`, whose owner and `withoutOwner` tokens add up to the reported total. |
| `ticket list [--status <s>] [--priority <p>] [--json]` | The tickets with their status, priority, type and row id, the model and effort after the title where the ticket names them, and "waiting on #003" where a dependency is unsettled. `--status` and `--priority` narrow the listing. `--json` carries no bodies. |
| `ticket show <id> [--json]` | One ticket: its frontmatter, its priority, its model and effort where it names them, its body, and always its file path — which is what an agent needs in order to edit that body. |

**Ready tickets.** A ticket is ready when it is pending and every ticket it depends on is reviewed or
delivered. `readyTicketIds` orders them high priority first, then normal, each lowest id first. A low
ticket is ready only once no normal or high ticket is left that is not delivered or abandoned, a
held one aside: a ticket with a `hold` waits on something outside the board, so it holds no low
ticket back, whatever its status, and counts again the moment `ticket unhold` lifts the hold.
`readyTickets` lists the same tickets in the same order as `{ id, priority, model, effort }` with the
defaults resolved, plus `group` on a ticket that has one (absent otherwise, as in `tickets`) and
`held: true` on a held one, so a dispatcher derives none of them itself.

**A group awaiting its release.** While a group has a release ticket (see `ticket release-of`) that
is neither delivered nor abandoned, every ticket of that group is the group run's and is left out of
the lists a whole-board run takes work from: `readyTicketIds`, `readyTickets`,
`reviewWaitingTickets` and `pausedBuilds`. Once the release ticket is delivered or abandoned, the
group has no release ticket, so its remaining open tickets list as any other. A group with no
release ticket lists as ungrouped tickets do. The left-out tickets still count as open normal work,
so they hold low tickets back, a held one aside.

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
| `ticket add "<title>" [--type bug\|change\|feature] [--priority low\|normal\|high] [--model <m>] [--effort <e>] [--group <name>] [--depends-on <ids>] [--epic <keys>] [--body <markdown>] [--body-file <path\|->] [--at <when>]` | File a ticket, `pending`, plus a `pending` row — none for a low ticket, which takes no task id until it is started. The body comes from `resources/templates/TicketBody.md`, from `--body`, or from `--body-file` (`-` reads standard input); an empty body falls back to the template, and afterwards the body is preserved byte for byte, so an agent may edit everything below the frontmatter freely. `--depends-on 3,4` files it already waiting on those tickets; `--epic checkout-redesign,search` files it in those epics, the first its primary one, and an epic that does not exist is refused at exit 1 with nothing written. A model or effort outside the lists, or `--body` and `--body-file` together, is refused at exit 1 with nothing written. |
| `ticket edit <id> [--append] [--body <markdown>] [--body-file <path\|->] [--json]` | Replace a ticket's body with the text of `--body` or `--body-file` (`-` reads standard input), or with `--append` add it to the end, putting one line ending before it when the body does not already end in one. The text is written in the line ending the body already uses (the frontmatter's when the body holds none), so a CRLF ticket stays CRLF throughout. The frontmatter is kept byte for byte, `updated` is not stamped — only a transition stamps it — and nothing is logged; the write takes the tracker's lock and is atomic. An empty append changes nothing and exits 0; an empty replacement, neither option or both are refused at exit 1. A value that starts with `--` is passed as `--body=<text>`. `--json` prints the ticket. |
| `ticket agent <id> [--model <m>] [--effort <e>] [--at <when>]` | Change the model or effort a ticket's agents run on, or both, with one log line such as `Ticket #003 agents opus/medium → sonnet/medium`. Refused at exit 1, writing nothing, on a delivered or abandoned ticket, with neither option, with a value outside the lists, and when the resolved pair would not change. |
| `ticket priority <id> low\|normal\|high [--at <when>]` | Change a ticket's priority, with one log line. Lowering to low is refused unless the ticket is pending, and removes its row; raising a low ticket that has no row gives it one at once. A low ticket gets its row when `ticket start` or `ticket claim` starts it, and keeps it; abandoning a low ticket that has none creates none. |
| `ticket hold <id> [--reason <text>] [--at <when>]` | Pause a ticket between build and review, or between review rounds, without stopping the dispatcher. While the frontmatter's `hold` key is set (to the reason, empty without one) the run starts no builder or reviewer for it and parks a row it left in progress for it, `ticket claim` refuses it, and `status --json` lists it in `concurrency.heldTicketIds` and marks its `readyTickets` entry `held: true`. An agent already running is never interrupted: a hold set after a builder's final status read is too late for the reviewer it starts. One log line; refused at exit 1 on a delivered or abandoned ticket and on one already held. |
| `ticket unhold <id> [--at <when>]` | Lift the hold, with one log line; the step it held starts at the dispatcher's next board read, and a run that ends first returns it under `held`. On a ticket in progress whose row is paused, a last line says how the build resumes: by a dispatcher run under a dispatcher claim note, by `task start <row>` under any other. Refused at exit 1 on a delivered or abandoned ticket and on one not held. |
| `ticket release-of <id> [--clear] [--at <when>] [--json]` | Mark a ticket as its group's release ticket, the one whose release takes the group's work to the main line. Only an open marked ticket — neither delivered nor abandoned — is the group's release ticket: a settled one's mark is history, so the group has none, and no release bundle, until another is marked. Its **release bundle** is the ticket plus every ticket of the same group it depends on, transitively, following no dependency outside the group; the group's other tickets are not in it. Stored as the frontmatter's `releasesGroup: true` on that ticket alone; `--clear` removes the key, leaving the file as though it had never been set. One log line either way. Refused at exit 1, writing nothing, on a ticket with no `group`, when another open ticket of the group — or this one — is already its release ticket, on a delivered or abandoned ticket, and with `--clear` on a ticket not marked. A delivered or abandoned ticket keeps its mark, and a move that takes it back to an open status — `ticket reopen`, or `ticket status`, which skips the move matrix but not this rule — is refused at exit 1, writing nothing, while another open ticket of its group carries the mark; with none, the move is made and the ticket is the group's release ticket again. `--json` prints the ticket. |
| `ticket epic <id> [<key>...] \| --add <keys> \| --remove <keys> [--at <when>] [--json]` | Set the epics a ticket belongs to, in order: the first is its primary epic. Bare keys replace its list and no keys clears it; `--add` appends (a key already there keeps its place), `--remove` takes keys out; either beside bare keys, or the two together, is refused as ambiguous at exit 1. A key naming no epic is refused at exit 1 with nothing written. One log line, `Ticket #003 belongs to epics checkout-redesign, search`; `updated` is not stamped. `--json` prints the ticket with `added` and `dropped`. Epics never affect dispatch, claiming, concurrency or release: that is `group`. |
| `ticket depends <id> [<id>...] \| --add <ids> \| --remove <ids> [--json]` | Set the tickets this one waits on. Bare ids replace its list, and no ids clears it; the human line names what the replace dropped, `Ticket #459 waits on #473 (dropped #463)`, and each dropped ticket not yet reviewed or delivered gets a line of its own, `#463 is still open: #459 may now start before it`. `--add 3,4` appends to the list, keeping an id already there; `--remove 3,4` takes ids out. Either beside bare ids, or the two together, is refused as ambiguous at exit 1. `--json` prints the ticket with `added` and `dropped`, the ids the change put in and took out. A ticket that does not exist, or a list that would make tickets wait on each other in a circle, is refused. Until every one is reviewed or delivered, the ticket's row, table entry and card read "waiting on #003", `ticket list` says so too, and `ticket start` warns on standard error but still moves it. An abandoned dependency does not settle it. |
| `ticket link <ticketId> <taskId> [--force]` | Point a ticket at an existing row instead of the one it filed. Refused when that row already belongs to another ticket, unless `--force`, which unlinks it there first. |
| `ticket start\|finish\|approve\|deliver\|abandon\|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]` | Move a ticket and its row together, stamping both — see [Ticket moves and their rows](#ticket-moves-and-their-rows) for which status each verb moves from. A move to the status the ticket already has is refused and logs nothing. Every move out of in-review finishes and delivers the ticket's in-progress review bar, with one log line each. `start` warns on standard error, and still moves it, when the ticket is held or waiting on a dependency. `abandon` requires `--reason`; `reopen` clears the stamps and returns the row to pending. `--branch` and `--commit` record where the work landed; `--tokens` replaces the row's figure, and on a ticket with no row (a low one never started) is refused at exit 1. |
| `ticket claim <id> [<id>...] [--owner <who>] [--note <text>] [--after <id>] [--at <when>] [--json]` | `ticket start` and the row's `--owner` and `--note` in one write, for every ticket named, as one agent: a bundle's builder claims all its tickets in one call, and their rows share one agent key. The first command an implementing agent runs. `--after <predecessor>` claims one ticket, a pipelined successor, while its predecessor is still in review: it is accepted only when the predecessor is in-review, both are in one group's release bundle (see `ticket release-of`), and the predecessor is the one unsettled ticket it waits on; otherwise refused at exit 1 with nothing written, and the slot limit applies as for any claim. Refused at exit 1, all or nothing, when any ticket is not pending or in-review, is held, waits on a ticket outside the claim that is not reviewed or delivered (one inside it counts as settled: the bundle is worked in dependency order), is low while an unheld normal or high ticket is neither delivered nor abandoned (`ticket start` only warns about that), has a review bar in progress, or when the agents in flight already number the concurrency limit. The count and the moves share one lock hold, so two claims racing for the last slot cannot both succeed. `--json` prints the ticket, or with several ids the list. |
| `ticket finish\|rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]` | The move to review, or to the next round, and the reviewer's in-progress bar (`Review <N> #<id> — <title>`, its `reviewOf` the ticket, N the `## Review` sections plus one, stored on the bar as `reviewBarRound`) in one lock hold, closing any bar of the round before: the builder's slot passes to its reviewer, and one round's to the next, without `status --json` ever showing it free. A bundle's bar carries its claim's agent key while other rows of the bundle still run, so it takes no second slot. `--owner` and `--note` name the bar, and are refused without the flag. |
| `ticket rereview <id> [--at <when>]` | Send a ticket already in review round again, for a fresh reviewer: the ticket stays in-review and only its `updated` moves, while its row goes one review round up, from 2, and the log says which round. The one verb legal on the status the ticket already has, and refused from every other. It takes no `--tokens`: the row's figure is the builder's, and a review pass has its own row. |
| `ticket status <id> <status> [...same options]` | The same move, naming the target status directly — pending, in-progress, in-review, reviewed, delivered or abandoned — with the same options. The documented way to make a move the verbs refuse: it skips the matrix. |

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

### The dispatcher and concurrency

The limits and states here survive a compaction of the orchestrator's context, because they are
stored in the tracker.

| command | what it does |
|---|---|
| `concurrency [<n>] [--json]` | Print how many agents may be in flight at once, or store a new limit for every worktree: a whole number from 1 to 10. A higher one is refused at exit 1 with nothing written, and one an older tracker stored above 10 reads as 10. A tracker that never set one reads 2. A limit below the agents already in flight is accepted and simply leaves no free slot. A slot is an agent: the in-progress rows one `ticket claim` started count once, and every other in-progress row, such as a review bar, counts on its own. `--json` prints `{ limit, agentsInFlight, freeSlots }`, after a change as well. |
| `dispatcher [running\|finished\|stopped] [--run <runId>] [--json]` | Print where the dispatcher was left, or store a new state with one log line. `running`: a dispatcher is at work. `finished`: it ended by itself, and is relaunched when a normal or high ticket is ready. `stopped`: never started, or ended by the user, and it waits for the user's go however many tickets are filed meanwhile. A tracker that never set one reads `stopped`, and the read writes nothing; any other word is refused at exit 1. `running --run <runId>` stores the Workflow run beside the state — the one a killed run is resumed by, with the same args — and every write without `--run` clears it; `--run` beside another state or none, or an empty id, is refused at exit 1. `status --json` carries both as `concurrency.dispatcherState` and `concurrency.dispatcherRunId`. `--json` prints `{ dispatcherState, dispatcherRunId }`, the run id only while one is stored, and a change adds `previousState`. |

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
| `release <id> [<id>...] --branch <b> [--worktree <path>] [--main <line>] [--json]` | Release a reviewed branch, and the only way one reaches the main line: allowing this command in the harness is the release permission, and a reviewer never runs `git merge` itself. In one lock hold, so two releases never race, it checks that each ticket is in-progress or in-review — or reviewed, when it is in a group's release bundle and that group's in-progress or in-review release ticket is released with it —, that the main checkout — the tracker's root, wherever this runs from — is on `--main` (default `main`), and that `<b>` is a local branch descending from it; fast-forwards; and moves each ticket to reviewed (unless it already is, so it is approved once) and delivered with `--branch <b>` and `--commit` set to the merged tip. In the same hold every `in-progress` review row whose `reviewOf` names a released ticket is finished and delivered at the release time and named. Several ids are the tickets of one bundle on one branch. Every refusal changes nothing, the review rows included. Afterwards it runs `git worktree remove` on `--worktree`, never forced, and `git branch -d <b>`; what git declines — a worktree holding untracked files, say — is named with its files at exit 0, since the release happened. |
| `rework [--since <commit>] [--rebased-from <old tip>] [--main <branch>] [--worktree <path>] [--files] [--json]` | How many lines of code a review reworked on a branch — added plus removed lines, never blank lines, comments or documentation (`*.md`, `*.mdx`, `*.rst`, `*.txt` and anything under the repository's `docs/`) — so that a threshold on it gives every reviewer the same verdict; no threshold is built in. `--since` counts every commit in `<commit>..HEAD`, and is refused at exit 1 when `<commit>` is not an ancestor of HEAD or a merge lies in between: work is rebased, not merged. `--rebased-from` counts what a rebase changed in the branch's own work — the hand resolution of its conflicts — as the added lines in which the branch's patch against `--main` (default `main`) differs before and after, so a line resolved by hand counts 2, main's own change none, and a rebase without conflicts 0; it is measured up to HEAD, so run it right after the rebase. See below for combining the two. `--worktree` reads that working tree instead of the current directory; `--files` adds a per-file breakdown. It needs no tracker, takes no lock and writes nothing. |

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
| `main-moved` | 1 | `<b>` does not descend from the main line: rebase `<b>` onto it, re-run the checks, count the rebase with `rework --rebased-from`, and release again |
| `merge-refused` | 1 | git will not fast-forward, typically over uncommitted changes in the main checkout, which `blockingFiles` names: commit or stash them, and release again |
| `git-failed` | 2 | git could not be read |
| `tracker-failed` | 2 | the tracker could not be read, or its lock could not be taken |

`--json` prints, on success, `{released: true, tickets, branch, mainLine, commit, closedReviewRows, cleanup}`:
`tickets` the ids just delivered, `closedReviewRows` the ids of the review rows it delivered with them,
and `cleanup` each step, the worktree's first when `--worktree` was given, as one of these, `reason`
being git's:

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
| `hook subagent-stop` | Record what a finished subagent cost, as one log line. The hook JSON arrives on standard input, and the agent's transcript is summed per API call rather than per line. When the agent's brief — its first message — holds a line `agent-progress row: <id>`, or several ids separated by commas, the log line's `input` total is also added to those rows' tokens, divided evenly. A line `agent-progress ticket: <id>` names tickets instead, each resolved to the row it holds when the hook runs. A line `agent-progress review: <id>` names one ticket whose review row the reviewer files itself: the total goes to the most recently added row reviewing that ticket (its `--review-of`; the name is not read), whatever its status; a row a ticket owns is never a review row. A brief with several is read by one alone: `row:` over `ticket:` over `review:`. The tracker is found from the hook input's own `cwd`. `init` and `update` wire it into `.claude/settings.local.json`; nobody types it. Once its arguments are read (the event word alone, no option; anything else is refused at exit 1) it exits 0 whatever goes wrong — no input, an unreadable transcript, no tracker, installed files of another install version, a row or a ticket's row that does not exist — and writes the reason to standard error: the agent has already finished, so a non-zero exit would prevent nothing and only give the orchestrator an error to read. |
| `usage [--since <when>] [--transcripts <folder>] [--json]` | What this repository's subagents cost, read out of the transcripts the harness wrote for them under `~/.claude/projects/`, a workflow's agents under `subagents/workflows/<run>/` included: one row per agent, oldest first, with its start, its API calls, its end context, its input and output, its browser calls, the characters the harness injected into it and the first line of its brief; then the cohort summary — median calls and end context, mean input and output, and the mean of each figure below. Three columns catch a brief being breached without anyone reading a transcript: `over 200k` is the share of an agent's input sent at a context past 200,000 tokens (a raw token count under `--json`), `bash edits` counts the edits it made through a shell command — a heredoc, an inline interpreter or an in-place editor — instead of the editing tools, and `checks` counts the full test, type-check and lint runs it made per edit instead of per batch. `--since` splits the cohort on an instant and summarises both sides, which is how a change in the way agents are briefed is measured. `--transcripts` reads a folder other than the one this repository's path resolves to. It writes nothing, takes no lock and regenerates no page; a repository with no transcripts is one sentence at exit 0. |

### The page and the board's lifetime

| command | what it does |
|---|---|
| `range --from <when> --to <when> [--tick <15m\|1h\|1d>]` | Store the default axis of the chart, with one log line. `--tick` takes any positive whole number of minutes, hours or days (`15m`, `2h`, `1d`), or a bare number of minutes. Besides a `<when>`, a bound may be `start`, the earliest visible row. A relative bound is stored as written, so `--from -2h` keeps meaning "the last two hours" on every refresh. A pair that is not in order is refused at exit 1 when both are timestamps or both are relative to now; a pair naming `start` or mixing the two is not judged. The page's own range bar overrides it per browser. |
| `range --auto` | Reset the axis to the automatic span. It takes no `--from`, `--to` or `--tick`; any of them beside it is refused at exit 1. |
| `render` | Regenerate `progress.html` from the progress file, `log.jsonl` and the tickets, changing nothing else — for a page lost to a crash, or after a ticket body was edited by hand. An unreadable tracker is exit 2. |
| `open` | Open `progress.html` in the default browser (`open` on macOS, `xdg-open` elsewhere), rendering it first when it is missing; a page that cannot be rendered is exit 2, as for `render`. |
| `clear [--all] [--yes]` | Throw away every task row and the log, restart the clock and reset the stored axis to automatic, leaving one `Tracker cleared` log line, and keep the tickets: each surviving ticket is given a fresh row seeded from its own frontmatter, with a new id, except a low ticket with no row. Row ids are not reused, and every epic file is kept untouched. `--all` deletes the tickets and every epic too and restarts the ticket ids at 001; `--json` prints `removedTaskCount`, `removedLogCount`, `deletedTicketCount`, `deletedEpicCount` and `reseededTicketCount`. `--yes` skips the confirmation, and is required when standard input is not a terminal. |

## Exit codes

| code | meaning | examples |
|---|---|---|
| **0** | done, or there was nothing to do | also a store write whose page could not be rebuilt (reported on standard error, with an error banner on the page when only its script failed; `render` rebuilds it), a release whose cleanup git declined, and every `hook subagent-stop` run as `init` and `update` wire it (a wrong event word, an extra argument or any option is refused at exit 1) |
| **1** | a refusal the caller can act on | no tracker here (run `agent-progress init`), no such task or ticket, a missing `--reason`, a move the matrix refuses, a claim with no free slot or on a held-back low ticket, lowering a ticket that is not pending, a release refused (`main-moved` among them), installed files of another install version (every command but `init`, `update`, `help`, `status` and `hook subagent-stop`, which reports it at exit 0; run `agent-progress update`), `init` or `update` over files a newer agent-progress installed, `hook` given a wrong event word, an extra argument or any option, and an unknown command |
| **2** | a state the tool will not repair on its own | an unreadable or malformed progress file, an unreadable or malformed log.jsonl, a malformed ticket file a command names, a lock it could not take, a release reason `git-failed` or `tracker-failed`, and any error the tool did not expect |

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
since the largest total logged for that id; a stop whose input names no agent id is added whole. The hook reads the line only from the agent's brief, its first message. A workflow
agent's first message is the harness relaying the session user's request, beginning
`[Workflow harness — user request]`; its brief is then the message right after it, the one beginning
`[Workflow harness — computed task]`, and a relay followed by anything else has no brief at all. The
orchestrator then passes no `--tokens`, which would replace the sum. Without the hook, `--tokens`
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

The tabs are **Kanban · Progress · Tickets · Epics**, in that order; the chosen one is kept in the
browser, and Epics is hidden on a board without epics.

- **Kanban tab**: one card per ticket in six lanes — To do, In progress, Review, Awaiting merge, Done
  and Abandoned — each card in the lane its state names. The open lanes run high → normal → low, then
  by id, with a divider per priority when a lane holds more than one; a card shows its priority mark,
  tokens, epic chips, waiting-on links, `held`, `no row yet` for a low ticket never started, and what it
  is waiting for (`paused since 11:45 · 1h 51m`, `no reviewer yet · 16m`, `reviewer since 13:05`). Done
  and Abandoned run newest first and show the latest 15, then 25 more at a time; Abandoned is collapsed
  until clicked. The finished-work switch decides what both closed lanes hold, and each ends with how
  many earlier cards it leaves out and a "show all". On a board with epics, an epic strip above the
  lanes narrows the board to the epics pressed, each with its roll-up; the choice is kept in the
  browser.
- **Progress tab**: the Gantt chart, filling the window below the range bar and scrolling its rows
  inside it, one row per task, newest on top, each with its number, name, ticket badge, token count,
  status pill and bar, one segment per phase it went through; and a now-marker. The log shows only in
  the detail panel, per row and ticket. A ticket's review passes are drawn as segments on its own row;
  the review-rows button in the chart's header draws each as a row of its own instead, indented
  directly above the ticket it reviews, latest round first, a bundle's review, `Review 1 #13, #5 — …`,
  once above the first ticket it names. A review whose ticket has no row on the chart — a low ticket
  not started, or one hidden as long done — is always a row of its own, drawn where its filing puts
  it. Beside that button, another widens the name column; both are kept in the browser. On a board
  with epics the rows are grouped under a head per epic, a ticket under its primary epic only, then
  "No epic"; a head folds its rows away, and the folds are kept in the browser.
- **Tickets tab**: a table of the tickets with a count above it, searched by id, title, epic,
  branch, group and body text, narrowed by type, status and (on a board with epics) epic chips, and
  sorted by any column; on a board with epics it can be grouped by epic, a choice kept in the
  browser. A ticket's body shows only in the detail panel.
- **Epics tab**: one card per epic, open ones first, with its key, its description's first paragraph,
  a roll-up of its tickets by status and their list; the title opens the epic in the detail panel and
  a ticket opens that ticket.
- **The header** above the tabs: a status line, `LIVE` while the page is under ten minutes old and
  `SNAPSHOT` after, with how long ago it was generated, re-checked every minute so an open page turns
  into a snapshot without a reload; the project name; the Auto · Light · Dark theme switch; and four
  figures: agents working (running rows over the concurrency limit), tickets delivered today, the
  tokens of rows that ended today or still run, and tickets waiting in the queue, with a fifth, the
  paused builds, only while there are some. Each figure but the tokens opens its Kanban lane. Below
  them, the activity banner lists every running row, longest-running first, as `BUILDING` or, for a
  row with `--review-of`, `REVIEWING`, with its ticket and a running timer; a snapshot freezes the
  timers at the moment the page was generated. The tab row holds the tabs and the finished-work
  switch.
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
- **Range bar**: the presets Fit · 1h · 4h · 12h · 24h · 7d, then Custom… with free-text bounds that
  accept `start`, `now` and `-2h` as well as timestamps, and a tick-step selector. Fit, the default,
  spans the rows shown from their earliest start to now with a small margin, and re-fits whenever the
  finished-work switch or the data changes; the default stored by `agent-progress range` takes its
  place when there is one. Any other choice holds until Fit is pressed again, and is kept in the
  browser. Bars outside the window are clipped and marked, never dropped.
- **Finished work** (delivered or abandoned) is shown by one switch in the tab row, shared by Kanban,
  Progress and Tickets: the last hour, the last day (the default), or a custom 6 hours, 12 hours,
  3 days, all, or since a day. Unfinished work, awaiting merge included, always shows; the ticket
  search looks through every ticket. A note says how much is hidden and shows it all when clicked;
  the choice is kept in the browser.
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
| `in-review`, no ticket in review | `Awaiting review` | handed in, no ticket review under way |
| `in-review`, ticket `in-review` | `Reviewing` | the ticket is in review |
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
  .lock/                 the lock's generation records
```

A mutating command writes, under one lock hold, the progress file, then the tickets it changed, then
the epics it added, changed or removed, then `log.jsonl`, then the page, so a log line never describes
an unstored change. Every file a reader may hold open is written atomically: a temporary file beside the target, fsync,
rename. Timestamps carry the offset of the machine that wrote them and are displayed as written,
never re-parsed into a viewer's zone.

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
  "dispatcherState": "running",                  // optional: running|finished|stopped, absent reads stopped
  "dispatcherRunId": "wf_example-run-1",         // optional: the Workflow run to resume, only beside running
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
      "reviewBarRound": 1                        // optional: which review of that ticket this bar is, from 1
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
the three, or an empty or blank `dispatcherRunId` makes the file unreadable (exit 2), and so does a
present optional row key of the wrong shape: `reviewRound` below 2, `reviewBarRound` below 1, or a
`history` that is not a list of known statuses with their stamps. A task is linked to at
most one ticket. Task ids are never reused, not even after `task remove` or `clear`.

A row or history phase in a status the file format does not know, the retired `running` or
`finished` included, makes the file unreadable (exit 2) with the same advice. A row is a review bar
by its `reviewOf` alone, never by its name.

### `.agent-progress/log.jsonl`

One record per line, each a JSON object ending in a newline: `at`, `kind`, then `taskId`,
`ticketId` or `epicKey` where the kind names them, then `fields`. `status` and the page word each
record as a sentence; a note's sentence is its text.

| kind | ids | fields |
|---|---|---|
| `note` | — | `text` |
| `ticket-filed` | `ticketId` | `title` |
| `ticket-reopened`, `ticket-started`, `ticket-finished`, `ticket-approved`, `ticket-delivered`, `ticket-unheld`, `ticket-release-cleared` | `ticketId` | none |
| `ticket-abandoned`, `ticket-held` | `ticketId` | `reason` |
| `ticket-rereviewed` | `ticketId` | `round`, from 2 |
| `ticket-priority-changed` | `ticketId` | `from`, `to`: priorities |
| `ticket-agents-changed` | `ticketId` | `from`, `to`: each `{ model, effort }` |
| `ticket-dependencies-set` | `ticketId` | `dependsOn`: ticket ids |
| `ticket-epics-set` | `ticketId` | `epics`: epic keys |
| `ticket-release-marked` | `ticketId` | `group` |
| `epic-added`, `epic-edited` | `epicKey` | `title` |
| `epic-removed` | `epicKey` | none |
| `review-bar-started`, `review-bar-closed` | `taskId`, `ticketId` | `name` |
| `chart-range-set` | — | `view`, shaped as `progress.json`'s |
| `concurrency-limit-set` | — | `limit` |
| `dispatcher-set` | — | `state`, `runId` (a run id or `null`) |
| `tracker-cleared` | — | none |
| `agent-stopped` | — | below |

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

### `.agent-progress/version.json`

```
{
  "installVersion": 1
}
```

The install version of the files `init` and `update` installed, indented two spaces and ending in a
newline, written atomically by both after every other file they write. It is read as a JSON object
whose `installVersion` is a whole number of at least 1; any other key is ignored and not written back.
A file recording another version, holding anything else or unreadable is a mismatch, and so is an
absent file while `agent-brief.md` is installed; an absent file with no brief is none.
[Install version](#install-version) says what a mismatch does.

### `.agent-progress/tickets/003-double-click-a-role-to-edit-it.md`

The file name is the padded id and a slug of the title; the ticket is known by its frontmatter `id`.
The CLI writes its keys in this order, omitting an optional key it does not have:

```
---
id: "003"
title: "Double-click a role to edit it"
type: "change"
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
task: 17
owner: Alex Example
---
# 003 — Double-click a role to edit it

## Report
…
```

| key | written | value |
|---|---|---|
| `id`, `title`, `type`, `status`, `filed`, `updated` | always; required | `type`: bug, change, feature. `status`: pending, in-progress, in-review, reviewed, delivered, abandoned. `updated` is stamped on every move. |
| `priority`, `model`, `effort` | only once named | `priority`: low, normal, high. `model`: haiku, sonnet, opus, fable. `effort`: low, medium, high, xhigh, max. Absent reads as normal, and as opus and medium, so an older ticket is never rewritten to gain them. |
| `hold` | only while held | the hold's reason, empty without one; any value but `null`, a bare `hold:` included, is held. Set and remove it with `ticket hold` and `unhold`. |
| `started`, `finished`, `delivered`, `abandonedAt` | always | a timestamp or `null`; an absent one reads as `null` |
| `group`, `branch`, `commit`, `reason` | when given | text; `reason` is dropped by `reopen` |
| `releasesGroup` | only on a group's release ticket | `true`; absent or `null` is not the release ticket, any other value makes the file malformed. Set and remove it with `ticket release-of`. |
| `dependsOn` | when non-empty | ticket ids, written `"001, 002"`, read from any mix of commas and spaces with or without `#` or padding. Set it with `ticket depends`, which refuses a missing id or a circle; bare ids replace the list, `--add` and `--remove` change it. |
| `epics` | when non-empty | epic keys, written `"loyalty-programme, checkout-redesign"` and read like `dependsOn`, in order: the first is the primary epic. A part that is not an epic key makes the file malformed; a key whose epic is gone is kept. Set it with `ticket epic`, which refuses an epic that does not exist. |
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
malformed at its status line, the reason ending in the advice to run `agent-progress update` with a
release that still reads it.

**Unknown keys, comments and blank lines are kept and written back**, so a field you add by hand —
`owner: Alex Example` above — survives every transition. The CLI's own keys are rewritten at the top
in the order above and everything else follows, keeping its order among itself, so a hand-written
line moves below the CLI's block once and never again.

The body is preserved byte for byte from the ticket template (Report, Wanted, Acceptance, Handoff),
`--body` or `--body-file`; an empty body falls back to the template. `ticket edit` replaces the body or
appends to it and leaves the frontmatter's bytes as they are, a hand-written layout included. A malformed ticket file is listed
as ignored rather than failing `status` or `render`. A new ticket id is one past the highest of every
file name, every parsed id and every ticket a row names; gaps are tolerated, never filled.

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

## Ticket moves and their rows

The **from** column is the matrix the named verbs enforce; `ticket status <id> <status>` skips it.
**its row** is the status stored; **pill** is what that row then reads on the chart.

| command | from | ticket status | its row | pill | stamps written | log line |
|---|---|---|---|---|---|---|
| `ticket add` | — | pending | created `pending`; none when low | `To do` | `filed` | `Ticket #003 filed: <title>` |
| `ticket start` | pending, in-review | in-progress | `in-progress`, its claim's `agent` key dropped; created for a low ticket | `In progress` | `started` if null; the row's end cleared | `Ticket #003 started` |
| `ticket claim` | pending, in-review, and for every id named: not held, no review bar in progress, dependencies settled (one on a ticket in the same claim is, and with `--after` the in-review predecessor of its release bundle), a free slot, and for a low ticket no unheld normal or high one owed | in-progress | `in-progress`, created for a low ticket; with `--owner`, `--note` and the claim's `agent` key | `In progress` | as `start` | `Ticket #003 started`, one per ticket |
| `ticket finish` | in-progress | in-review | `in-review` | `Reviewing` | `finished` if null | `Ticket #003 in review` |
| `ticket finish --start-review` | in-progress | in-review | `in-review`, plus an in-progress review row | `Reviewing` | as `finish` | as `finish`, and `Review row #18 started: <name>` |
| `ticket rereview` | in-review | in-review, unchanged | `re-review`, one round up from 2 | `Reviewing (round 2)` | `updated` only | `Ticket #003 in review, round 2` |
| `ticket rereview --start-review` | in-review | in-review, unchanged | as `rereview`, plus an in-progress review row; the round before's row delivered | `Reviewing (round 2)` | as `rereview` | as `rereview`, then `Closed the review row #18, delivered: <name>` and `Review row #19 started: <name>` |
| `ticket approve` | in-progress, in-review | reviewed | `reviewed`, its `reviewed` stamp set if unset | `Awaiting merge` | `finished` if null | `Ticket #003 reviewed` |
| `ticket deliver` | reviewed | delivered | `delivered` | `Done` | `delivered` if null | `Ticket #003 delivered` |
| `release` | in-progress, in-review; reviewed for a release bundle's ticket released with its group's release ticket | reviewed (unless already), then delivered | `delivered`; in-progress review rows delivered | `Done` | `finished` and `delivered` if null; `branch`, `commit` | the reviewed and delivered lines, and one per review row closed |
| `ticket abandon` | anything but delivered, abandoned | abandoned | `abandoned`; none created for a low ticket without one | `Abandoned` | `abandonedAt`, always; the row's end if it had started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | anything but pending; a group's release ticket only while no other release ticket of its group is open | pending | `pending`, its start, end, `reviewed` and `reviewRound` cleared | `To do` | all four cleared; `reason` dropped | `Ticket #003 reopened` |
| `ticket priority … low` | pending | pending | removed | — | — | `Ticket #003 priority normal → low` |
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

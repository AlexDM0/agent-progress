# agent-progress — command and file-format reference

The complete reference for someone using the tool: what `init` and `update` write into a repository,
every command and flag, the exit codes, what the dashboard shows, the two files on disk and what each
ticket move does to its Gantt row. The code wins every disagreement: `agent-progress help` prints the
command reference from `cli/HelpText.ts` and is never out of step with the tool, and
`skill/Reference.md` is the fuller source on tokens, the concurrency limit, the dispatcher state and
releasing. The overview is in the [README](../README.md); working on this repository yourself is in
[development.md](development.md).

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
| `<n>` | The figure on `--tokens`: a whole number or a decimal with a `k`/`m` suffix — `12000`, `12k`, `12.3k`, `1.2m`. A bare decimal and a negative are refused. It is a figure the orchestrator reports, never one this tool measures, and it replaces the row's figure rather than adding to it. |
| `<id>` | A task id is a number (`17`); a ticket id is its padded number (`003`), and `3` or `#3` name the same ticket. |
| `AGENT_PROGRESS_ROOT` | Names the repository to use instead of walking up from the current directory, for a command run from somewhere else entirely. It does not create a tracker: a value naming a directory that has none is refused with a message saying the variable is set. |

**One tracker per repository.** The tracker lives in `.agent-progress/` at the repository root, found
with `git rev-parse --git-common-dir`, so every worktree of a repository shares one tracker and one
chart.

**Locking.** Every mutating command (`init`, `task`, `ticket`, `log`, `concurrency`, `dispatcher`,
`range`, `release`, `clear`, `hook subagent-stop`) takes the tracker's lock, reads, changes, writes
`progress.json` atomically, writes any ticket file after it, and regenerates `progress.html` from
disk — all before releasing the lock, so the page never describes a state the store did not hold.
`render` and `open` take the lock only to render. `status`, `ticket list`, `ticket show`,
`concurrency` and `dispatcher` without an argument, `usage` and `rework` take none: every file they
read is written atomically. `update` takes none either, since it writes nothing inside the tracker.

**Help and options.** `agent-progress help` prints the whole reference. `--help` works after a
command word as well as on its own, and `-h` on its own or straight after the command word; a `-h`
further on is refused at exit 1, since it may be text (put text behind a bare `--`). An option taking
a value, given twice, is refused at exit 1.

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
`depends`, `hold`, `unhold`, `reopen` and `status <id> open` add one more line: the run picks the
change up at its next agent's return and is never stopped or relaunched for it. `--json` output
carries neither line.

## Adopting a repository

```sh
cd <the repository to track>
agent-progress init
```

`init` creates the tracker and installs everything a session needs to use it. Of the seven things
below, the first four are the tracker itself and the instructions pointing at it; the last three are
Claude Code files under `.claude/`, each written by default and each with its own opt-out.

| # | what | path | written by | opt-out |
|---|---|---|---|---|
| 1 | The tracker: `progress.json`, a `tickets/` folder, the generated `progress.html` and the `.lock` directory | `.agent-progress/` | `init` only | — |
| 2 | The agent brief, from `templates/AgentBrief.md` | `.agent-progress/agent-brief.md` | `init`, `update` | — |
| 3 | A `.gitignore` entry for the tracker | `.gitignore` | `init` only | — |
| 4 | The managed block, from `templates/ClaudeInstructionsBlock.md` | `CLAUDE.md` | `init`, `update` | `--no-claude-md` |
| 5 | The `SubagentStop` hook running `agent-progress hook subagent-stop` | `.claude/settings.local.json` | `init`, `update` | `--no-hooks` |
| 6 | The dispatcher workflow, from `templates/workflows/AgentProgressDispatch.js` | `.claude/workflows/agent-progress-dispatch.js` | `init`, `update` | `--no-workflow` |
| 7 | The worker agent definition, from `templates/AgentProgressWorker.md` | `.claude/agents/agent-progress-worker.md` | `init`, `update` | `--no-agent-definition` |

1. **The tracker.** Its root is the main checkout, found from any worktree.
2. **The brief** an orchestrator fills in before it spawns an implementing agent: the scope, the facts
   it needs instead of a reading list, how many calls and browser calls it may spend, when to stop,
   and what to report. It is guidance shipped with the tool rather than a file a project edits, so
   every `init` and every `update` rewrites it.
3. **The `.gitignore` entry**, only when the repository does not already ignore the tracker.
   `git check-ignore` decides, so a repository covered by a broader pattern, a parent `.gitignore` or
   `.git/info/exclude` gets no diff at all.
4. **The managed block**, between `<!-- agent-progress:managed:start -->` and
   `<!-- agent-progress:managed:end -->`, telling the next agent to track its work through the tool.
   The file is written in place, so a symlinked `CLAUDE.md` stays a symlink; a start marker with no
   end marker is refused and the file is left alone.
5. **The hook**, under an empty matcher so every subagent type is recorded. It goes into
   `.claude/settings.local.json` — the per-user file Claude Code applies over the shared one and keeps
   out of git — so an accurate token figure needs no flag and lands in nothing colleagues share. A
   repository that already keeps this hook in the shared `.claude/settings.json` has it kept current
   there instead: never moved, never a second copy that would log every agent twice. Either way it
   merges into whatever the file holds, is never added twice, refuses a document it cannot parse
   rather than replacing it, and writes nothing when the entry already says what it should. `--hooks`
   is still accepted and does nothing: the hook it used to ask for is now the default.
6. **The dispatcher**, copied byte for byte. The orchestrator launches it by its path —
   `Workflow({ scriptPath: '<mainCheckout>/.claude/workflows/agent-progress-dispatch.js', args: { mainCheckout, mainLine, checkCommand, installCommand, includeLowPriority } })`
   — which works whenever the file exists; the name `agent-progress-dispatch` works too, but only in
   a session started after the file was installed. It is the tool's script, not the project's, so a
   hand edit is undone.
7. **The worker agent definition**, a Claude Code subagent whose frontmatter sets `model: opus` and
   `effort: medium` — the default for every agent that builds or reviews a ticket. The Agent tool
   takes a subagent's effort from its definition alone, so spawning `agent-progress-worker` is how an
   orchestrator working by hand gets the default pair. A ticket that names another pair
   (`ticket add --model/--effort`, `ticket agent`) is run through the dispatcher, which passes each
   agent the pair from `readyTickets`. A hand edit is undone.

`update`, and `init` at a root that already has a tracker, report items 2 and 4–7 on a line each:
`updated` or `unchanged`, judged from the file's bytes before and after (the hook from its entry, and
as `installed` when it was added), or `left alone` under the item's opt-out. The brief's `updated`
adds "re-read it before your next brief", so a session that read it at its start learns its copy is
stale. A first `init` prints the brief's path instead.

**Re-running.** To pick up a newer brief, block, hook, workflow or agent definition, run
`agent-progress update`, never `init` again. `init` at a root that already has a tracker does exactly
what `update` does and says so; `init` below an existing tracker, inside a bare repository, or with a
`--root` that is not an existing directory is refused.

Claude Code adds `**/.claude/settings.local.json` to your global git excludes the first time it
writes that file itself. If it has not yet, and the file this tool creates shows up in `git status`,
ignore it the way you ignore any personal file; this tool writes no `.gitignore` entry for it.

## The two skills

`setup.sh` links two Claude Code skills into `~/.claude/skills/`, split by audience because the
first one's trigger fires in every session in a tracked repository, every implementing subagent
included.

| skill | folder | for | holds |
|---|---|---|---|
| `agent-progress` | `skill/` | any session in a tracked repository | the model, how to file and move a ticket, what an implementing agent owes its `## Handoff`, the rules. No command list: `agent-progress help` is the reference, and `skill/Reference.md` holds what the help does not print. |
| `agent-progress-orchestrate` | `skill-orchestrate/` | the one session running the board, started with `/agent-progress-orchestrate` | intake (grilling each request until its acceptance is unambiguous, filing it with a `## Brief`), launching, relaunching and resuming the dispatcher, triaging low-priority tickets. |

The dispatcher runs a builder per ready ticket, each on a worktree of its own, within the board's
limit, and hands each rebased branch to a clean reviewer that releases it with
`agent-progress release`. Builders and reviewers run on opus at medium effort unless their ticket
names another pair; the dispatcher's survey and parking agents run on haiku at low effort. A finding a
reviewer does not fix it files as a low-priority ticket. A second review round runs only when a pass
reworked over 750 lines of code, and the dispatcher decides that in code. It starts no low ticket
unless launched with `includeLowPriority: true`, returning the low ones ready as `lowPriorityWaiting`
instead. A single-ticket run (`ticketIds: ['<id>']`) runs beside the whole-board one, and a run that
died or was killed is resumed by the id `dispatcher running --run` stored, with the same args.

## Commands

Options in `[brackets]` are optional; `a|b` is a choice of one.

### Setup

| command | what it does |
|---|---|
| `init [--project <name>] [--root <path>] [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]` | Create the tracker here and write the seven items in [Adopting a repository](#adopting-a-repository). `--project` names the project shown on the page (default: the root directory's name); `--root` tracks that directory instead of the discovered repository root. Refused when an ancestor already holds a tracker, when `--root` is not an existing directory, and inside a bare repository. A re-run refreshes only what `update` refreshes. `--hooks` is accepted and does nothing. |
| `update [--no-claude-md] [--no-hooks] [--no-workflow] [--no-agent-definition]` | Refresh what the tool wrote into a repository it already tracks: the managed block, `agent-brief.md`, the hook, the workflow and the agent definition, undoing a hand edit to either of the last two. It creates no tracker and touches neither the progress file, the tickets nor the log, so it takes no `--project` and no `--root`. With no tracker it is refused at exit 1, naming `agent-progress init`. |
| `help` | The command reference. |

### Reading the board

| command | what it does |
|---|---|
| `status [--json] [--full]` | The project, the counts, the rows that are not delivered or abandoned, and the last five log entries newest first, then the Next line. `--json` prints the same working view for an agent — the unsettled rows and tickets, the last 10 log entries, and an `omitted` object counting what was left out. `--full` lists everything; with `--json` it prints the whole progress file plus every ticket's frontmatter. Both `--json` documents carry `concurrency` — `limit`, `agentsInFlight`, `freeSlots`, `readyTicketIds`, `heldTicketIds`, `dispatcherState` and, while one is stored, `dispatcherRunId` — and beside it `readyTickets`. |
| `ticket list [--status <s>] [--priority <p>] [--json]` | The tickets with their status, priority, type and row id, the model and effort after the title where the ticket names them, and "waiting on #003" where a dependency is unsettled. `--status` and `--priority` narrow the listing. `--json` carries no bodies. |
| `ticket show <id> [--json]` | One ticket: its frontmatter, its priority, its model and effort where it names them, its body, and always its file path — which is what an agent needs in order to edit that body. |

**Ready tickets.** A ticket is ready when it is open and every ticket it depends on is done or
delivered. `readyTicketIds` orders them high priority first, then normal, each lowest id first. A low
ticket is ready only once no normal or high ticket is left that is not delivered or abandoned.
`readyTickets` lists the same tickets in the same order as `{ id, priority, model, effort }` with the
defaults resolved, plus `held: true` on a held one, so a dispatcher derives none of them itself.

### Tasks

A task is a row on the Gantt chart. A row a ticket owns is moved by the `ticket` verbs; the `task`
verbs refuse it, except a pause and its resume, naming the `ticket` verb that moves both, and
`--force` moves only the row.

| command | what it does |
|---|---|
| `task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--review-of <id>] [--start] [--tokens <n>] [--at <when>] [--force]` | Add a row. `--start` marks it running at `--at` (default now); `--note` is the detail shown beside the bar; `--tokens` records what the work cost. `--ticket` links it to a ticket that has no row of its own, and `--force` moves that link off the row that holds it. `--review-of` marks the row as a review pass of that ticket, drawn directly above the ticket's own row, latest round first; a ticket that does not exist is refused at exit 1. A row without it whose name starts `Review <N> #<id>` is nested the same way; for a bundle, the first id named is the parent. |
| `task start\|pause\|finish\|review\|rereview\|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]` | Move one row and stamp it. `start` sets its start and resumes a paused row; `pause` records that the work is waiting without closing the bar; `finish` and `review` set its end; `rereview` sends a row whose review found too much into its next review pass — round 2, then 3 — without reopening the bar; `deliver` records that the work reached its destination. |
| `task update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]` | Change a row without moving its clock, and without adding to its `history`: a correction is not something that happened. At least one field is required. `--status` is for a correction the transitions cannot express, and on a row a ticket owns is refused unless `--force`, except a pause and its resume. |
| `task remove <id>` | Delete a row. A ticket pointing at it is unlinked rather than deleted. The id is never given to another row. |
| `log "<text>" [--at <when>]` | Append one line to the log shown under the chart. Every positional is joined, so an unquoted sentence is kept whole. |

The task statuses are `pending`, `running`, `paused`, `finished`, `re-review`, `reviewed`,
`delivered` and `abandoned`.

### Tickets

A ticket is a markdown file under `.agent-progress/tickets/` driving one Gantt row. Types are `bug`,
`change` (the default) and `feature`; priorities `low`, `normal` (the default) and `high`; models `haiku`,
`sonnet`, `opus` and `fable`; efforts `low`, `medium`, `high`, `xhigh` and `max`. Left unnamed, a
ticket's agents run on opus at medium effort.

| command | what it does |
|---|---|
| `ticket add "<title>" [--type bug\|change\|feature] [--priority low\|normal\|high] [--model <m>] [--effort <e>] [--group <name>] [--depends-on <ids>] [--body <markdown>] [--body-file <path\|->] [--at <when>]` | File a ticket, `open`, plus a `pending` row — none for a low ticket, which takes no task id until it is started. The body comes from `templates/TicketBody.md`, from `--body`, or from `--body-file` (`-` reads standard input); an empty body falls back to the template, and afterwards the body is preserved byte for byte, so an agent may edit everything below the frontmatter freely. `--depends-on 3,4` files it already waiting on those tickets. A model or effort outside the lists is refused at exit 1. |
| `ticket agent <id> [--model <m>] [--effort <e>] [--at <when>]` | Change the model or effort a ticket's agents run on, or both, with one log line such as `Ticket #003 agents opus/medium → sonnet/medium`. Refused at exit 1, writing nothing, on a delivered or abandoned ticket, with neither option, with a value outside the lists, and when the resolved pair would not change. |
| `ticket priority <id> low\|normal\|high [--at <when>]` | Change a ticket's priority, with one log line. Lowering to low is refused unless the ticket is open, and removes its row; raising a low ticket that has no row gives it one at once. A low ticket gets its row when `ticket start` or `ticket claim` starts it, and keeps it; abandoning a low ticket that has none creates none. |
| `ticket hold <id> [--reason <text>] [--at <when>]` | Pause a ticket between build and review, or between review rounds, without stopping the dispatcher. While the frontmatter's `hold` key is set (to the reason, empty without one) the run starts no builder or reviewer for it and parks a row it left running for it, `ticket claim` refuses it, and `status --json` lists it in `concurrency.heldTicketIds` and marks its `readyTickets` entry `held: true`. An agent already running is never interrupted: a hold set after a builder's final status read is too late for the reviewer it starts. One log line; refused at exit 1 on a delivered or abandoned ticket and on one already held. |
| `ticket unhold <id> [--at <when>]` | Lift the hold, with one log line; the step it held starts at the dispatcher's next board read, and a run that ends first returns it under `held`. On a ticket in progress whose row is paused, a last line says how the build resumes: by a dispatcher run under a dispatcher claim note, by `task start <row>` under any other. Refused at exit 1 on a delivered or abandoned ticket and on one not held. |
| `ticket depends <id> [<id>...]` | Set the tickets this one waits on, replacing its list; no ids clears it. A ticket that does not exist, or a list that would make tickets wait on each other in a circle, is refused. Until every one is done or delivered, the ticket's row, table entry and card read "waiting on #003", `ticket list` says so too, and `ticket start` warns on standard error but still moves it. An abandoned dependency does not settle it. |
| `ticket link <ticketId> <taskId> [--force]` | Point a ticket at an existing row instead of the one it filed. Refused when that row already belongs to another ticket, unless `--force`, which unlinks it there first. |
| `ticket start\|review\|done\|deliver\|abandon\|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]` | Move a ticket and its row together, stamping both — see [Ticket moves and their rows](#ticket-moves-and-their-rows) for which status each verb moves from. A move to the status the ticket already has is refused and logs nothing. Every move out of in-review finishes and delivers the ticket's running review bar, with one log line each. `start` warns on standard error, and still moves it, when the ticket is held or waiting on a dependency. `abandon` requires `--reason`; `reopen` clears the stamps and returns the row to pending. `--branch` and `--commit` record where the work landed; `--tokens` replaces the row's figure, and on a ticket with no row (a low one never started) is refused at exit 1. |
| `ticket claim <id> [<id>...] [--owner <who>] [--note <text>] [--at <when>] [--json]` | `ticket start` and the row's `--owner` and `--note` in one write, for every ticket named, as one agent: a bundle's builder claims all its tickets in one call, and their rows share one agent key. The first command an implementing agent runs. Refused at exit 1, all or nothing, when any ticket is not open or in-review, is held, waits on a ticket outside the claim that is not done or delivered (one inside it counts as settled: the bundle is worked in dependency order), is low while a normal or high ticket is neither delivered nor abandoned (`ticket start` only warns about that), has a review bar running, or when the agents in flight already number the concurrency limit. The count and the moves share one lock hold, so two claims racing for the last slot cannot both succeed. `--json` prints the ticket, or with several ids the list. |
| `ticket review\|rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]` | The move to review, or to the next round, and the reviewer's running bar (`Review <N> #<id> — <title>`, its `reviewOf` the ticket, N the `## Review` sections plus one) in one lock hold, closing any bar of the round before: the builder's slot passes to its reviewer, and one round's to the next, without `status --json` ever showing it free. A bundle's bar carries its claim's agent key while other rows of the bundle still run, so it takes no second slot. `--owner` and `--note` name the bar, and are refused without the flag. |
| `ticket rereview <id> [--at <when>]` | Send a ticket already in review round again, for a fresh reviewer: the ticket stays in-review and only its `updated` moves, while its row goes one review round up, from 2, and the log says which round. The one verb legal on the status the ticket already has, and refused from every other. It takes no `--tokens`: the row's figure is the builder's, and a review pass has its own row. |
| `ticket status <id> <status> [...same options]` | The same move, naming the target status directly — open, in-progress, in-review, done, delivered or abandoned — with the same options. The documented way to make a move the verbs refuse: it skips the matrix. |

### The dispatcher and concurrency

The limits and states here survive a compaction of the orchestrator's context, because they are
stored in the tracker. `skill/Reference.md` is the fuller source on both.

| command | what it does |
|---|---|
| `concurrency [<n>] [--json]` | Print how many agents may be in flight at once, or store a new limit for every worktree: a whole number from 1 to 10. A higher one is refused at exit 1 with nothing written, and one an older tracker stored above 10 reads as 10. A tracker that never set one reads 2. A limit below the agents already in flight is accepted and simply leaves no free slot. A slot is an agent: the running rows one `ticket claim` started count once, and every other running row, such as a review bar, counts on its own. |
| `dispatcher [running\|finished\|stopped] [--run <runId>] [--json]` | Print where the dispatcher was left, or store a new state with one log line. `running`: a dispatcher is at work. `finished`: it ended by itself, and is relaunched when a normal or high ticket is ready. `stopped`: never started, or ended by the user, and it waits for the user's go however many tickets are filed meanwhile. A tracker that never set one reads `stopped`, and the read writes nothing; any other word is refused at exit 1. `running --run <runId>` stores the Workflow run beside the state — the one a killed run is resumed by, with the same args — and every write without `--run` clears it; `--run` beside another state or none, or an empty id, is refused at exit 1. `status --json` carries both as `concurrency.dispatcherState` and `concurrency.dispatcherRunId`. |

### Release and rework

| command | what it does |
|---|---|
| `release <id> [<id>...] --branch <b> [--worktree <path>] [--main <line>] [--json]` | Release a reviewed branch, and the only way one reaches the main line: allowing this command in the harness is the release permission, and a reviewer never runs `git merge` itself. In one lock hold, so two releases never race, it checks that each ticket is in-progress or in-review, that the main checkout — the tracker's root, wherever this runs from — is on `--main` (default `main`), and that `<b>` is a local branch descending from it; fast-forwards; and moves each ticket done and delivered with `--branch <b>` and `--commit` set to the merged tip. In the same hold every `running` review row whose `reviewOf` names a released ticket is finished and delivered at the release time and named; a row linked by its name alone is left. Several ids are the tickets of one bundle on one branch. Every refusal changes nothing, the review rows included. Afterwards it runs `git worktree remove` on `--worktree`, never forced, and `git branch -d <b>`; what git declines — a worktree holding untracked files, say — is named with its files at exit 0, since the release happened. |
| `rework [--since <commit>] [--rebased-from <old tip>] [--main <branch>] [--worktree <path>] [--files] [--json]` | How many lines of code a review reworked on a branch — added plus removed lines, never blank lines, comments or documentation (`*.md`, `*.mdx`, `*.rst`, `*.txt` and anything under the repository's `docs/`) — so that a threshold on it gives every reviewer the same verdict; no threshold is built in. `--since` counts every commit in `<commit>..HEAD`, and is refused at exit 1 when `<commit>` is not an ancestor of HEAD or a merge lies in between: work is rebased, not merged. `--rebased-from` counts what a rebase changed in the branch's own work — the hand resolution of its conflicts — as the added lines in which the branch's patch against `--main` (default `main`) differs before and after, so a line resolved by hand counts 2, main's own change none, and a rebase without conflicts 0; it is measured up to HEAD, so run it right after the rebase. See below for combining the two. `--worktree` reads that working tree instead of the current directory; `--files` adds a per-file breakdown. It needs no tracker, takes no lock and writes nothing. |

**Release refusals.** `--json` prints `{released: false, reason, detail, cleanup: []}`:

| reason | exit | when |
|---|---|---|
| `invalid-request` | 1 | the arguments do not describe a release — no id or no `--branch`, a branch named like an option or after the main line, an unknown option — or there is no tracker here |
| `unknown-ticket` | 1 | a ticket id names no ticket |
| `ticket-not-releasable` | 1 | a ticket is not in-progress or in-review |
| `unknown-branch` | 1 | `<b>` is not a local branch |
| `not-on-main-line` | 1 | the main checkout is not on `--main`, or `--main` is not a local branch |
| `main-moved` | 1 | `<b>` does not descend from the main line: rebase `<b>` onto it, re-run the checks, count the rebase with `rework --rebased-from`, and release again |
| `merge-refused` | 1 | git will not fast-forward |
| `git-failed` | 2 | git could not be read |
| `tracker-failed` | 2 | the tracker could not be read, or its lock could not be taken |

On success `--json` prints `{released: true, tickets, branch, mainLine, commit, closedReviewRows, cleanup}`,
`closedReviewRows` being the ids of the review rows it delivered. A cleanup step is one of:

```
{ target: worktree, path, outcome: removed }
{ target: worktree, path, outcome: left, reason, untrackedFiles, changedFiles }
{ target: branch, name, outcome: deleted }
{ target: branch, name, outcome: left, reason }
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
| `hook subagent-stop` | Record what a finished subagent cost, as one log line. The hook JSON arrives on standard input, and the agent's transcript is summed per API call rather than per line. When the agent's brief — its first message — holds a line `agent-progress row: <id>`, or several ids separated by commas, the log line's `input` total is also added to those rows' tokens, divided evenly. A line `agent-progress ticket: <id>` names tickets instead, each resolved to the row it holds when the hook runs. A line `agent-progress review: <id>` names one ticket whose review row the reviewer files itself: the total goes to the most recently added row reviewing that ticket (`--review-of`, or a `Review <N> #<id>` name), whatever its status. A brief with several is read by one alone: `row:` over `ticket:` over `review:`. The tracker is found from the hook input's own `cwd`. `init` and `update` wire it into `.claude/settings.local.json`; nobody types it. It exits 0 whatever goes wrong — no input, an unreadable transcript, no tracker, a row or a ticket's row that does not exist — and writes the reason to standard error: the agent has already finished, so a non-zero exit would prevent nothing and only give the orchestrator an error to read. |
| `usage [--since <when>] [--transcripts <folder>] [--json]` | What this repository's subagents cost, read out of the transcripts the harness wrote for them under `~/.claude/projects/`, a workflow's agents under `subagents/workflows/<run>/` included: one row per agent, oldest first, with its start, its API calls, its end context, its input and output, its browser calls, the characters the harness injected into it and the first line of its brief; then the cohort summary — median calls and end context, mean input and output, and the mean of each figure below. Three columns catch a brief being breached without anyone reading a transcript: `over 200k` is the share of an agent's input sent at a context past 200,000 tokens (a raw token count under `--json`), `bash edits` counts the edits it made through a shell command — a heredoc, an inline interpreter or an in-place editor — instead of the editing tools, and `checks` counts the full test, type-check and lint runs it made per edit instead of per batch. `--since` splits the cohort on an instant and summarises both sides, which is how a change in the way agents are briefed is measured. `--transcripts` reads a folder other than the one this repository's path resolves to. It writes nothing, takes no lock and regenerates no page; a repository with no transcripts is one sentence at exit 0. |

### The page and the board's lifetime

| command | what it does |
|---|---|
| `range --from <when> --to <when> [--tick <15m\|1h\|1d>]` | Store the default axis of the chart, with one log line. `--tick` takes any positive whole number of minutes, hours or days (`15m`, `2h`, `1d`), or a bare number of minutes. A relative bound is stored as written, so `--from -2h` keeps meaning "the last two hours" on every refresh. A pair that is not in order is refused at exit 1 when both are timestamps or both are relative to now; a pair naming `start` or mixing the two is not judged. The page's own range bar overrides it per browser. |
| `range --auto` | Reset the axis to the automatic span. It takes no `--from`, `--to` or `--tick`; any of them beside it is refused at exit 1. |
| `render` | Regenerate `progress.html` from the progress file and the tickets, changing nothing else — for a page lost to a crash, or after a ticket body was edited by hand. An unreadable tracker is exit 2. |
| `open` | Open `progress.html` in the default browser (`open` on macOS, `xdg-open` elsewhere), rendering it first when it is missing; a page that cannot be rendered is exit 2, as for `render`. |
| `clear [--all] [--yes]` | Throw away every task row and the log, restart the clock and reset the stored axis to automatic, leaving one `Tracker cleared` log line, and keep the tickets: each surviving ticket is given a fresh row seeded from its own frontmatter, with a new id, except a low ticket with no row. Row ids are not reused. `--all` deletes the tickets too and restarts their ids at 001. `--yes` skips the confirmation, and is required when standard input is not a terminal. |

## Exit codes

| code | meaning | examples |
|---|---|---|
| **0** | done, or there was nothing to do | also a store write whose page could not be rebuilt (reported on standard error, with an error banner on the page when only its script failed; `render` rebuilds it), a release whose cleanup git declined, and every `hook subagent-stop` |
| **1** | a refusal the caller can act on | no tracker here, no such task or ticket, a missing `--reason`, a move the matrix refuses, a claim with no free slot or on a held-back low ticket, a release refused (`main-moved` among them), an unknown command |
| **2** | a state the tool will not repair on its own | an unreadable or malformed progress file, a malformed ticket file a command names, a lock it could not take, a release reason `git-failed` or `tracker-failed` |

## The Handoff and the token column

A ticket's body ends with a **Handoff** section, written by the agent that implemented the ticket as
the last thing it does, in under 15 lines: the files it touched, contracts it discovered that the
ticket did not state, what is verified and how, what is not, and the next concrete step. The review
pass and whoever picks the work up next read those lines instead of re-deriving them from the diff.

Every row carries a token count, shown beside the bar. With the `SubagentStop` hook installed it
fills itself in: a brief names its row on a line of its own, `agent-progress row: 4` (`4, 7` for a
bundle), and when the agent stops the hook adds its `input` figure — every token it processed — to
that row. The orchestrator then passes no `--tokens`, which would replace the sum. Without the hook,
`--tokens` stores the harness's own `subagent_tokens`, which reports roughly the agent's end context
rather than everything it read to reach it. A row without a figure (`null`) is not a row that cost
nothing; it is a row nobody measured. `skill/Reference.md` covers the three brief markers in full.

## The dashboard

`.agent-progress/progress.html` is one file with no CDN and no server, regenerated by every
mutating command and reloading itself every 5 minutes. Open it with `agent-progress open`.

- **Progress tab**: the Gantt chart, one row per task, newest on top, each with its number, name,
  ticket badge, token count, status pill and bar; a now-marker; and the log underneath, newest first.
  Review rows are drawn indented directly above the ticket they review, latest round first.
- **Tickets tab**: a summary table, then one card per ticket with its body rendered as markdown
  (`done`, `delivered` and `abandoned` collapsed). The chosen tab and the open cards are kept in the
  browser, so the refresh lands where you were.
- **Summary** above the chart: `Work completed: <settled> / <total>`, a row counting once it is
  delivered or abandoned, then how many rows are awaiting merge and how many are in review, and, when
  any row reports tokens, their sum.
- **Double-click any row**, in the chart or the ticket table, for the whole story of that task: its
  facts, every phase it went through with how long it sat in each, the ticket with its body, and the
  log lines that name either. A row filed before phases were recorded says so and shows what can be
  derived from its stamps instead. Esc, the backdrop or × closes it.
- **Range bar**: the presets Auto · 1h · 4h · 12h · 24h · 7d · All, free-text bounds that accept
  `start`, `now` and `-2h` as well as timestamps, and a tick-step selector. A viewer's choice is kept
  in their browser; Auto hands control back to the default stored by `agent-progress range`. Bars
  outside the window are clipped and marked, never dropped.
- **Done work older than a day is hidden**: delivered and abandoned tasks and tickets leave the chart
  and the ticket list a day after they closed. Work awaiting merge — a reviewed task, a done ticket —
  stays. **Show all** brings them back; the choice is kept in the browser.
- **A ✓ beside a delivered pill** when that task was reviewed before it was delivered; hover it for
  the review time. A delivered task without it went straight from finished to delivered.
- **An error banner** when a command wrote the store but could not rebuild the page script.

**The pill names the state the row is actually in, and `done` means merged.** The stored status and
the word on the pill are different vocabularies, because a `finished` row is waiting for somebody:

| stored status | pill | what it means |
|---|---|---|
| `pending` | `unstarted` | filed, nobody on it |
| `running` | `wip` | an agent is working |
| `paused` | `paused` | the work is waiting on something |
| `finished` | `awaiting review` | handed in, no reviewer yet |
| `finished`, ticket `in-review` | `reviewing` | a reviewer has it |
| `re-review` | `reviewing 2`, `reviewing 3`, … | a further review pass, numbered from the second |
| `reviewed` | `awaiting merge` | the review passed, the branch is not in yet |
| `delivered` | `done` | merged; nothing more has to happen to this row |
| `abandoned` | `abandoned` | called off, kept for the record |

A row with nothing to merge — a review pass, a chore — still reaches `done`, through
`agent-progress task deliver <id>`. A dispatched reviewer's bar is closed by `release`; the
orchestrator closes every row left open, and a chart whose rows stop at `awaiting review` is a chart
nobody closed.

## Files on disk

```
.agent-progress/
  progress.json          the rows, the log, the view, the limits
  progress.html          the generated dashboard
  agent-brief.md         the brief, rewritten by init and update
  tickets/003-<slug>.md  one file per ticket
  .lock/                 the lock's generation records
```

Every file a reader may hold open is written atomically: a temporary file beside the target, fsync,
rename. Timestamps carry the offset of the machine that wrote them and are displayed as written,
never re-parsed into a viewer's zone.

### `.agent-progress/progress.json`

```jsonc
{
  "version": 1,                                  // guards a future migration
  "trackerId": "…",                              // namespaces the page's browser storage per tracker
  "project": "Example Agency",
  "startedAt": "2026-09-18T20:55:10+02:00",
  "view": { "kind": "auto" },                    // or absolute/relative bounds with an optional tick
  "nextTaskId": 18,                              // never wound back, so an id is never reused
  "concurrencyLimit": 2,                         // optional: absent reads 2, above 10 reads 10
  "dispatcherState": "running",                  // optional: running|finished|stopped, absent reads stopped
  "dispatcherRunId": "wf_example-run-1",         // optional: the Workflow run to resume, only beside running
  "tasks": [
    {
      "id": 17,
      "name": "Rewrite the importer",
      "status": "running",                       // pending|running|paused|finished|re-review|reviewed|delivered|abandoned
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
        { "status": "running",
          "at": "2026-09-18T21:30:54+02:00" }
      ]
    },
    {
      "id": 18,
      "name": "Review 1 #003 — Rewrite the importer",
      "status": "running",
      "start": "2026-09-18T22:00:00+02:00",
      "end": null,
      "owner": "opus",
      "note": "",
      "ticket": null,
      "tokens": null,
      "reviewOf": "003"                          // optional: the ticket this row reviews
    }
  ],
  "log": [{ "at": "2026-09-18T21:30:54+02:00", "text": "Wave 1 landed." }]
}
```

A present `concurrencyLimit` that is not a whole number of at least 1, a `dispatcherState` outside
the three, or an empty `dispatcherRunId` makes the file unreadable (exit 2). A task is linked to at
most one ticket. Task ids are never reused, not even after `task remove` or `clear`.

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
dependsOn: "001, 002"
task: 17
owner: Alex Example
---
# 003 — Double-click a role to edit it

## Report
…
```

| key | written | value |
|---|---|---|
| `id`, `title`, `type`, `status`, `filed`, `updated` | always; required | `type`: bug, change, feature. `status`: open, in-progress, in-review, done, delivered, abandoned. `updated` is stamped on every move. |
| `priority`, `model`, `effort` | only once named | the vocabularies above; absent reads as normal, and as opus and medium, so an older ticket is never rewritten to gain them |
| `hold` | only while held | the hold's reason, empty without one; any value but `null`, a bare `hold:` included, is held. Set and remove it with `ticket hold` and `unhold`. |
| `started`, `finished`, `delivered`, `abandonedAt` | always | a timestamp or `null`; an absent one reads as `null` |
| `group`, `branch`, `commit`, `reason` | when given | text; `reason` is dropped by `reopen` |
| `dependsOn` | when non-empty | ticket ids, written `"001, 002"`, read from any mix of commas and spaces with or without `#` or padding. Set it with `ticket depends`, which refuses a missing id or a circle. |
| `task` | always | the row's id as an unquoted integer, or `null` for a low ticket never started |

**The frontmatter is a deliberately small YAML subset.** One `key: value` per line, split at the
first `': '`, so `title: Fix: the thing` keeps its second colon; `key:` alone is an empty value.
A value is `null`, a double-quoted JSON string, or an unquoted scalar kept as text; only `task` reads
an unquoted integer as a number, so any other value keeps its leading zeros. A `#` comment starts in
column 0 with one hash; a line opening on two to six `#` followed by whitespace or nothing, indented
or not, is a markdown heading and makes the file malformed, as does any other indented line, a list
item or a bare word. There are no nested maps,
lists or block scalars. The closing fence is the *first later* line equal to `---`, so a body may
contain horizontal rules. A leading byte order mark is dropped and CRLF is kept.

**Unknown keys, comments and blank lines are kept and written back**, so a field you add by hand —
`owner: Alex Example` above — survives every transition. The CLI's own keys are rewritten at the top
in the order above and everything else follows, keeping its order among itself, so a hand-written
line moves below the CLI's block once and never again.

The body is preserved byte for byte from the template (`templates/TicketBody.md`: Report, Wanted,
Acceptance, Handoff), `--body` or `--body-file`; an empty body falls back to the template. A
malformed ticket file is listed as ignored rather than failing `status` or `render`. A new ticket id is
one past the highest of every file name, every parsed id and every ticket a row names; gaps are
tolerated, never filled.

## Ticket moves and their rows

The **from** column is the matrix the named verbs enforce; `ticket status <id> <status>` skips it.
**its row** is the status stored; **pill** is what that row then reads on the chart.

| command | from | ticket status | its row | pill | stamps written | log line |
|---|---|---|---|---|---|---|
| `ticket add` | — | open | created `pending`; none when low | `unstarted` | `filed` | `Ticket #003 filed: <title>` |
| `ticket start` | open, in-review | in-progress | `running`; created for a low ticket | `wip` | `started` if null; the row's end cleared | `Ticket #003 started` |
| `ticket claim` | open, in-review | in-progress | `running`, with owner, note and agent key | `wip` | as `start` | `Ticket #003 started` |
| `ticket review` | in-progress | in-review | `finished` | `reviewing` | `finished` if null | `Ticket #003 in review` |
| `ticket review --start-review` | in-progress | in-review | `finished`, plus a running review row | `reviewing` | as `review` | as `review`, and `Review row #18 started: <name>` |
| `ticket rereview` | in-review | in-review, unchanged | `re-review`, one round up from 2 | `reviewing 2` | `updated` only | `Ticket #003 in review, round 2` |
| `ticket done` | in-progress, in-review | done | `reviewed` | `awaiting merge` | `finished` if null | `Ticket #003 done` |
| `ticket deliver` | done | delivered | `delivered` | `done` | `delivered` if null | `Ticket #003 delivered` |
| `release` | in-progress, in-review | done, then delivered | `delivered`; running review rows delivered | `done` | `finished` and `delivered` if null; `branch`, `commit` | the done and delivered lines, and one per review row closed |
| `ticket abandon` | anything but delivered, abandoned | abandoned | `abandoned`; none created for a low ticket without one | `abandoned` | `abandonedAt`, always; the row's end if it had started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | anything but open | open | `pending` | `unstarted` | all four cleared; `reason` dropped | `Ticket #003 reopened` |
| `ticket priority … low` | open | open | removed | — | — | one line |
| `ticket priority` from low | any | unchanged | created when it has none: `pending` while open, else seeded from its stamps | per status | — | one line |

A closing stamp is written only while it is still null, while `abandonedAt` is written every time:
re-entering a status is a correction, abandoning twice is deciding twice. Every move to a status other
than in-review — `start`, `done`, `deliver`, `abandon`, `reopen`, `status` — finishes and delivers the
ticket's running review bar, with one log line each; a plain `ticket rereview` leaves it running.

Filing the row is the first entry in its `history`, and each move appends another, so the panel a
double-click opens can say when the row reached each state and how long it sat there — the wait
between `unstarted` and `wip` being the queue time. `task update --status` is not appended: it
corrects a row rather than moving it.

Moving a ticket to the status it already has is refused and logs nothing; `ticket rereview` is the one
exception, since every review pass is still review and the round is counted on the row. A ticket
taken straight to in-review, done or delivered with `ticket status`, having never started, gets a row
whose start is stamped along with its end — an end without a start would draw from the origin of the chart. There
is no `paused` ticket status: `task pause <id>` records a waiting row and the ticket stays where it
was.

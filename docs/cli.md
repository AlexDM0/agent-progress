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
| `--json` | Accepted by every command but `init`, `update`, `open`, `hook` and `help`, and prints one JSON document on standard output in place of the human output. A reading command prints the document its row describes. A command that writes prints what it wrote: the row for a `task` verb, the ticket for a `ticket` verb or setting (a list for a claim of several), the epic for `epic add` and `epic edit` (`{ key, removed: true, filePath }` for `epic remove`), the log entry for `log`, the stored axis for `range`, the new state for `concurrency <n>` and `oversee pause\|resume`, and the counts for `clear`. Nothing follows the document on standard output — no Next line or resume line — while a warning still goes to standard error. |
| `AGENT_PROGRESS_ROOT` | Names the repository to use instead of walking up from the current directory, for a command run from somewhere else entirely. It does not create a tracker: a value naming a directory that has none is refused with a message saying the variable is set. `init` does not choose its directory by it, and refuses at exit 1 when it names a directory other than the one `init` targets. Every variable the CLI reads is named from the build's environment prefix: the `agent-progress-v2` build reads `AGENT_PROGRESS_V2_ROOT` and `AGENT_PROGRESS_V2_REQUIRE_EVERY_TOOL`, and never the released program's. |
| product names | Every name the build goes by is `PRODUCT_NAMES` in `src/shared/constants/ProductNames.ts`. The work-in-progress build is `agent-progress-v2`, linked beside the released `agent-progress`: its data folder is `.agent-progress-v2/`, its monitor folder `~/.agent-progress-v2-monitor/`, its skills `agent-po-v2` and `agent-progress-orchestrate-v2`, its managed block `agent-progress-v2:managed`, its hooks `agent-progress-v2 hook …`, its worker agent `agent-progress-v2-worker` and its page keys `agent-progress-v2:…`. The paths below name the released program's. |

**One tracker per repository.** The tracker lives in `.agent-progress/` at the repository root, found
with `git rev-parse --git-common-dir`, so every worktree of a repository shares one tracker and one
chart.

**Locking.** Every mutating command (`init`, `task`, `ticket`, `epic`, `log`, `concurrency`,
`gate`, `range`, `clear`) takes the tracker's
lock, reads, changes, writes `progress.json` atomically, writes any ticket file after it, then `log.jsonl` when it
logged something — all before releasing the lock, so a ticket file is never ahead of the progress file and a log
line never describes a change that was not stored. Nothing renders: the Overseer serves the Bridge from the store.
`status`, `ticket list`, `ticket show`, `epic list`, `epic show`,
`concurrency` without an argument, `gate list`, `usage` and `review-stats` take none: every file
they read is written atomically. `update`, and `init` on an existing tracker, never touch the tracker's
own files but the `progress.html` stub, and take no lock.

**Help and options.** `agent-progress help` prints the whole reference. `--help` works after a
command word as well as on its own, and `-h` on its own or straight after the command word; a `-h`
further on is refused at exit 1, since it may be text (put text behind a bare `--`). An option taking
a value, given twice, is refused at exit 1. An unknown command is refused at exit 1 with the help on
standard error, so a typo never exits 0 or prints the help into a parsed pipe.

**The Next line.** `status`, `ticket add`, every ticket or task move (`task add --start` included),
`ticket depends`, `priority`, `agent`, `hold` and `unhold` end their human output with
one line read from the board after the change:

```
Next: 1 of 2 slots free; ready: #003, #005
Next: no slot free (2 agents in flight); ready: #003
Next: 2 of 2 slots free; nothing ready
```

At most five ready ids are named, then `and N more`; a held ready ticket is left out and named apart
(`; held: #002`). While the Overseer is paused, as a board that never set its Overseer state is, the
line ends with advice addressed to the orchestrator rather than to whichever session ran the command:
`; overseer paused: wait for the user's go`. `--json` output never carries the line.

## Adopting a repository

```sh
cd <the repository to track>
agent-progress init
```

`init` creates the tracker and installs everything a session needs to use it. Of the seven things
below, the first three are the tracker itself, its ignore entries and the files beside it; the next
two are what Claude Code loads — the SessionStart hook under `.claude/`, the skills — the hook with
its opt-out; the sixth is what install version 16 wrote that 17 removes once; the last records which
install version all of them are. `init` never writes `CLAUDE.md`: a repository's `CLAUDE.md` holds its
own conventions only.

| # | what | path | written by | opt-out |
|---|---|---|---|---|
| 1 | The tracker: `progress.json`, `log.jsonl`, a `tickets/` folder, the `progress.html` stub, and the `.lock` directory | `.agent-progress/` | `init` only; the stub also `update` and `oversee` | — |
| 2 | `.gitignore` entries for the tracker (`init` only) and for the worktrees folder | `.gitignore` | `init`, `update` | — |
| 3 | The session instructions, from `resources/templates/SessionInstructions.md`, the reference, from `Reference.md`, and the seven instruction defaults, from `Constitution.md`, `OnboarderBrief.md` and `AssistantBrief.md` there and `BuildPrompt.md`, `ReviewPrompt.md`, `MergerBrief.md` and `ProductOwnerPrompt.md` under `resources/prompts/` | `.agent-progress/session-instructions.md`, `reference.md`, `briefs/defaults/<constitution\|builder\|reviewer\|merger\|productOwner\|onboarder\|assistant>.md` | `init`, `update` | — |
| 4 | The `SessionStart` hook running `agent-progress hook session-start`, kept current in `.claude/settings.json` when that file already holds it | `.claude/settings.local.json` | `init`, `update` | `--no-hooks` |
| 5 | The two skills, copied from this checkout's `skills/agent-po/` and `skills/agent-progress-orchestrate/`, each with its `.gitignore` entry | `.claude/skills/agent-po/`, `.claude/skills/agent-progress-orchestrate/` | `init`, `update` | — |
| 6 | Removed once: the managed `CLAUDE.md` block, the `SubagentStop`, `PreToolUse` and `PostToolUse` hook entries, the worker agent definition, the dispatcher script and the three briefs install version 16 wrote, and the `assistant-brief.md` versions before 19 wrote | `CLAUDE.md`, `.claude/`, `.agent-progress/` | `init`, `update` | `--no-hooks` keeps the hook entries |
| 7 | The install version | `.agent-progress/version.json` | `init`, `update` | — |

1. **The tracker.** Its root is the main checkout, found from any worktree.
2. **The `.gitignore` entries**, only where the repository does not already ignore the path:
   `git check-ignore` decides, so a repository covered by a broader pattern, a parent `.gitignore` or
   `.git/info/exclude` gets no diff at all. `init` adds the worktrees folder's before any worktree can
   exist, and `update` adds it to a repository adopted earlier.
3. **The files beside the tracker.** `session-instructions.md` is what the SessionStart hook prints to
   every session User opens: how this repository tracks its work, which skill to load for what, and
   where the reference is. A fresh `init` writes it first, and its presence marks the files installed.
   `reference.md` is the ticket file's format, the ticket moves and the exit codes copied from this
   file, which a session reads on demand. `briefs/defaults/` holds the instruction file each role reads
   when the pipeline names none (see [Files on disk](#files-on-disk)), which the Overseer fills with
   the job's values at each launch. They are guidance shipped with the tool rather than files a project
   edits, so every `init` and `update` rewrites them all; a project adds its own tracked files through
   the pipeline instead. The line reports the session instructions, and `updated` when any of them
   changed. Install version 19 removes the `assistant-brief.md` earlier versions wrote.
4. **The hook**, under an empty matcher. It goes into `.claude/settings.local.json` — the per-user file
   Claude Code applies over the shared one and keeps out of git, and which a job's
   `--setting-sources project` never loads — so it lands in nothing colleagues share and reaches no
   worker. A repository that already keeps it in the shared `.claude/settings.json` has it kept current
   there instead. Either way it merges into whatever the file holds, is never added twice, refuses a
   document it cannot parse rather than replacing it, and writes nothing when the entry already says
   what it should.
5. **The skills**, `agent-po` and `agent-progress-orchestrate` ([The two skills](#the-two-skills)),
   copied file for file from this checkout's `skills/` into `.claude/skills/<name>/`, where Claude Code
   reads a project's skills. Every `init` and `update` rewrites each file the skill ships, so a hand
   edit is undone; a file somebody else put in the folder is never touched, so one a newer skill no
   longer ships stays behind until removed by hand. Each folder gets its own `.gitignore` entry unless
   git already ignores it, since it is a copy the next `update` replaces. A skill folder an earlier
   version installed and this one retired, `.claude/skills/agent-progress/`, loses the files that version
   shipped there (`SKILL.md`, `Reference.md`) and its exact `.gitignore` entry; a file somebody else put
   in it stays, and so does the folder then. The line names each folder, `updated` or `unchanged`, and
   adds `.gitignore entry added` when it added one, and `retired` for a retired folder it cleared.
6. **What version 16 installed.** The managed block between `<!-- agent-progress:managed:start -->` and
   `<!-- agent-progress:managed:end -->` goes with the blank lines that separated it, everything else in
   `CLAUDE.md` byte for byte, and a file the block was all of is removed; the `CLAUDE.md` line says
   `removed; commit CLAUDE.md`, since the Overseer launches nothing onto a target whose committed
   `CLAUDE.md` still holds the markers (the `claude-md-block-committed` notice). A start marker with no
   end marker is refused and the file left alone. The three hook entries go from both settings files,
   unless `--no-hooks`, and `.claude/agents/agent-progress-worker.md`, the dispatcher script and
   `agent-brief.md`, `builder-brief.md` and `review-brief.md` from where version 16 wrote them; the
   `retired` line names what went, or says `nothing to remove`.
7. **The install version** ([its file](#agent-progressversionjson)): the one version of everything
   above that the tool installs, which changes only when what the CLI and those files expect of each other changes.
   `init` and `update` compute every installed file first and write this one last, after every other
   write, so a run that fails part way leaves the version it found and a second run completes it. A
   refused `CLAUDE.md` block or settings file is reported and does not hold it back.

Claude Code is the only agent host. A `version.json` naming the `agentHost` an install before version
11 recorded for a host agent-progress no longer installs for is refused by `init` and `update` at exit 1,
writing nothing and deleting nothing, naming the files that install left: remove them and the key by
hand, then run the command again.

`update`, and `init` at a root that already has a tracker, report items 3–6 and the worktrees entry on a
line each: `updated` or `unchanged`, judged from the file's bytes before and after (the hook from its
entry, and as `installed` when it was added), or `left alone` under the item's opt-out. The brief's `updated`
adds "re-read it before your next brief", so a session that read it at its start learns its copy is
stale. A first `init` prints the brief's path instead.

**Re-running.** To pick up newer instructions, hooks or skills, run
`agent-progress update`, never `init` again. `init` at a root that already has a tracker does exactly
what `update` does and says so; `init` below an existing tracker, inside a bare repository, with a
`--root` that is not an existing directory, or with `AGENT_PROGRESS_ROOT` naming a directory other
than the one it would create the tracker in is refused. `init` never replaces an existing
`progress.json`: it creates the store with an exclusive create, under the lock.

Claude Code adds `**/.claude/settings.local.json` to your global git excludes the first time it
writes that file itself. If it has not yet, and the file this tool creates shows up in `git status`,
ignore it the way you ignore any personal file; this tool writes no `.gitignore` entry for it.

### Install version

`.agent-progress/version.json` records which install version the installed files are (item 7 above),
written last by `init` and `update`. Every command except `init`, `update`, `help`, `status`, `version`,
`oversee status` and `oversee stop` checks it against the running agent-progress before it does anything:

- the version it records equals this agent-progress's: the command runs;
- it records a different version, older or newer: refused;
- it is missing while `.agent-progress/session-instructions.md`, or a version 16 board's
  `agent-brief.md`, is there — the files were installed by an agent-progress from before versioning,
  since every `init` and `update` writes the marker, or a fresh `init`, which writes it first, was cut
  short: refused;
- it is missing and neither marker is there — nothing is installed that could disagree: the command
  runs;
- it cannot be read or does not hold a whole number of at least 1: refused;
- a directory sits at its path: refused, saying to remove that directory and then run
  `agent-progress update`, since `update` could not replace it.

A refusal is one paragraph on standard error at exit 1, naming the tracked root and saying to run
`agent-progress update` there; nothing is locked or written first. For files a newer agent-progress
installed it says to update agent-progress itself first. Where no tracker governs the directory, the
command's own no-tracker refusal is unchanged.

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
repository's git-ignored `.claude/skills/` (item 5 of [Adopting a repository](#adopting-a-repository)),
split by audience: filing a ticket in any session, and working alongside the Overseer in one. No job the
Overseer launches loads either, except the product owner, whose first line runs `agent-po`: every role reads
the instruction files its pipeline names, by default those under `.agent-progress/briefs/defaults/`.
Neither skill lists commands: `agent-progress help` is the reference, and both name it and
`.agent-progress/reference.md`.

| skill | folder | loads | holds |
|---|---|---|---|
| `agent-po` | `skills/agent-po/` | by itself in any session asked to file, report or track a ticket, bug or research question, or with `/agent-po`; by the wrapper for its intake; and as the first line of an Overseer's product-owner job | PO intake: fact-finding through subagents with capped reports in a resumable filing draft, filing without questions and writing each assumption into Wanted (grilling only when the user asks), the split by mechanism, merging drafts or ordering them against unclaimed tickets, a group's real dependencies, the epic check, the body with its numbered Acceptance and `## Brief`, which `ticket ready` requires, and the mechanics. Every ticket is filed as a draft. In the user's own session it ends with one question, "Ready these to build?", and runs `ticket ready <ids>` on the yes; under the Overseer it closes intake with `intake close` and never readies. |
| `agent-progress-orchestrate` | `skills/agent-progress-orchestrate/` | only with `/agent-progress-orchestrate` or when asked to run the board | the interactive wrapper around a running Overseer, the Overseer: it reads `oversee status --json` and `status --json`, starts the Overseer on the user's go with `oversee --detach` and gives its URL, turns the user's intent into commands (ready, holds, priorities, pause and resume, `decide`, job messages, wind-downs and stops, `intake`), loads `agent-po` for intake, and may wait on `await` to put a new decision to the user. It never drives the lifecycle and never handles an incident: those are the Overseer's and its Assistant's. |

## Commands

Options in `[brackets]` are optional; `a|b` is a choice of one.

### Setup

| command | what it does |
|---|---|
| `init [--project <name>] [--root <path>] [--no-hooks]` | Create the tracker here and write the seven items in [Adopting a repository](#adopting-a-repository). `--project` names the project shown on the page (default: the root directory's name); `--root` tracks that directory instead of the discovered repository root. Refused, naming each file and deleting none, while `version.json` names a retired agent host. Refused when an ancestor already holds a tracker, when `--root` is not an existing directory, inside a bare repository, and when `AGENT_PROGRESS_ROOT` is set to a directory other than the one it would create the tracker in (the message names both, and nothing is written). A build whose program is not `agent-progress` refuses `older-program-present` at exit 1, like `update`, while the root holds the released program's `.agent-progress/`, writing nothing. A re-run refreshes only what `update` refreshes and leaves the tracker's own files alone; like `update`, it is refused at exit 1, writing nothing, over files a newer agent-progress installed ([Install version](#install-version)). |
| `update [--no-hooks]` | Refresh what the tool wrote into a repository it already tracks, refusing like `init` while `version.json` names a retired agent host: the files beside the tracker, the SessionStart hook, the two skills and the worktrees folder's `.gitignore` entry, undoing a hand edit to any of them, and removing once what install version 16 wrote (item 6); then `version.json`. Last, when the board's Overseer is live and its Baton names a code or install version other than the one on disk, it sends `overseer-restart` and prints the checked Baton pass's outcome (see `oversee restart`), exiting 1 `baton-pass-failed` with the old Overseer still driving and what it installed standing; with no live Overseer it does nothing more. The tracker's own files are left alone, and the first line says so. `setup.sh --login-overseer <repository> [--label <label>]` writes `~/Library/LaunchAgents/<label>.plist`, the label defaulting to `LAUNCH_AGENT_LABEL`, which runs `oversee --detach` in that repository at login with absolute paths to `bun` and the program; a label already naming another repository is refused, and nothing else installs it. A tracker an earlier agent-progress wrote in a format this one no longer reads — a version 1 `progress.json` holding its own log, or a status word the rename retired — is refused at exit 2 by every command that reads it, the reason ending in the advice to run `agent-progress update` with a release that still reads it, which rewrites it in the current format. It creates no tracker, so it takes no `--project` and no `--root`. With no tracker it is refused at exit 1, naming `agent-progress init`; and over files a newer agent-progress installed at exit 1, writing nothing ([Install version](#install-version)). Every command but `init`, `update`, `help` and `status` is refused until it has run over files of an older install version, and `hook session-start` prints its instructions regardless ([Install version](#install-version)). |
| `help` | The command reference. |

### Reading the board

| command | what it does |
|---|---|
| `status [--json] [--full] [--tickets-only]` | The project, the counts, the rows that are not delivered or abandoned, and the last five log entries newest first, then the Next line. `--json` prints the same working view for an agent — the unsettled rows and tickets, the last 10 log entries, and an `omitted` object counting what was left out. `--full` lists everything; with `--json` it prints the whole progress file plus every ticket's frontmatter. The `version` both `--json` documents carry is the document's own shape version, `1`, with the worded log directly after `tasks`, whatever version the stored file is at. Both `--json` documents carry `concurrency` — `limit`, `agentsInFlight`, `freeSlots`, `readyTicketIds`, `overseerState`, `heldTicketIds`, then `inProgressTicketIds` and `inProgressReviewOfIds` — and beside it `readyTickets`, then `reviewWaitingTickets`, `pausedBuilds` and `ticketRows`, and end with `tokensByOwner`. Both carry `epics` after `tickets`, every epic with its roll-up (see Epics), and each ticket carries `epics`, its list in order, empty when it has none; then `drafts`, every open draft (see Drafts). `--tickets-only`, with or without `--json` and `--full`, leaves out the free-standing task rows — every row that is no ticket's own row (`ticket` null) and no review bar (no `reviewOf`) — while the tickets, the log and the counts stay; the working view's `omitted` then adds `freeStandingTasks`. The human output breaks the token total down per owner: owners are grouped case-insensitively on the trimmed text and shown under the group's most common spelling (the first met on a tie), most tokens first, with the reported rows that carry no owner on a `no owner` line of their own. `tokensByOwner` carries the same over every row, whatever the flags: `{ owners: [{ owner, tokens, rows }], withoutOwner: { tokens, rows }, withoutTokens: { rows } }`, whose owner and `withoutOwner` tokens add up to the reported total. Both `--json` documents then carry `ticketCountByStatus`, every ticket on the board counted per status (settled ones included, every status present, zero or not), so a reader totalling the board needs no `--full`, then `jobs`, every unsettled job as `progress.json` stores it, empty when there is none, and end with `decisions` and `incidents`, every open one as `progress.json` stores it, each empty when none is open. |
| `ticket list [--status <s>] [--priority <p>] [--json]` | The tickets with their status, priority, type and row id, the model and effort after the title where the ticket names them, and "waiting on #003" where a dependency is unsettled. `--status` and `--priority` narrow the listing. `--json` carries no bodies. |
| `ticket show <id> [--json]` | One ticket: its frontmatter, its priority, its model and effort where it names them, its body, and always its file path — which is what an agent needs in order to edit that body. Once the ticket was claimed or started it says whether the body changed since: a hash of the body now against the `claimedBodyHash` the claim recorded, never a clock; under `--json`, and in `status --json` and `ticket list --json`, that is `bodyChangedSinceClaim`, absent on a ticket never claimed. |

**Ready tickets.** A ticket is ready when it is pending and every ticket it depends on is reviewed or
delivered; priority never keeps a ticket from being ready, it only orders them. `readyTicketIds`
orders them high priority first, then normal, then low; within a priority by readiness, the log
position of the ticket's latest `ticket-readied` or `ticket-reopened` line (a ticket with neither,
readied before readiness was logged or behind a `Tracker cleared` line, comes first); then lowest id
first. `readyTickets` lists the same tickets in the same order as `{ id, priority, model, effort }` with the
defaults resolved, plus `group` on a ticket that has one (absent otherwise, as in `tickets`) and
`held: true` on a held one, so a reader derives none of them itself.

**A group awaiting its release.** While a group has a release ticket (see `ticket release-of`) that
is neither delivered nor abandoned, every ticket of that group is the group run's and is left out of
the lists a whole-board run takes work from: `readyTicketIds`, `readyTickets`,
`reviewWaitingTickets` and `pausedBuilds`. Once the release ticket is delivered or abandoned, the
group has no release ticket, so its remaining open tickets list as any other. A group with no
release ticket lists as ungrouped tickets do.

**What the Overseer reads.** Every list below is in file order, each id once, with a ticket's model,
effort and priority resolved to their defaults.

- `concurrency.inProgressTicketIds`: the `ticket` of every `in-progress` row that has one.
- `concurrency.inProgressReviewOfIds`: the `reviewOf` of every `in-progress` row that stores one, on
  any row, a ticket's own row included, as a claim and the moves out of review read it.
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
| `ticket priority <id> low\|normal\|high [--at <when>]` | Change a ticket's priority, with one log line. Lowering to low is refused unless the ticket is a draft or pending, and keeps its row: priority only orders the ready tickets. A draft has none at any priority; raising a low ticket that has no row gives it one at once. A low ticket with no row gets its row when a claim starts it, and keeps it; abandoning a low ticket that has none creates none. |
| `ticket size <id> XS\|S\|M\|L\|XL\|XXL [--at <when>]` | Change a ticket's size, in any status, with one `ticket-size-changed` log line. A size outside the list, in capitals only, and an unchanged size are refused at exit 1 with nothing written. |
| `ticket network <id> <domain>... \| --clear [--at <when>] [--json]` | Set the public domains the ticket's agents may reach, comma- or space-separated, stored lower case and once each as the frontmatter key `network`; `--clear` removes the key. One `ticket-network-set` log line, `Ticket #003 network: api.example.com` or `Ticket #003 needs no network`; `updated` is not stamped. Refused at exit 1 with nothing written: a ticket that is not a draft or pending (`network-of-a-ticket-past-pending`), any domain that is not public — a loopback name (`localhost`, a name under `.localhost`), a `.local` name, an IPv4 literal in a loopback, private, link-local or shared range, an IPv6 literal outside global unicast, a single label or malformed text (`network-domain-not-public`, naming each) — the same list or a clear of a ticket with none (`network-unchanged`), and domains beside `--clear`. |
| `ticket hold <id> [--reason <text>] [--at <when>]` | Pause a ticket between build and review, or between review rounds, without pausing the Overseer. While the frontmatter's `hold` key is set (to the reason, empty without one) the run starts no builder or reviewer for it and parks a row it left in progress for it, a claim refuses it, and `status --json` lists it in `concurrency.heldTicketIds` and marks its `readyTickets` entry `held: true`. An agent already running is never interrupted: a hold set after a builder's final status read is too late for the reviewer it starts. One log line; refused at exit 1 on a delivered or abandoned ticket and on one already held. |
| `ticket unhold <id> [--at <when>]` | Lift the hold, with one log line; the step it held starts at the Overseer's next pass. On a ticket in progress whose row is paused, a last line says to resume it with `task start <row>`, since the Overseer never takes a paused row over. Refused at exit 1 on a delivered or abandoned ticket and on one not held. |
| `ticket release-of <id> [--clear] [--at <when>] [--json]` | Mark a ticket as its group's release ticket, the one whose release takes the group's work to the main line. Only an open marked ticket — neither delivered nor abandoned — is the group's release ticket: a settled one's mark is history, so the group has none, and no release bundle, until another is marked. Its **release bundle** is the ticket plus every ticket of the same group it depends on, transitively, following no dependency outside the group; the group's other tickets are not in it. Stored as the frontmatter's `releasesGroup: true` on that ticket alone; `--clear` removes the key, leaving the file as though it had never been set. One log line either way. Refused at exit 1, writing nothing, on a ticket with no `group`, when another open ticket of the group — or this one — is already its release ticket, on a delivered or abandoned ticket, and with `--clear` on a ticket not marked. A delivered or abandoned ticket keeps its mark, and a move that takes it back to an open status — `ticket reopen`, or `ticket status`, which skips the move matrix but not this rule — is refused at exit 1, writing nothing, while another open ticket of its group carries the mark; with none, the move is made and the ticket is the group's release ticket again. `--json` prints the ticket. |
| `ticket epic <id> [<key>...] \| --add <keys> \| --remove <keys> [--at <when>] [--json]` | Set the epics a ticket belongs to, in order: the first is its primary epic. Bare keys replace its list and no keys clears it; `--add` appends (a key already there keeps its place), `--remove` takes keys out; either beside bare keys, or the two together, is refused as ambiguous at exit 1. A key naming no epic is refused at exit 1 with nothing written. One log line, `Ticket #003 belongs to epics checkout-redesign, search`; `updated` is not stamped. `--json` prints the ticket with `added` and `dropped`. Epics never affect dispatch, claiming, concurrency or release: that is `group`. |
| `ticket introduced-by <id> [<cause id>] [--at <when>] [--json]` | Name the delivered ticket whose change introduced a bug, stored as its `introducedBy`; no cause, or an empty one, removes the key. Refused at exit 1 with nothing written when the ticket is not a bug, or the cause does not exist, is the ticket itself or is not delivered. One log line, `Ticket #007 introduced by #005`; `updated` is not stamped, and every other line of the file is kept. `--json` prints the ticket. |
| `ticket depends <id> [<id>...] \| --add <ids> \| --remove <ids> [--json]` | Set the tickets this one waits on. Bare ids replace its list, and no ids clears it; the human line names what the replace dropped, `Ticket #459 waits on #473 (dropped #463)`, and each dropped ticket not yet reviewed or delivered gets a line of its own, `#463 is still open: #459 may now start before it`. `--add 3,4` appends to the list, keeping an id already there; `--remove 3,4` takes ids out. Either beside bare ids, or the two together, is refused as ambiguous at exit 1. `--json` prints the ticket with `added` and `dropped`, the ids the change put in and took out. A ticket that does not exist, or a list that would make tickets wait on each other in a circle, is refused. Until every one is reviewed or delivered, the ticket's row, table entry and card read "waiting on #003", and `ticket list` says so too. An abandoned dependency does not settle it. |
| `ticket link <ticketId> <taskId> [--force]` | Point a ticket at an existing row instead of the one it filed. Refused when that row already belongs to another ticket, unless `--force`, which unlinks it there first. |
| `ticket abandon\|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]` | Move a ticket and its row together, stamping both — see [Ticket moves and their rows](#ticket-moves-and-their-rows) for which status each verb moves from; the Overseer makes every other lifecycle move. A move to the status the ticket already has is refused and logs nothing. Every move out of in-review finishes and delivers the ticket's in-progress review bar, with one log line each. A move to in-progress (`ticket status <id> in-progress`) warns on standard error, and still moves it, when the ticket is held or waiting on a dependency. `abandon` requires `--reason`; `reopen` clears the stamps and returns the row to pending. `--branch` and `--commit` record where the work landed; `--tokens` replaces the row's figure, and on a ticket with no row (a low one never started) is refused at exit 1. |
| `ticket deliver <id> --by-hand [--branch <b>] [--commit <sha>] [--at <when>] [--json]` | The one record-only lifecycle verb: records as delivered a ticket User finished and landed outside the Overseer, from any status but draft, in one hold, merging, landing and spawning nothing; it logs `ticket-delivered` with `byHand: true`. Refused at exit 1, writing nothing, while an Overseer's Baton is live (`overseer-owns-the-lifecycle`, naming its URL) and while a job of the ticket is live (`ticket-has-live-job`), both judged inside the hold. Never relayed. |
| `ticket rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]` | The next review round and the reviewer's in-progress bar (`Review <N> #<id> — <title>`, its `reviewOf` the ticket, N the `## Review` sections plus one, stored on the bar as `reviewBarRound`) in one lock hold, closing any bar of the round before: the builder's slot passes to its reviewer, and one round's to the next, without `status --json` ever showing it free. A bundle's bar carries its claim's agent key while other rows of the bundle still run, so it takes no second slot. `--owner` and `--note` name the bar, and are refused without the flag. |
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

### Concurrency and gates

The limits and states here survive a compaction of the orchestrator's context, because they are
stored in the tracker. The Overseer gates a tree by running the prepare steps, then each stored gate in list order, the
first red gate stopping the rest (none on purpose passes). A prepare step reaches the network and a failed one is a
setup failure, never a red gate. A gate runs in its `in` folder with only its own `network` and `writes`, and passes
only when it exits 0 and leaves every tracked file as it was; one that changes a tracked file is red, the diff its
output. Exit 126 or 127, or a signal, is `gate-cannot-run`. The Overseer never runs a gate's `fix`, and keeps no gate
result: caching belongs to the repository's own tooling. At most `GATE_RUNS_AT_ONCE` (2) gates run at once on the
machine, across every Overseer, each holding a slot file under `<monitor>/gate-slots/`; the rest wait for one to end.

| command | what it does |
|---|---|
| `concurrency [<n>] [--json]` | Print how many agents may be in flight at once, or store a new limit for every worktree: a whole number from 1 to 10. A higher one is refused at exit 1 with nothing written, and one an older tracker stored above 10 reads as 10. A tracker that never set one reads 2. A limit below the agents already in flight is accepted and simply leaves no free slot. A slot is an agent: the in-progress rows one claim started count once, and every other in-progress row, such as a review bar, counts on its own. `--json` prints `{ limit, agentsInFlight, freeSlots }`, after a change as well. |
| `gate list [--json]` | Print the board's gate pipeline, stored in `.agent-progress/pipeline.json` beside `progress.json`, never tracked and never inside a branch. Read-only, no lock. `--json` prints `{ pipelineIsSet, pipelineHash, prepare, gates }`, with `review`, `constitution` and `agents` when stored; with no pipeline `pipelineIsSet` is `false`, `pipelineHash` `null` and both lists empty. A malformed file is refused at exit 1 with its reason. |
| `gate prepare <name> [--json] -- <command>` | Set the prepare step `<name>`, which prepares a fresh worktree before a gate, with one log line (`Prepare step <name> set to <command>`, kind `pipeline-prepare-step-set`); a step of the same name is replaced where it stands. The steps run in order, with the network, before the gates. |
| `gate add <name> [--fix "<command>"] [--in <folder>] [--defined-by <pattern>]… [--network <domain>]… [--writes <path>]… [--overseer-only] [--json] -- <command>` | Add the gate `<name>`, run after the others, or replace a gate of the same name where it stands, with one log line (`Gate <name> set to <command>`, kind `pipeline-gate-added`). The gates run in order through the user's shell in the worktree, `--in` a folder of it, each sandboxed with its own `--network` domains and `--writes` folders. `--defined-by` names the files that define the gate, as git pathspec-style globs: `*` and `?` stay inside one folder, `**` crosses folders, a pattern without an inner `/` matches its name at any depth, one with an inner `/` is anchored at the repository root, and a trailing `/` takes a folder's whole content; the Overseer's check V11 refuses a job (`checks-definition-changed`) when a commit in its range changes a matching path its ticket body does not name. `--writes` names a folder a gate and a prepare step may write besides the worktree, its git admin folder and temp, absolute or `~/`; a relative one, or one that is, sits in or holds a `bin` folder or a folder on the Overseer's `PATH`, is refused at exit 1 with nothing written, one that became so after it was stored is left out of the gate's profile, and whatever is stored, the `bin` beside each of its ancestors is not writable. A builder or reviewer gets every gate's `--network` and `--writes` in its own sandbox, and may run unasked the first word of each command in the gate and prepare lines (split outside quotes on `&&`, `\|\|`, `;`, `\|` and parentheses, past a leading `NAME=value`), beside the git verbs it reads and commits with; an `--overseer-only` gate gives it none of these, since only the Overseer runs it. `--fix` is named in the builder's first message, to run before fixing by hand; the Overseer never runs it. |
| `gate none [--json]` | Store an empty gate list on purpose, with one log line (`No gates, on purpose`, kind `pipeline-gates-none`). Unlike no `pipeline.json` at all, which opens the `checks-not-set` decision and holds new work, it counts as set, and a landing runs no gate. |
| `gate remove <name> [--json]` | Remove the gate `<name>`, with one log line (`Gate <name> removed`, kind `pipeline-gate-removed`); an unknown name is refused at exit 1 with nothing written (`unknown-gate`). |
| | Every `gate` write takes the lock, writes `pipeline.json` atomically after `progress.json`, is accepted with tickets in flight and refuses a malformed `pipeline.json` at exit 1 rather than overwrite it. A ticket's row records the content hash of the pipeline it was gated by (`pipelineHash`) at its next gate run, which reads the pipeline afresh. `--json` prints `{ pipeline, pipelineHash }`. |

**A slot is an agent.** A claim of a bundle writes the same `agent` key on each of its rows, the
claimed ids joined (`"003,004,005"`). The agents in flight are the `in-progress` rows grouped by
that key, each group counted once, plus every `in-progress` row with no key — a review bar started
while none of its claim's rows still runs, a `task add --start` row, a ticket moved there by
`ticket status` — each an agent of its own. A bundle whose tickets go to review one at a time keeps its
slot until its last row leaves in-progress, and a row that returns to in-progress other than from a
pause loses its key, so a reopened bundle ticket is a new agent.

### Review statistics

| command | what it does |
|---|---|
| `review-stats [--json]` | What the recorded reviews catch, miss and cost. A *recorded ticket* is one with at least one `review-recorded` line in `log.jsonl`; each `round` of a ticket is one *pass*, its latest line the one that counts, so a ticket with two passes counts two passes and one ticket. Every other ticket appears in no table and is counted on the last line (`unrecordedTicketCount`); with no recorded ticket at all it prints one sentence saying so, at exit 0. It prints one table over every recorded ticket (`all`), then one per split, a column per group that has a ticket: by ticket `type` (`byType`); by the builder's change size, the `builderInsertions` plus `builderDeletions` of the ticket's first pass, `<=50 lines`, `<=200 lines`, `<=750 lines` or `>750 lines` (`byChangeSize`: `small`, `medium`, `large`, `oversized`); and by the ticket's builder `model` and `effort`, the defaults filled in (`byBuilder`). Per group: *tickets recorded* (`ticketCount`); *review passes* (`reviewPassCount`); *rounds per ticket*, the distinct `round` values of each ticket's passes summed and divided by the tickets (`roundsPerTicket`); *verdict* counts over the passes (`verdictCounts`); *findings* over the passes by `class` (`findingCountByClass`) and by `severity` (`findingCountBySeverity`); *serious findings*, those of severity `would-ship-a-bug` or `acceptance-fails` (`seriousFindingCount`), and per ticket (`seriousFindingsPerTicket`); *review tokens per ticket*, the `tokens` of every row whose `reviewOf` is the ticket, ticket-owned rows excepted (`reviewTokens`, `reviewTokensPerTicket`); *builder tokens per ticket*, the `tokens` of the ticket's own row (`builderTokens`, `builderTokensPerTicket`); *review tokens per serious finding* (`reviewTokensPerSeriousFinding`); for the delivered tickets whose last pass in log order had a serious finding (`afterSeriousLastReview`) and those whose last pass had none (`afterCleanLastReview`): *delivered* (`deliveredTicketCount`), *escaped bugs*, the bug tickets whose `introducedBy` names one of them (`escapedBugCount`), and *escaped bugs per delivered* (`escapedBugsPerDeliveredTicket`); *tickets filed from reviews*, the tickets whose `foundInReview` names the ticket (`ticketsFiledFromReviewsCount`); *claims* over the passes (`claimCount`) and the share whose `handoffContradicted` is true (`handoffContradictedClaimCount`, `handoffContradictedShare`, a percentage in the text); *fix lines per ticket* and *rebase lines per ticket*, the passes' `fixReworkedCodeLines` and `rebaseReworkedCodeLines` summed and divided by the tickets (`fixLines`, `fixLinesPerTicket`, `rebaseLines`, `rebaseLinesPerTicket`). Rates print with two decimals and tokens rounded to whole numbers; a rate over nothing is `-` in the text and `null` in `--json`, which prints the same numbers unrounded as one document. A line naming a ticket the board does not hold is left out. It takes no lock and writes and renders nothing, as `status` does. |

### Cost: the hooks and usage

| command | what it does |
|---|---|
| `hook session-start` | Print `session-instructions.md` for the session Claude Code is starting. `init` and `update` wire it as the `SessionStart` hook in `.claude/settings.local.json`, which a job's `--setting-sources project` never loads. It prints nothing under a job, skips the install version check, and exits 0 whatever happens, printing nothing on failure. |
| `hook bash-domains --allow <domains>` | Keep a job's network inside its ticket's `network` line: the `PreToolUse` guard an Overseer renders into a job's settings for a role with a `network` line, since auto mode's classifier may grant a domain the session asks for. It denies, through the hook's JSON on standard output (`hookSpecificOutput.permissionDecision` `deny`, with a reason), a `Bash` call whose `allowed_domains`, or a `WebFetch` whose URL host, names a domain outside the comma-separated `--allow` list; an entry `*.example.com` admits that domain's subdomains, never the domain itself. Every other call passes, printing nothing and granting nothing. It reads no tracker, skips the install-version check, runs directly under a job, and exits 0 whatever happens, answering deny on any failure: no input, input that is not a JSON object, a url naming no host, an `allowed_domains` that is no list of domains, an unknown option. |
| `usage [--since <when>] [--transcripts <folder>] [--json]` | What this repository's subagents cost, read out of the transcripts the harness wrote for them under `~/.claude/projects/`, a workflow's agents under `subagents/workflows/<run>/` included: one row per agent, oldest first, with its start, its API calls, its end context, its input and output, its browser calls, the characters the harness injected into it and the first line of its brief; then the cohort summary — median calls and end context, mean input and output, and the mean of each figure below. Three columns catch a brief being breached without anyone reading a transcript: `over 200k` is the share of an agent's input sent at a context past 200,000 tokens (a raw token count under `--json`), `bash edits` counts the edits it made through a shell command — a heredoc, an inline interpreter or an in-place editor — instead of the editing tools, and `checks` counts the full test, type-check and lint runs it made per edit instead of per batch. `--since` splits the cohort on an instant and summarises both sides, which is how a change in the way agents are briefed is measured. `--transcripts` reads a folder other than the one this repository's path resolves to. It writes nothing, takes no lock and regenerates no page; a repository with no transcripts is one sentence at exit 0. |

### The page and the board's lifetime

| command | what it does |
|---|---|
| `range --from <when> --to <when> [--tick <15m\|1h\|1d>]` | Store the default axis of the chart, with one log line. `--tick` takes any positive whole number of minutes, hours or days (`15m`, `2h`, `1d`), or a bare number of minutes. Besides a `<when>`, a bound may be `start`, the earliest visible row. A relative bound is stored as written, so `--from -2h` keeps meaning "the last two hours" on every refresh. A pair that is not in order is refused at exit 1 when both are timestamps or both are relative to now; a pair naming `start` or mixing the two is not judged. The page's own range menu overrides it per browser. |
| `range --auto` | Reset the axis to the automatic span. It takes no `--from`, `--to` or `--tick`; any of them beside it is refused at exit 1. |
| `open` | Open the live Overseer's URL in the default browser (`open` on macOS, `xdg-open` elsewhere) and print it, when the newest Baton in `.agent-progress/overseer/` names a live process; otherwise refused `overseer-down` at exit 1, advising `oversee --detach`. It takes no lock and writes nothing. |
| `oversee [--port <n>] [--detach] [--json]` | Start the board's one Overseer, in the foreground, logging to standard error and appending to `.agent-progress/overseer.log`. It binds `127.0.0.1` with `reusePort: false` on the port `OVERSEER_PORT_FIRST` plus the first four bytes of `sha256(trackerId)` modulo `OVERSEER_PORT_COUNT` (100), moving upward past a port in use, so a board keeps its port across restarts; `--port` binds the one given, `0` any free one. It then creates `.agent-progress/overseer/baton-<n>.json` exclusively — `{processId, processStartEpochSeconds, bootIdentity, port, url, tokenFile, codeVersion, installVersion, watcherProtocolVersion}` — writes a fresh API token to `.agent-progress/overseer/token` (mode 0600, the folder 0700), logs `overseer-started`, adds `overseer: {url, processId, startedAt}` to its monitor registry entry, and prints the URL (`--json`: `{url, generation}`). The newest Baton naming a live process (its pid, start and boot all matching) refuses `overseer-already-running` with its URL at exit 1; one naming a dead process lets the starter create the next generation, as after a crash, and a starter that then finds a newer generation refuses `overseer-contended` at exit 1. The holder removes older generations; nobody unlinks a Baton it does not hold. Before each effect batch the Overseer checks that its generation is still the newest and otherwise stops `baton-taken` at exit 2, touching nothing. `GET /api/identity` answers `{application, trackerId, project, codeVersion, installVersion, watcherProtocolVersion, processId}`. `GET /api/state` answers the board state: the `status --json --full` document plus `page` (`{payload, tickets}`, the page's islands), `jobs` (each with `live`: `{calls, callBudget, tokens, toolCalls, lastToolCall: {toolName, startedAt, running}, subagents: [{parentToolUseId, toolCalls, lastToolCall}], toolCallsWithSubagents}`, where tool calls count the `tool-call` events whose `parentToolUseId` is null and a subagent's are grouped by it), `decisions`, `incidents`, `notices`, `mergeQueue` (`{queuedTicketIds, slots}`), `overseer` (`{state, paused, url, generation, codeVersion, installVersion, batonPassWarning}`) and `usage` (`{resetsAt, window}`). `GET /api/summary` answers agent-dashboard's `summaryVersion: 1` subset. `GET /api/events` is a server-sent event stream of `board`, `job`, `decision`, `incident`, `overseer` and `usage` events with ids `<generation>-<n>`: a reconnect whose `Last-Event-ID` is still buffered gets what it missed, any other a whole `board` first, and a `: ping` comes every `SSE_HEARTBEAT_SECONDS` (5). `GET /api/jobs/<J>/stream?after=<instance>.<sequence>` streams the job's transcript, read from its event logs, as `history` then `message` events of vendor-neutral entries; `GET /api/jobs/<J>/files/<name>` serves only `report.json` and `gate.log`, as `text/plain` under `Content-Security-Policy: sandbox`. `POST /api/commands` takes a control command (`{kind, …}`) with the bearer token from the Baton's `tokenFile` and answers 200 `{outcome, result}`, 409 `{refusal}` worded, 400 for a malformed body, 401 without the token, and 423 while launches are held for an install change (`overseer-stop` and `overseer-restart`, `{kind, now}`, are taken even then); the body-less `POST /api/nudge` only schedules a pass. Every request needs the Host `127.0.0.1:<port>` or `localhost:<port>`; any Origin but the API's own, agent-dashboard's included, and every preflight `OPTIONS` get 403, and no answer carries a CORS header. `GET /api/session-token` answers `{token}` only to a same-origin fetch (`Sec-Fetch-Site: same-origin`). Every answer carries the page CSP, `frame-ancestors` naming the origins of agent-dashboard's `~/.agent-progress-monitor/agent-dashboard/server.json`, or `'none'`. A stop logs `overseer-stopped`, removes the registry key and then the Baton. `--detach` starts the same command detached and prints the URL once `/api/identity` answers, within a bounded number of tries, or refuses `overseer-did-not-start` at exit 1. |
| `oversee --successor-of <generation> [--port <n>]` | The successor's side of `oversee restart`'s Baton pass, which only the live Overseer starts; see `oversee restart`. |
| `oversee stop [--now] [--json]` | Stop the live Overseer: the command goes to its API with the token from the file the Baton names, or, when the API does not answer, SIGTERM goes to the process the Baton names, its identity checked first. It waits a bounded number of tries for the Baton to be gone or to name a dead process, else refuses `overseer-still-live` at exit 1. A live Watcher is never touched (the stopping Overseer acknowledges only a Watcher whose child already ended, so it exits); `--now` also stops process Watchers. With no live Overseer it has nothing to do (exit 0). It checks no install version. |
| `oversee restart [--now] [--json]` | The checked Baton pass to the code on disk, which checks the install version first. The live Overseer writes `requested` to `.agent-progress/overseer/baton-pass-<generation>.json` and spawns `oversee --successor-of <generation> --port <its port>` detached, its standard error appended to `overseer.log`, and keeps driving. The successor, holding no Baton, builds its Watcher and page bundles, reads the board, every job record and every claimed Watcher file and its event log, checks the manifest against its own install version, and writes `ready`, or `successor-failed` with the step (`build-bundles`, `read-board`, `read-jobs`, `read-watcher-files`, `install-version`) and its error. On `ready` the old Overseer finishes a pass in progress (a landing included), starts no other, logs `overseer-stopped` `handed-over`, closes its listener and writes `released`; no Watcher is sent anything. The successor then binds the port, takes generation n+1 (the Baton pass file admits it beside the live identity), logs `overseer-started`, regroups every Watcher from its stored cursor and writes `serving`; the old Overseer exits. A successor that fails before `released`, exits without a report, or reports nothing within `BATON_PASS_READY_TRIES` × `BATON_PASS_READY_INTERVAL_MILLISECONDS` (it is then killed, identity checked) leaves the old Overseer driving; one that fails after it (`bind-port`, `take-baton`, `regroup`) gives its generation up, and the old Overseer takes n+2, rebinds and regroups. Either way the old Overseer logs `baton-pass-failed`, writes `failed` and shows the failure as a warning in `oversee status` until a Baton pass succeeds, and `restart` refuses `baton-pass-failed` at exit 1. A successor whose old Overseer dies while it waits starts as after a crash. On success it prints `Overseer handed over to code <codeVersion> at <url>` (`--json`: `{outcome: done, url, codeVersion}`). An Overseer whose API does not take the command is stopped and started again detached on its port; with none live one is started. The Overseer never restarts itself. |
| `oversee pause\|resume [--json]` | Store `overseerState` `paused` or `running` through the write pipeline, logged as a `overseer-set` record, with the Overseer up or down: a paused Overseer starts no new job. `--json` prints `{overseerState, previousState}`. |
| `oversee status [--json]` | The newest Baton, the URL, the runtime state from the Overseer's `GET /api/state` (`serving`, `held-by-install-change`, `passing-baton`; `starting` while the API does not answer yet, or `down`), whether the board is paused, the code version on disk against the live Overseer's, the Overseer's notices, and the warning of a failed Baton pass. Read-only, no lock, no install-version check. `--json` prints `{state, paused, url, baton, codeVersionOnDisk, codeVersionInMemory, notices, batonPassWarning}`. At each sweep and after each landing (a move of the main line's tip) the Overseer runs the on-disk binary's `version --json` as a child, and it reads the manifest on every pass: an install version that differs from its own holds launches (`held-by-install-change`, the stored `overseerState` untouched) with the notice `install-version-changed`, "run `agent-progress update`", until the versions match; code that differs alone only shows the notice `new-code`, "new code: run `agent-progress update`". A Watcher on a protocol below `WATCHER_PROTOCOL_OLDEST_SUPPORTED` is a legacy Watcher, listed in the state's `legacyWatcherJobIds`: sent no frame, its Watcher file and event log read in its own `EVENT_LOG_FORMAT_VERSION`, and stopped by signalling its recorded process group, identity checked. A relayed request of a `hatchFormatVersion` the Overseer does not read stays pending, unanswered, until an Overseer that reads it. |
| `version [--json]` | Print `{codeVersion, installVersion}`: a content hash of the program's shipping files on disk, and the install version this program writes. Read-only; it needs no tracker and checks no install version. |
| `merges [--json]` | The merge queue, read as `status` reads the tracker (no lock, nothing written): each held slot `{target, jobId, ticketIds, phase, targetTip, branchTip}`, then each queued ticket `{ticketId, target, priority, queuedAt}` by target, priority, then queue order (the slot's own pick also weighs predicted conflicts), `queuedAt` its `merge-queued` record's place in the log. `--json` prints `{slots, queue}`. |
| `merge fixer\|abort\|review\|land <J> [--incident <I>] [--json]` | An Airlock move on merge job `J`'s open `merge-gate-failed` or `resolution-over-threshold` incident, recorded in a hold with the Overseer up or down and carried out by the Airlock on its next sweep; each marks the incident handled (`incident-handled`). `fixer` (merge-gate-failed) sets the slot `fixing`, and the Airlock launches one merge-gate fixer (`MERGE_FIX_ATTEMPTS`, its own `MERGE_FIXER_API_CALL_BUDGET`) given the failed gate's last `CHECK_OUTPUT_TAIL_LINES` lines; a merged tree still failing after its fix resumes the same fixer twice, and the next red aborts the merge and parks the ticket `parked:merge-gate-failed`. `review` (resolution-over-threshold, also its default) lets the Airlock launch a resolution reviewer (`RESOLUTION_REVIEWER_API_CALL_BUDGET`); claims that do not hold (`cannot-resolve` with no `reportKind`) abort the merge and park it `parked:merge-resolution-rejected`. `abort` parks every ticket of the incident `parked:<kind>` with a `parked` decision, and the Airlock aborts the merge and frees the slot. `land` (resolution-over-threshold only) moves the slot to landing when a `gate-ran` record passed the merged tree the incident names, else it is refused `merge-gate-not-passed`. Both Airlock agents run with the question tool disallowed. Without `--incident` the move takes `J`'s one open incident that allows it; none is refused `no-open-incident`, several `several-open-incidents`; a slotless job `job-holds-no-airlock`. |
| `worktree repair <id> --step prune\|reinstall\|recreate\|unlock [--incident <I>] [--json]` | A code-implemented repair of the ticket's worktree `<worktrees>/ticket-<id>/`, run inside the hold that records it (`worktree-repaired {step, patchPath}`): `prune` runs `git worktree prune`; `reinstall` changes nothing on disk, so the next launch reruns the install line; `recreate` saves `git diff HEAD` and every untracked file to `.agent-progress/jobs/<J>/recreate-<n>.patch` (the incident's job, else the ticket's newest) and removes the worktree, which the next launch creates again from the branch, refused `worktree-has-uncommitted-work` when changes exist and cannot be saved; `unlock` removes a stale `index.lock`. `recreate` and `unlock` are refused `worktree-in-use` while any job on the board names the ticket; a git failure is refused `worktree-repair-failed`. Without `--incident` it takes the ticket's one open incident that allows it (`setup-failed`, `blocked`, `gate-cannot-run`), else applies as a plain User control. |
| `gate retry <J> [--incident <I>] [--json]` | Settle job `J`'s `gate-cannot-run` incident (`incident-handled`): a merge job's slot gates its merged tree again on the next sweep, and an ended build's ticket is free for its next attempt. Without `--incident` it takes `J`'s one open incident that allows it; with none there is nothing to do. |
| `decisions [--json]` | The open decisions for User, read from `progress.json` (no lock, nothing written), in opening order, each question's options lettered `a`, `b`, `c` as `decide` takes them. `--json` prints `{decisions}`, each `{id, kind, ticketIds, jobId, askedBy, requestId, questions, context, openedAt}`. |
| `decide <decision> <letters>... \| -- <text> [--json]` | Answer an open decision through the write pipeline, with the Overseer up or down: one choice of option letters per question (`decide E7 b`; `decide E7 b ac` when the second question is multi-select, its labels joined by `, `), or free text after `--` for a decision asking one question (`decision-has-several-questions` otherwise). A letter naming no option is refused `decision-option-unknown`, several letters on a single-choice question `decision-single-choice`, a wrong number of choices `decision-answer-count`. The first answer wins (`decision-already-answered`). The answer is stored as `{question: answer}` and logged `decision-answered` with the question request it answers; the request id joins the asking job's `answeredRequestIds`, and a job waiting on that answer alone moves back to `running`. The Overseer then delivers it: a live Watcher still holding the request gets the `control_response` allow with `updatedInput.answers`; a resumed session takes it as its first user line. A question whose ticket job ended `replaced` or `stopped` was held on its ticket `awaiting answer (E<n>)`: the answer goes under the ticket's `## Questions` and lifts the hold. `--json` prints `{decisionId, answer}`. |
| `incidents [--json]` | The open incidents for the Assistant, read from `progress.json` (no lock, nothing written), in opening order, each with its facts, the moves its kind allows and its default. `--json` prints `{incidents}` as `progress.json` stores them. |
| `incident answer <I> -- <text> [--json]` | Answer a `system-question` or `malformed-ticket` (`incident-not-a-question` for another kind): logged `incident-handled` and `incident-answered` with the question's request, which joins the waiting job's `answeredRequestIds`, so the Overseer delivers it as it delivers a decision's answer and the job runs again once nothing else it asked is open. A `malformed-ticket`'s answer, or one no job waits on, is also written under the ticket's `## Questions`. |
| `incident note <I> -- <text> [--json]` | Record a finding under the incident, logged `incident-noted`; the incident stays open. |
| `incident escalate <I> [--json]` | Close the incident and put exactly the agent's questions to User as an `agent-question` decision on the same tickets, job and request, logged `incident-escalated`; one carrying no questions is refused `decision-without-questions`. Every move naming an incident, here or through `--incident`, is refused (`incident-move-not-allowed`, `finding-not-listed`) unless the incident is open and its kind's row of `ALLOWED_MOVES_BY_INCIDENT_KIND` allows the move, and marks it handled in the same hold. |
| `jobs [--json]` | The live jobs, one line each (id, kind and role, state, tickets, attempt, Watcher instance, a stop asked), then the Overseer (`live` with its URL, or `down`), paused or not, agents against the limit, the open decisions and incidents, and a warning line per incident that took its default since the Overseer last started. Read-only, no lock. `--json` prints `{jobs, overseer, paused, agentsInFlight, limit, openDecisions, openIncidents, defaultedIncidents}`, each defaulted one `{incidentId, move, cause, at}`. |
| `job show <J> [--json]` | The job's record from `progress.json`, or for a finished job what its `job-launched` and `job-ended` records hold, and its job folder; an unknown job is refused. Read-only, no lock. `--json` prints `{job, jobFolder}`. |
| `job attach <J> [--json]` | Every Watcher instance's event log in instance order through the adapter's mapper, then the newest followed while the job is on the board; it never connects to a Watcher. Read-only, no lock. `--json` prints `{jobId, lines}` of the replay and follows nothing. |
| `job message <J> [--incident <I>] -- <text> [--json]` | Record a chat turn in a hold, logged `job-messaged`, with the Overseer up or down; the Overseer writes it to the live session in log order, once; to the Assistant only at its next idle point (see The Assistant). A product-owner job that ended `closed` (its own `intake-close` or `job stop`) is reopened instead, logged `job-reopened`: back on the board `running` in its next Watcher instance, which resumes its session by id in the same folder with the text as its first line, and its next `ready-drafts` lists only drafts filed since. Any other finished job, or a session whose input is closing, is refused `job-finished`. Under an incident it is refused `job-awaits-user-answer` for a job in `waiting-for-answer` or whose ticket has an open `agent-question`, and `job-is-product-owner` for User's product-owner session. |
| `job fresh <J> [--incident <I>] [--json]` | See `job wind-down\|stop`; `--incident` names the incident it handles. |
| `job wind-down\|stop <J> [--json]` | Logged `job-stop-requested` with its mode and kept as the job's `stopRequest`, with the Overseer up or down. `stop` and `wind-down` hold the job's ticket `stopped by User (J<n>)` or `wound down by User (J<n>)` in the same hold (an already held ticket keeps its hold), which the policy never undoes; `ticket unhold` lets a fresh agent take it. `wind-down` sends the wind-down turn; `stop` moves the job to `stopping` and the Overseer stops its Watcher, the job ending `stopped`; a job with no session yet (launching, preparing, interrupted, awaiting an answer) ends `stopped` in the same hold. A stopped product owner is finished: its open decisions are withdrawn (`decision-withdrawn`), its drafts stay drafts, and it resumes only when User sends it a `job message`. `fresh` holds nothing and ends the job `replaced`, so the next attempt starts on its worktree with the earlier-session note; a job with no ticket is refused `job-has-no-ticket`. |
| `job stop --all [--wind-down] [--json]` | `oversee pause`, then a stop (or wind-down) of every build, review and product-owner job, in one hold. |
| `intake -- <text> [--json]` | Record a `product-owner` job with no ticket and no build slot, `launching`, with the Overseer up or down; several may run at once. The Overseer launches it in `<worktrees>/sessions/<J>/`, its first line `/<agent-po skill> <text>`, skills on, WebFetch and WebSearch allowed and Bash `allowedDomains: []`; it files drafts through its Hatch folder and never readies one. Follow-ups are `job message` turns. |
| `advise [--json]` | Record an `onboarder` job with no ticket, no target and no build slot, `launching`, with the Overseer up or down. With no pipeline stored the lifecycle starts one by itself, answering `checks-not-set`: one per opening of that decision. The Overseer launches it in a detached snapshot of the main line, `<worktrees>/onboard/<J>/`, writing only its Hatch folder (the Hatch), with no network; its first message names its mode, `setup` with no pipeline and `advise` with one, and the newest `gate-ran` records. Its report (`ONBOARDER_REPORT_SCHEMA`) proposes `prepare`, `gates` with `definedBy`, `network` and `writes`, `review`, `constitution` and `agents`; in `advise` each of its `optimisations` is a draft low ticket it filed through its Hatch. Customs runs V1, V16 (HEAD unmoved), V4, V5, V12 (each optimisation is this job's low draft), V13 and V14: a changed or added file in the snapshot, a commit or a moved ref fails the pass, and the job ends `failed`. A verified `setup` proposal's prepare steps and gates then run twice on the snapshot, each gate on its own, recorded `green`, `red`, `cannot-run` or `disagreeing` with each run's time, and its caching is checked, suggesting only: no caching tool while a gate takes 30 s or more, a `turbo.json` cache kept per worktree (`.turbo/cache` or any relative `cacheDir`), a task's `inputs` missing `bin`, `templates`, `fixtures` or `resources` folders, and a gate not run through `turbo run`. The job ends `closed` and a `pipeline-proposal` decision opens with that record; `Accept` writes the prepare steps and gates through the `gate prepare`, `gate add` and `gate none` moves in the answering hold, `Decline` changes nothing. The review, constitution and agent arrays are shown, never written. |
| `intake close <J> [--set <id,id>]... [--json]` | Close the product owner's input (`job-not-intake` for another kind of job, `job-finished` once closed). Once no Watcher of it is live the Overseer ends it `closed` and opens a `ready-drafts` decision listing the drafts it (and any session it took over from) filed, each with its priority and `network` domains: one option per `--set` of readiable drafts, else one of all of them, and `None`; a draft without a numbered Acceptance or a Brief is listed as not readiable. Answering readies the chosen drafts in the answering hold. Under the product owner's own job it names no job: the Overseer stamps its own. A product owner interrupted by a reboot resumes by id once its question is answered; one past the crash bound with a question open waits `awaiting-answer`, and once answered a fresh session takes over with its drafts and the answers in its first message, never a resume. |
| `await [--json] [--after <n>]` | Wait until the log holds a `decision-opened` or `incident-escalated` record past position `<n>` (the log's length at the start when absent; positions count from 1), then print them and stop. `--json` prints `{after, position, records}`, each record with its `position`; the next wait is `await --after <position>`. A stop signal ends the wait with nothing printed. Read-only, no lock. |
| `clear [--all] [--yes]` | Throw away every task row and the log, restart the clock and reset the stored axis to automatic, leaving one `Tracker cleared` log line, and keep the tickets: each surviving ticket is given a fresh row seeded from its own frontmatter, with a new id, except a low ticket with no row. Row ids are not reused, and every epic file is kept untouched. `--all` deletes the tickets and every epic too and restarts the ticket ids at 001; `--json` prints `removedTaskCount`, `removedLogCount`, `deletedTicketCount`, `deletedEpicCount` and `reseededTicketCount`. `--yes` skips the confirmation, and is required when standard input is not a terminal. |

### A build job

A readied ticket's build job moves through job states, each one a pass of the Overseer. `launching` becomes `preparing`
(the ticket goes `in-progress`): the Overseer adds `<worktrees>/ticket-<id>/` on branch `ticket-<id>` from the target's
tip and runs the install line there in a process Watcher under `sandbox-exec` with the job's profile, network on. Once
it ends at exit 0 (or with no install line stored) the job is `running` and the builder launches, its first message
holding the ticket and every gate it must pass on its final commit, by name, command and `fix`, in order (an
`overseerOnly` gate named as the Overseer's alone; after `gate none`, that the repository has no gates), its report
claiming each gate but an `overseerOnly` one in `gates` with the commit it passed on, confined by the per-job settings:
writes denied to the data folder, the
monitor folder, the worktree's `.claude/`, `packed-refs`, the target refs, every other ticket branch and every other
worktree's admin folder; reads denied of the Overseer token, the launch files, the Watcher sockets, `~/.ssh`, `~/.aws` and
`~/.gnupg` (only its private keys when the gpg-agent socket signs); writes outside the worktree only to its own Hatch
folder and the gates' `writes`; its ticket's `network` line and the gates' `network` its only network (an
`overseerOnly` gate's never). Its closing `result` moves it to `in-customs`, the Overseer closes
its input and verifies, a builder's check V15 refusing (`gate-unclaimed`, naming the gates) a report that does not
claim every such gate on HEAD itself, so a missing or stale claim runs no gate; a verified `built` report is `gating`:
the prepare steps run again in a process Watcher of
their own (`gate-prepare`), then each gate in one (`gate-1`, `gate-2`, …), each sandboxed with its own network and
`writes`, a red one writing its name and output to the job folder's `gate.log`. A review job whose reviewer left the
tree it was given runs no gate. On a pass the Overseer replaces the ticket's `## Handoff` with the report's handoff and
Acceptance evidence, moves the ticket `in-review` and ends the job `built`; the policy then launches the review job in
the same hold.

Review is an optional phase, set by the pipeline's `review` key. Without it no review job is ever launched: a gated
build is queued to merge in the same hold (`merge-queued`), draws no review bar, and lands on its gates alone, the
Acceptance check of the landing being a review's. With it, its `name` ends each review bar's name
(`Review 1 #12 — <title> (<name>)`, logged in `review-bar-started`), and its `model` and `effort` (one of `low`,
`medium`, `high`, `xhigh`, `max`; any other keeps the default) are the reviewer's launch settings. A review whose
claim does not hold moves the ticket back `in-progress`, and the build job after it keeps the attempt and resumes the
builder's own session (`--resume`, the session id of the build job the review sent back), its first line the review's
newest `## Review <round>` section and which resume of `RED_HANDOFF_RESUMES_BEFORE_PARKING` (2) it is: each such
review counts against the same resumes as the build cycle's red handoffs, never as a failed pass, and the one past the
last parks the ticket `parked:red-resumes-spent`. A review that does not hold and resumes no builder, its ticket's
newest build not `built`, is a failed pass.

| what happens | what the Overseer does |
| --- | --- |
| worktree creation, the install line or a gating prepare step fails | incident `setup-failed`; the job ends `stopped` |
| the session exits without a valid report | a failed pass: `job-ended` `failed`, cause `no-report` |
| a commit in range carries an attribution trailer | a failed pass, cause `attribution`; the ticket shows the `attribution-found` notice until its next job ends |
| a gate fails, or Customs refuses V3 (no commit), V4 (a dirty worktree) or V15 (missing or stale gate claims) | a red handoff: the Overseer writes `gate-failure.md` (gate, command, fix command, commit, exit code, the output's first and last 40 lines within 8 KB or the diff of a gate that changed a file, the full log's path) and `red-handoff.json` in the job folder, and interrupts the job `handoff-red`; the policy resumes the same session (`--resume`, the job's own session id), its first line naming the gate, commit and exit code, the Baton pass, which resume of `RED_HANDOFF_RESUMES_BEFORE_PARKING` (2) it is and its `RED_HANDOFF_RESUME_CALL_BUDGET` (30) calls. It gates again in instance-suffixed folders (`gate-1-2`). The red after the last resume of the cycle ends the job `failed`, cause `red-resumes-spent`, and parks the ticket `parked:red-resumes-spent` with a `parked` decision. A review job goes through the same ladder. When the resume fails (`resume-failed`), the fresh build after it keeps the attempt, opens with the same message and carries on the same count |
| any other verification refusal | a failed pass, its cause the refusal reason |
| the report says `blocked` | incident `blocked`; the job ends `blocked` |
| the report says `wound-down` | incident `out-of-calls`; the job ends `wound-down` |
| the call budget is reached | the wind-down message is sent once |
| the budget plus `WIND_DOWN_GRACE_CALLS` (10) is reached | incident `out-of-calls`; the job is `stopping`, then ends `stopped`; a session resumed after a red handoff opens no incident and, once stopped, counts as red again |
| the checks process exits 126 or 127, or is killed by a signal | incident `gate-cannot-run`; the job ends `stopped` |
| no `pipeline.json` is stored, or it is malformed | the `checks-not-set` decision; nothing launches (`gate none` sets an empty pipeline on purpose) |
| a running build or review's event log stands still for `QUIET_JOB_SWEEPS` (6) sweeps | incident `quiet-job`; its default opens the `quiet-job` decision |

A ticket an open incident names launches no new job until the incident is settled. An incident's default applies when
its delivery turn closes; while no orchestrator runs, a `merge-gate-failed` or `resolution-over-threshold` takes it at
once, and while none can come up (`FAILED_ASSISTANT_BOOTS_BEFORE_DEFAULTING` failed boots, or a usage limit) every
incident does, each logged `incident-defaulted {move, cause}`. A park or a merge abort holds the ticket
`parked:<kind>` with a `parked` decision, a triage triages what is still listed, the quiet-job default opens its
decision, and a repair, gate retry or fresh agent is taken once per ticket, the next one of its kind parking. Where
`sandbox-exec` cannot apply
a profile, the process Watchers run unconfined and gate passes are kept in the Overseer's memory only.

### The Airlocks

After each pass the Overseer sweeps one Airlock per target: the main line and each `group-<name>` with an open
ticket. A queued ticket (in review, `mergeQueued`, unheld,
no open `waiver` or `landing-refused` decision) is a candidate; candidates are predicted with `git merge-tree` and
ordered by priority, clean before conflicting, fewest conflicts caused, readiness, then id. The claim, in its own
hold, refuses while a merge job holds the slot, when either tip moved since the prediction, and
`higher-priority-queued` when a candidate of a strictly higher priority waits; it launches a `merge` job whose record
carries `slot: {target, targetTip, branchTip, phase}` and logs `merge-started`. Each phase is written on the slot in
its own hold. The merge-in merges the recorded `targetTip`, never the moving name, once, in the ticket's worktree; a
conflict launches a `merge-agent` job, role `resolver`, which cannot ask and has `RESOLVER_API_CALL_BUDGET` calls. The
merged tree is gated (the prepare steps and gates, each sandboxed as a build's are; not at all when it is the branch's
own tree and the newest `gate-ran` on it passed, and a failed prepare step opens `setup-failed`), then landed by a
compare-and-swap fast-forward in the main checkout, logging `merge-landed` and
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
temporary worktree; the claim refuses `refresh-beside-a-queued-release`, and `airlock-held` while the slot is held,
so there are never two refreshes. The group's release ticket targets the main line, a candidate only once every other
ticket of its bundle (walked through `dependsOn`) is `reviewed` and no refresh holds the group's slot, with the
bundle's highest priority. A release whose branch does not hold the group's tip is refused (`merge-refused`, cause
`release-behind-group`) before its merge-in. It merges the main line once in its own worktree, gates, fast-forwards
the main line and delivers the whole bundle; the group worktree is then removed and `group-<name>` deleted with
`branch -d`, never forced.

| what happens | what the Overseer does |
| --- | --- |
| the resolver reaches its budget, reports `cannot-resolve`, or V10 fails | the merge aborts, the slot frees, the ticket leaves the queue and the `merge-refused` decision opens with the report's `notes`; a `reportKind` of `malformed-ticket` or `system-blocker` also opens a `malformed-ticket` or `system-question` incident with no job waiting |
| the resolution changes over `RESOLUTION_REVIEW_THRESHOLD_LINES` (150) lines against git's automatic merge | incident `resolution-over-threshold`; the slot waits for its move |
| the merged tree fails its gate | incident `merge-gate-failed`; the slot waits for its move |
| the merged tree still fails its gate after a merge-gate fixer's fix | the fixer, which waits `gating` through its fix's gate, is resumed in its own session with the Baton pass (a red handoff, as a build's), the slot back in `fixing`; the red after its last resume ends it `failed`, aborts the merge and parks the ticket `parked:merge-gate-failed`; a pass ends it `resolved` |
| the main line moved to a tip a `merge-landed` names, or to another one | the worktree is reset to `branchTip` and the ticket requeued silently; after `TARGET_MOVED_MERGES_BEFORE_PARKING` (2) unrecorded moves in a row the ticket parks |
| the main checkout is off the main line, or its changes block the fast-forward | the slot frees and that target's landings wait under the `dirty-main-checkout` notice, rechecked every sweep; builds and reviews launch on |
| the check stamp differs or the Acceptance is not accounted for | `mergeQueued` cleared, the ticket held, decision `landing-refused` |
| the main line already holds the merged commit (a crash after the fast-forward) | the board side is finished |
| a merge-in left `MERGE_HEAD` with no live holder, or the resolver ended with no usable result | `git merge --abort`, a reset to `branchTip`, and a requeue; a live or interrupted resolver keeps the slot |

When a session is first launched the Overseer writes `<data>/jobs/<jobId>/start.json`: the worktree's HEAD, the ticket
body's hash, every ref's commit from `git for-each-ref`, each detached worktree's HEAD and a digest of the hooks
folder. Verification then also runs, for every role, V13 (no commit in range and no worktree file changes `.claude/`,
`.mcp.json` or the hooks folder, `core.hooksPath` read from git, `.git/hooks` otherwise) and V14 (no ref but the
job's own branch, another live job's branch, or a target a recorded landing moved to its commit has moved since
launch, refusal `foreign-ref-moved`); a reviewer's also runs V12 (every `filed` finding names, by `filedTicketId` or
by the `hatchRequestId` its `hatch-applied` record carries, a ticket whose `ticket-filed` record says `draft`, `low`,
`findingRoute` `assistant` or `user` and `filedByJob` this job, whatever the ticket is now). V13 also runs before
every launch and resume on a ticket's branch, against the branch's commits past its target and its worktree: a hit,
or a V13 refusal after a job, opens the `branch-touches-agent-config` decision once, and no session launches or
resumes on the ticket while it is open; an answered one settles the hit until another job on the ticket ends.

### A review job

An `in-review` ticket's review job, which the policy launches for round `<n>` as its `attempt`, starts a review bar
for its round, reuses the ticket's worktree (made again from its branch when missing) and moves through the same
states as a build job, its first message the review prompt and its budget `REVIEWER_API_CALL_BUDGET`. Once verified
and gated, the Overseer counts the rework from the review's start to its HEAD in code lines; commits
`Review round <n> of #<id>: no changes` when the reviewer committed nothing; appends `## Review <n>` from the report's
`reviewText`, claims and findings; records the review on the bar; and takes the round verdict.

| the review | what the Overseer does |
| --- | --- |
| claims an item `does-not-hold` | back to a fixer: the job ends `does-not-hold`, the ticket goes `in-progress`; a resume of the builder when its build was `built`, otherwise a failed pass |
| reworked over `REWORK_ROUND_THRESHOLD_LINES` (750) and the round verdict grants another round | the job ends `round-granted`; the policy launches a fresh reviewer one round on |
| reworked over the threshold and was refused another round | it passes on; the ticket shows the `rounds-not-converging` notice until it is delivered or reviewed again |
| claims an item `waiver-proposed` | the `waiver` decision opens and the job waits `awaiting-answer`, the ticket out of the merge queue and held; granting it writes `A<n>. Waived: <reason>` (the reviewer's note) in the answering hold and queues the ticket; any answer starting `refuse` ends the job `does-not-hold`, back to a fixer as above |
| otherwise | the job ends `reviewed`, the ticket is marked `mergeQueued` and `merge-queued` is logged with its target; a queued ticket gets no further review |

### The Assistant

The Overseer always has one `assistant` job, the Assistant: no ticket, no build slot, working in
`<worktrees>/sessions/<J>/`, never resumed, with no off switch. The policy boots one at Overseer start and whenever none
is live, `--model sonnet --effort medium` (`ASSISTANT_MODEL`, `ASSISTANT_EFFORT` in
`src/shared/constants/OverseerLimits.ts`; every other role runs `opus` at `medium`), its brief
`resources/templates/AssistantBrief.md`, AskUserQuestion, WebFetch and WebSearch disallowed and no network. Its first
message is chat 1: every open incident, the newest `ASSISTANT_HISTORY_RECORDS` (20) `incident-*` records and a board
summary.

| what happens | what the Overseer does |
| --- | --- |
| the Assistant is idle: as many `result`s as chats, and an incident is undelivered | marks every undelivered incident delivered in the next chat number (`deliveredInTurn`) and writes them as one chat turn |
| the n-th `result` of its session | closes chat n's turn: in that hold, after the turn's relayed moves (a `queued` one included), every incident delivered in it and still open takes its default, cause `turn-closed` |
| the open turn reaches `ASSISTANT_TURN_CALL_BUDGET` (40) tool calls | writes the interrupt line once; the turn's open incidents default, cause `turn-budget` |
| an idle Assistant's newest `result` reports `ASSISTANT_CONTEXT_TOKENS_BEFORE_FRESH` (200 000) context tokens | moves it `stopping` and closes its input; it ends `closed` and a fresh one boots |
| User's `job message <J>` to it | written as the next numbered chat at its next idle point, never mid-turn |
| it is interrupted (its Watcher lost, its session crashed, a reboot, a usage limit) or its event log stands still for `QUIET_JOB_SWEEPS` sweeps mid-turn | stops what is left of it, ends it `replaced` (`failed` before its first `result`), cause `assistant-down`, and boots a fresh one whose first message carries every open incident, those it was delivered included |
| `FAILED_ASSISTANT_BOOTS_BEFORE_DEFAULTING` (2) boots in a row failed, or a usage limit holds launches | every open incident defaults in that pass, cause `no-assistant`, until a fresh session reaches its first `result`; past the failed boots it boots again once per sweep, never in the pass a boot failed |

Through its Hatch it may make only the moves its delivered incidents allow, each naming `--incident <I>`, and ready or
triage only the findings a delivered `findings-delivered` incident lists: filing, priorities, waivers, settings and
answers to User's decisions are refused.

### Under a job: the Hatch

A session the Overseer launched cannot write the data folder; its Hatch folder, the Hatch, is its one way to change
the board. With both `AGENT_PROGRESS_JOB_ID` and
`AGENT_PROGRESS_HATCH_DIRECTORY` set (named from the build's environment prefix), the read-only verbs (`help`,
`status`, `usage`, `review-stats`, `ticket show|list`, `epic show|list`, `draft show|list`, `hook bash-domains`,
`version`, `oversee status`, `decisions`, `incidents`, `merges`, `jobs`, `job show|attach`) run directly. A verb of
a control command parses its arguments as usual, then, before any install-version check, writes
`<hatch>/requests/<requestId>.json` atomically, `{hatchFormatVersion: 1, requestId, command, bodyText?}`, the body it
read travelling beside the command. It waits for `<hatch>/replies/<requestId>.json`, `HATCH_REPLY_TRIES` times
`HATCH_REPLY_INTERVAL_MILLISECONDS` apart (`src/shared/constants/OverseerLimits.ts`), and prints `done <requestId>` or
`nothing-to-do <requestId>` with the tickets it touched at exit 0, or the refusal worded as a direct run words it; with
no reply it prints `queued <requestId>` at exit 0. Every other verb is refused at exit 1. A request names no job and no
role: the Overseer takes both from the Hatch folder's job record, refuses a request carrying either
`hatch-identity-mismatch`, and admits a command only as `Bouncer` allows the job's role. `ticket add
--needs-user` exists only for a worker's relayed low finding and is refused `worker-filing-flag` anywhere else. An
admitted filing is stamped with two more frontmatter keys: `filedByJob`, the filing job's id, and on a worker's
finding `findingRoute`, `assistant` or `user`, which only `ticket triage` changes afterwards; any other route
makes the file malformed. Both are in the ticket file's format, and the Hatch's outputs in the exit-code table below.

**Findings.** A builder's, reviewer's or merge-gate fixer's finding is that relayed low draft. With route
`assistant` it waits for the ticket it was found on: in the hold that delivers or abandons that ticket the Overseer
opens one `findings-delivered` incident listing its findings, and the Assistant readies each with `ticket ready <id>
--incident <I>` or triages it to User with `ticket triage <id> --incident <I>`, the incident's default triaging what
is still listed. With route `user` it waits in User's Low-priority triage list until User readies, edits or abandons
it.

## Exit codes

| code | meaning | examples |
|---|---|---|
| **0** | done, or there was nothing to do | also a command under a job that printed `done`, `nothing-to-do` or `queued` with its request id, `oversee stop` with no live Overseer, every `hook session-start` run, and every `hook bash-domains` run, a deny answered through its JSON |
| **1** | a refusal the caller can act on | no tracker here (run `{{program}} init`), no such task or ticket, a missing `--reason`, a move the matrix refuses, readying a ticket that is not a draft or lacks a numbered Acceptance or a Brief (`incomplete-tickets`), lowering a ticket that is not a draft or pending, a `network` domain that is not public, `ticket deliver --by-hand` while an Overseer is live (`overseer-owns-the-lifecycle`), an answer to a decision already answered, a move its incident does not allow, a command under a job that its role may not run or that the Overseer refused, a second Overseer (`overseer-already-running`), installed files of another install version (every command but `init`, `update`, `help`, `status`, `version`, `oversee status` and `oversee stop`; run `{{program}} update`), `init` or `update` over files a newer {{program}} installed or a `version.json` naming a retired agent host, `hook` given a wrong event word, an extra argument or an option, and an unknown command |
| **2** | a state the tool will not repair on its own | an unreadable or malformed progress file, an unreadable or malformed log.jsonl, a malformed ticket file a command names, a lock it could not take, an Overseer whose Baton a newer generation took (`baton-taken`), and any error the tool did not expect |

Check the code rather than the wording.

## The Handoff and the token column

A ticket's body ends with a **Handoff** section, written by the agent that implemented the ticket as
the last thing it does, in under 15 lines, with what the ticket template
(`resources/templates/TicketBody.md`) and the installed brief's Report block list. The review pass and
whoever picks the work up next read it instead of re-deriving it from the diff.

Every row carries a token count, shown beside the bar. Under the Overseer no hook fills it in: the
`SubagentStop` hook that added an agent's tokens to the row its brief named is retired, and `update`
removes its entry. What a job has processed is read from its session instead: `GET /api/state` carries
each job's `live.tokens`, the input, output and cache tokens of every assistant turn it took, keyed by
message id so the live stream and a transcript replay count each call once. When a job working tickets
ends, the Overseer reads every assistant turn of its event logs, its subagents' included, logs one
`agent-stopped` record whose `agentId` is the job id, and adds its `totalInputTokens` (fresh input plus
both cache figures) to the row of each ticket it worked, split evenly over a bundle's tickets with the
remainder on the first; a review job's go to the ticket's newest review bar. A job already logged is
credited only what its total grew by, so nothing is counted twice. `--tokens` on a task or ticket move
replaces the figure. A row without a figure (`null`) is not a row that cost nothing; it is a row
nobody measured.

## The dashboard

The dashboard is the Bridge, which the live Overseer serves at its URL and keeps current over its event stream.
Open it with `agent-progress open`, which is refused `overseer-down` when no Overseer serves the board.
`.agent-progress/progress.html` is only a stub, written by `init`, `update` and `oversee`: "Live at <url>" while an
Overseer serves the board, "Overseer down" with the command that starts one otherwise. Nothing renders it from the
store; the monitor registry's `progressHtml` names it.

The tabs are **Kanban · Progress · Tickets · Agents · Questions · Assistant · Intake**, in that order. Each is a
hash route, `#<tab>` or `#<tab>/<item>` (`#tickets/42`, `#agents/J12`), so a link survives an Overseer restart; a
fragment naming no tab opens the tab last chosen, kept in the browser, or else Kanban. Until the Overseer's first
board arrives the panel says it is waiting for it; while the event stream is down a banner says the Overseer is
unreachable and as of when the board shown dates. Every control posts a command to the Overseer and shows its
refusal verbatim.

- **Kanban tab**: epic chips over seven lanes — Drafts, Ready, Building, In review, Merge queue, Done and Abandoned
  — each ticket in the lane its stored status names, a ticket the merge queue holds in Merge queue, and a filing
  draft in Drafts with its state line. Ready runs in the Board's order to take its tickets, then by priority and id;
  Merge queue in its queue order; Done and Abandoned newest first, the latest 15, then 25 more at a time, Abandoned
  folded until clicked. A card shows its id, size, a priority other than normal, a type other than ticket, `needed
  first` when a ticket depends on it, `↦ N` for the open tickets waiting on it directly or further down the chain,
  its tokens, title, epic chips, `waits on #N` and `held`. A card whose state moved since the previous board is
  marked once, and pointing at a card draws arrows from the cards it depends on. A draft ticket's card has Ready, and
  Ready selected readies every one checked; a Ready card has Hold or Unhold and a Priority button per other
  priority. On a board with dependencies Ready is ordered Filed or By wave, in waves headed with their width, the
  first also with how many are ready. The pressed epics, the Ready order, the closed lanes' pages and the fold are
  kept in the browser. Above the lanes, Merge queue (`#kanban/merge-queue`) opens per target the Airlock holder and
  its phase, the waiting candidates in the order the Overseer computed, git's predicted conflicts and why its
  landings wait.
- **Progress tab**: the Gantt chart, one row per task with its label, chip and bar, one segment per phase it went
  through, and a now line; a row's label opens its ticket. A ticket's review passes are drawn as segments on its own
  row; "Review passes as rows" in the chart head's Row options menu draws each as a row of its own instead, and
  "Wide titles" widens the name column. On a board with epics the rows are grouped under a head per epic, then "No
  epic", and a head folds its rows away. Below the chart, when any ticket depends on another, the dependencies
  view: a Done column of the settled tickets the open ones build on, then one column per wave; pointing at a ticket
  lights it, everything it depends on and everything waiting on it, and dims the rest, and a click opens it. Below
  that, the finished-work choice (the last hour, day, the default, 3 days or all; a 6 or 12 hours chosen before
  still applies) with how many tickets it hides, the Epics cards — one per shown epic, open ones first, with its
  roll-up, facts, description and tickets, newest first — and the delivered and abandoned tickets the choice lets
  through. The range, the name column, the folds, the review-rows choice and the finished-work choice are kept in
  the browser.
- **Tickets tab**: the search, the Type, Epic (on a board with epics) and Status chips with their counts, and a
  table sortable by id, title, epic, type, status and branch. Chips are OR inside a group and AND across the groups
  and the search; a query of digits looks for an id alone. On a board with epics the table can be grouped by epic, a
  choice kept in the browser. A row opens its ticket's detail panel (`#tickets/<id>`).
- **Agents tab**: every job on the board, ticking each second: its kind, tickets, state, phase, calls, tool calls,
  tokens, last tool call, silent sweeps and Watcher, with its subagents. `#agents/<job>` adds that job's controls
  (Send message, Send answer to its open question, Wind down, Stop, Fresh agent) and its transcript, streamed live.
- **Questions tab**: every open decision, `agent-question` first and the ones an Assistant escalated marked, the
  answered ones below, the open notices, and the Low-priority triage list, where a ticket is readied, edited or
  abandoned. Browser notifications are allowed from a click here, never asked for on load.
- **Assistant tab**: the live Assistant session's transcript, its open incidents, the handled ones with the moves
  and escalations made under them, each applied default in the warning state, and a chat box. While no session is up
  it says a fresh one is booting.
- **Intake tab**: New request starts a product-owner session; each session shows its transcript, its questions
  inline, the drafts it filed, a chat box and Close intake, which opens the `ready-drafts` decision. A closed
  session keeps its transcript and chat, and a message resumes it.
- **The header** above the panel: the project name; the Overseer's state (serving, held for an install change,
  handing over, down) with Pause or Resume, Restart only while new code is on disk, and Stop Overseer behind a
  confirmation; the new-code notice; the concurrency limit, "agents at most", which Set changes; the usage window;
  six figures: agents working, done today, tokens today, waiting in queue, open questions and open incidents; the
  tabs; the Auto · Light · Dark theme switch, kept in the browser; and the open warnings and notices.
- **Embedded mode**, for agent-dashboard framing the Bridge: `?embedded=dashboard` (that literal value only, read
  once before the first paint) hides the header. The Bridge takes the theme from, and sends Esc to, the framing
  parent by `postMessage`, at that parent's origin only, and Esc closes an open panel first. Only the origins in
  agent-dashboard's `server.json` may frame it (`frame-ancestors`). Any other value, or none, is the normal page.
- **The detail panel** of a ticket (`#tickets/<id>`), opened from the Tickets table, a chart label, a wave or an
  epic card: its head and facts, a Timeline of the phases its row recorded, the controls its status offers, its
  Description, and the Log lines the tool wrote by its task and ticket ids. Close returns to the table.
- **The range menu**, opened from the range button in the chart's head: the presets Fit · 1h · 4h · 12h · 24h · 7d,
  then Custom… with free-text bounds that accept `start`, `now` and `-2h` as well as timestamps, and a tick-step
  selector. Fit, the default, spans the rows shown, and the default stored by `agent-progress range` takes its place
  when there is one. Any other choice holds until Fit is pressed again, and is kept in the browser.
- **Stamps are as short as the day allows**: one from today shows only its clock (`21:56`), one from
  another day of the year its month and day too (`09-17 23:48`), one from another year the full date;
  hover a shortened one for the full stamp.
- **A ✓ beside a delivered pill** when that task was reviewed before it was delivered; hover it for
  the review time. A delivered task without it went straight from in-review to delivered.

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
`agent-progress task deliver <id>`. A review job's bar is closed by the Overseer's landing; the
orchestrator closes every row left open, and a chart whose rows stop at `Awaiting review` is a chart
nobody closed.

## Files on disk

```
.agent-progress/
  progress.json          the rows, the view, the limits
  log.jsonl              the log, one record per line
  progress.html          the stub naming the live Overseer's URL, or saying it is down
  agent-brief.md         the orchestrator's brief, rewritten by init and update
  builder-brief.md       the builder's brief, rewritten by init and update
  review-brief.md        the reviewer's brief, rewritten by init and update
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
  "overseerState": "running",                      // optional: running|paused, absent reads paused
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
      "interruption": "reboot",                  // optional: watcher-lost|agent-crashed|reboot|answer-delivery|usage-limit|handoff-red, why it was last interrupted
      "watcherInstance": 1,                         // the newest Watcher instance spawned or to spawn, from 1
      "eventCursor": { "instance": 1, "sequence": 12 }, // the last Watcher event applied
      "answeredRequestIds": [],                  // the question requests already answered
      "crashResumes": 0,                         // resumes after watcher-lost or agent-crashed only
      "airlock": { "target": "main", "targetTip": "a1b2c3d", "branchTip": "b2c3d4e", "phase": "merge-in" } // optional: while it holds its target's slot; phase merge-in|resolving|reviewing-resolution|gating|fixing|landing
    }
  ],
  "nextDecisionId": 3,                           // optional: the number the next decision takes (E3), written by the first opening, never wound back
  "decisions": [                                 // optional: the open decisions for the user in opening order, written by the first opening
    {
      "id": "E2",
      "kind": "agent-question",                  // agent-question|ready-drafts|parked|waiver|landing-refused|merge-refused|checks-not-set|target-moved|branch-touches-agent-config|outage|quiet-job|leftover-worktree
      "ticketIds": ["003"],
      "jobId": "J4",                             // or null
      "askedBy": "builder",                      // a job role, Overseer or orchestrator
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
  "incidents": [                                 // optional: the open incidents for the Assistant in opening order
    {
      "id": "I1",
      "kind": "setup-failed",                    // system-question|malformed-ticket|setup-failed|out-of-calls|blocked|job-lost|resume-failed|gate-cannot-run|merge-gate-failed|resolution-over-threshold|quiet-job|findings-delivered
      "ticketIds": ["003"],
      "jobId": "J4",                             // or null
      "facts": { "step": "install" },            // text the Overseer names; requestId when a question opened it
      "defaultMove": "worktree-repair",          // the move it takes when its delivery turn closes unhandled
      "deliveredInTurn": null,                   // or { "jobId", "chatSequence" }: the orchestrator's chat turn it went out in
      "openedAt": "2026-09-18T21:41:00+02:00"
    }
  ],
  "overseerFirstStartedAt": "2026-09-18T21:00:00+02:00", // optional: the Overseer's first start on this board, kept by clear
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
      "agent": "003",                            // optional: the ids one claim started, joined; one slot
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
      "pipelineHash": "0f871814e52ef878"         // optional: the content hash of the pipeline the row's ticket was last gated by
    }
  ]
}
```

A version 2 file holding `log`, or a version other than 2, is unreadable (exit 2). A file at version 1,
written before the log moved to `log.jsonl`, is not read: its reason ends in the advice to run
`agent-progress update` with a release that still reads it, which rewrites it as version 2. Keys the tool
does not know survive a read and a write, at the top level and on a row, in the file's order, as a
ticket's unknown frontmatter lines do.

A present `concurrencyLimit` that is not a whole number of at least 1, a `overseerState` outside
the two, or a
`nextDraftId` that is not a whole number of at least 1 makes the file unreadable (exit 2), and so does a
present optional row key of the wrong shape: `reviewRound` below 2, `reviewBarRound` below 1, a row
`pipelineHash` that is not text, or a
`history` that is not a list of known statuses with their stamps, or a `mergeQueued` that is not `true`. A task is
linked to at most one ticket. Task ids are never reused, not even after `task remove` or `clear`.

A file holding `checkCommand`, `installCommand`, `checksDefinitionFiles`, `gateKeyCommand` or `gateCachePaths`, or a
row holding `checkCommand`, which the retired `checks` verb wrote, is an older file: its reason names the key and ends
in the advice to run `agent-progress update` with a release that still reads it. The gate pipeline lives in
`pipeline.json`: `prepare` (steps of `name` and `run`), `gates` (in run order, each `name` and `run`, with optional
`fix`, `in`, `definedBy`, `network`, `writes` and `overseerOnly: true`), and optionally `review` (`name`, `model`,
`effort`), `constitution` (a list of files) and `agents` (a list per role: `builder`, `reviewer`, `merger`,
`productOwner`, `onboarder`, `assistant`). An unknown key, a step or gate without `name` or `oversee`, or a name given
twice makes it malformed: the board reads it as no pipeline, `gate list` and every `gate` write refuse it at exit 1.

The pipeline says what each agent is told. The builder, the reviewer and the merger (the resolver, the merge-gate fixer
and the resolution reviewer) get the `constitution` files first, then their role's own; the product owner and the
Assistant get only their own. An absent `constitution` is `.agent-progress/briefs/defaults/constitution.md`, an absent
`agents.<role>` `.agent-progress/briefs/defaults/<role>.md`; a listed array replaces its default, so listing the default
then another file extends it. A session reads exactly these files, in order, and nothing found by folder convention.
Paths are relative to the repository root: one under `.agent-progress/` is read from disk, any other is tracked and
read from the main line at each launch and resume, never from the ticket's branch, so a changed file, default or
`pipeline.json` reaches the next one. The files are joined and their placeholders filled: a builder's and a reviewer's
are its first message, every other role's its role brief. One that is missing, or a path leaving the repository,
refuses the launch: nothing is spawned, `oversee status` shows the `instructions-missing` notice naming the job and the
path, and every pass tries again. Each launch writes `jobs/<J>/instructions-<instance>.json`, `{ files: [{ path,
contentHash }] }`, the first 16 hex digits of each file's SHA-256 as it was read. Check V11 refuses a job
(`instruction-file-changed`) when a commit in its range changes a tracked file any array names that its ticket body
does not name.

`jobs`, `nextJobId` and a row's `mergeQueued` are each written only once set, so a file without them stays
byte-identical; keys the tool does not know on a job, its `eventCursor` and its `airlock` survive in the file's order. A
`nextJobId` below 1, or a job whose field is missing, outside its vocabulary or of the wrong shape, makes the file
unreadable (exit 2). Job ids are `J<n>`, never reused or gap-filled. A job ends only through `job-ended`, which takes it
off `jobs` in the same write; a later move of an ended job is refused `job-finished`, and a move the job's state does
not allow `job-move-illegal`. A job's state lives here and is never logged; no process identity is stored on the board.
A job's optional `stopRequest` (`stop`, `wind-down` or `fresh`) is written once User asked it, and a product-owner
job's `intake` holds `{text}`, then `proposedDraftSets` once its intake closed and `carriedAnswers` on a fresh session
that took over a replaced one.
A `dispatcherState` or `dispatcherRunId` the retired Workflow dispatcher stored is an unknown key: kept
byte for byte and never read, so a board it ran on reads as paused until `oversee resume`.

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

`overseerFirstStartedAt` is written once, by the Overseer's first `overseer-started` on the board, and never rewritten;
`clear` keeps it. Only a start on a board with neither it nor a `overseer-started` log record holds every low `pending`
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
| `ticket-check-command-restamped` | `ticketId` | `command` (the line stamped on its row, or `null`); retired: still read, never logged |
| `epic-added`, `epic-edited` | `epicKey` | `title` |
| `epic-removed` | `epicKey` | none |
| `review-bar-started`, `review-bar-closed` | `taskId`, `ticketId` | `name` |
| `review-recorded` | `taskId`, `ticketId` | `round` (the bar's, from 1), `verdict`, `reviewStartCommit`, `fixReworkedCodeLines`, `rebaseReworkedCodeLines`, `totalReworkedCodeLines`, `builderChangedFiles`, `builderInsertions`, `builderDeletions`, `claims` and `findings` as the reviewer's findings file holds them, logged by the lifecycle service as it records a review's outcome |
| `chart-range-set` | — | `view`, shaped as `progress.json`'s |
| `concurrency-limit-set` | — | `limit` |
| `pipeline-prepare-step-set`, `pipeline-gate-added` | — | `name`, `run` (the step's or gate's command) |
| `pipeline-gates-none` | — | none |
| `pipeline-gate-removed` | — | `name` |
| `check-command-set` | — | `command` (the shell line, or `null` when cleared); retired: still read, never logged |
| `install-command-set` | — | `command` (the install line); retired: still read, never logged |
| `checks-definition-files-set` | — | `patterns` (empty when cleared); retired: still read, never logged |
| `gate-key-command-set` | — | `command` (or `null` when cleared); retired: still read, never logged |
| `gate-cache-paths-set` | — | `paths` (empty when cleared); retired: still read, never logged |
| `gate-ran` | — | `tree` (the gated tree's object id), `outcome` (`passed`, `failed`, `cannot-run`), `cached` (always false now that no gate result is kept; true only in older logs) |
| `overseer-set` | — | `state` (`running` or `paused`) |
| `dispatcher-set` | — | `state` (`running`, `finished` or `stopped`), `runId` (a run id or `null`); retired: still read, never logged |
| `tracker-cleared` | — | none |
| `agent-stopped` | — | below |
| `overseer-started` | — | `codeVersion`, `installVersion` |
| `overseer-stopped` | — | `reason`: `stopped` or `handed-over` |
| `baton-pass-failed` | — | `successorCodeVersion`, `step`, `error` |
| `job-launched` | `jobId` | `kind`, `role` (or `null`), `ticketIds`, `attempt`, `target` and `parentJobId` (each or `null`) |
| `job-interrupted` | `jobId` | `cause`, `watcherInstance`: the instance that was lost |
| `job-resumed` | `jobId` | `watcherInstance`: the instance spawned, `cause`: the interruption it resumes from |
| `usage-limit-hit` | `jobId` | `window` (as the vendor names it, such as `five_hour`), `resetsAt` (ISO): the vendor refused the job's requests, and nothing launches or resumes before `resetsAt` |
| `job-ended` | `jobId` | `outcome`, `cause` and `commit` each only when named, `deniedPermissions` |
| `job-stop-requested` | `jobId` | `mode`: `stop`, `wind-down` or `fresh`, User's `job stop`, `job wind-down` or `job fresh` |
| `job-messaged` | `jobId` | `text`: a chat turn the Overseer writes to the session in log order |
| `job-reopened` | `jobId` | `watcherInstance`: the instance that resumes the closed product owner, `text`: User's message, its first line, `offeredTicketIds`: the tickets its intake filed before, which its next `ready-drafts` skips |
| `merge-started` | `jobId` | `target`, `targetTip`, `branchTip`, `predictedConflictFiles` (empty for a clean prediction): the merge job claimed the target's slot |
| `merge-landed` | `jobId` | `target`, `commit`, `kind` (`landed` on the main line, `integrated` on a group branch): the Overseer's list of tips it landed |
| `ticket-triaged` | `ticketId` | none: a finding put to the user's low-priority triage |
| `decision-opened` | `decisionId` | `kind`, `ticketIds` |
| `decision-answered` | `decisionId` | `answer`: one answer per question, keyed by the question's text |
| `decision-withdrawn` | `decisionId` | `reason` |
| `incident-opened` | `incidentId` | `kind`, `ticketIds` |
| `incident-handled` | `incidentId` | `move`: the move that closed it |
| `incident-defaulted` | `incidentId` | `move`: its default move, `cause`: `turn-closed`, `turn-budget` or `no-assistant` |
| `incident-escalated` | `incidentId` | `decisionId`: the `agent-question` decision it became |
| `hatch-applied` | `jobId` | `requestId`, `commandKind`, `outcome` (`done`, `nothing-to-do` or `refused`): a relayed request the Overseer answered, never applied again |

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
      "lastCommand": "ticket ready"
    }
  }
}
```

The machine-wide registry of every project whose dashboard this machine's agent-progress wrote, in the home folder,
for a monitor to find each project's page and data; a folder, so the monitor can keep its own files beside it. A
project registers, its entry added or updated, exactly when the call wrote its tracker: every mutating command,
though nothing renders, `init`, and the Overseer at its start. `update` never writes the tracker, so it never
registers; neither does a read-only call or `open`. A tracker whose root lies under a temp folder is never
registered: the system temp folder (`os.tmpdir()`, on macOS `$TMPDIR` under `/var/folders`), `/tmp` and
`/var/tmp`, each compared after resolving symlinks (`/tmp` to `/private/tmp` on macOS). An entry already in the
registry stays.

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
filedByJob: "J12"
findingRoute: "assistant"
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
| `filedByJob` | only on a ticket a job filed | the id of the job whose Hatch filed it, written `"J12"`, stamped by the Overseer from the Hatch folder's job, never from the request |
| `findingRoute` | only on a worker's finding | who settles the low draft a builder, reviewer or merge-gate fixer filed: `assistant`, the Assistant once the ticket it was found on is delivered, or `user`, User's Low-priority triage list, for a finding filed with `--needs-user`. Only `ticket triage` changes it afterwards, to `user`; any other value makes the file malformed. |
| `claimedBodyHash` | once the ticket was started | the content hash (64-bit FNV-1a, 16 hex digits) of the body as it read when the ticket last moved to in-progress; absent on a ticket never started. `ticket show` compares it with a hash of the body now to say whether the body changed since. |
| `task` | always | the row's id as an unquoted integer, or `null` for a draft, and for a low ticket filed before install version 17 and never started; a quoted `task` makes the file malformed |

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
started ticket whose body is unchanged since its build started it moves `claimedBodyHash` along. Past `pending`,
`ticket edit` needs `--force`. A malformed ticket file is listed as ignored rather than failing `status`.
A new ticket id is one past the highest of every file name, every parsed id and every ticket a row names;
gaps are tolerated, never filled.

**The Acceptance is numbered.** Each item of `## Acceptance` starts a line with `A1.`, `A2.`, …, its
continuation lines beneath it up to a blank line or the next item; an item is never renumbered and its
number never reused. `A3. Waived: <reason>` marks an item the user waived. A review's `## Review` holds
one line per item, bulleted or not: `A2 holds — <evidence>`, `A2 does not hold — <gap>` or
`A3 waived — <reason>`. A landing reads only the latest `## Review`, a heading inside a code fence not
counting as one: an item is accounted for when the Acceptance marks it waived, or when that Review has a
`holds` or `waived` line for it and no `does not hold` one.

**The Brief is the builder's brief.** A ticket's `## Brief` is what its builder reads as its scope and contract,
beside the Report, Wanted and Acceptance. `ticket ready` refuses a draft whose `## Acceptance` holds no numbered
item (`acceptance-unnumbered`) or that has no `## Brief` holding a non-blank line (`brief-missing`), so every
ticket that builds carries both.

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
standard error rather than failing `status`, and `epic add` refuses to overwrite it. A
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
on standard error by `status` and `draft list`, rather than failing them, and `draft open`
refuses to overwrite it. A closed or abandoned draft's file is removed; the log keeps what it became. A
tracker that never opened a draft has no `filing-cabinet/` folder and no `nextDraftId`.

## Ticket moves and their rows

The **from** column is the matrix the named verbs enforce and the Overseer's moves keep; `ticket status <id> <status>`
skips it. **its row** is the status stored; **pill** is what that row then reads on the chart.

| move | from | ticket status | its row | pill | stamps written | log line |
|---|---|---|---|---|---|---|
| `ticket add` | — | draft | none, at any priority | `Draft` | `filed` | `Ticket #003 filed: <title>` |
| `ticket ready` | draft, for every id named, each with a numbered `## Acceptance` and a `## Brief` holding a non-blank line | pending | created `pending`, at any priority | `To do` | — | `Ticket #003 ready to build`, one per ticket |
| a build job prepares its worktree, or a review finds an item that does not hold | pending; in-review | in-progress | `in-progress`; created for a ticket without one | `In progress` | `started` if null; the row's end cleared | `Ticket #003 started` |
| a build job passes its gate | in-progress | in-review | `in-review` | `Awaiting review`; `Reviewing` while a review bar of the ticket is in progress | `finished` if null | `Ticket #003 in review` |
| a review job launches | in-review | in-review, unchanged | `in-review`, plus an in-progress review row for the job's round | `Reviewing` | — | `Review row #18 started: <name>` |
| a group ticket's merge lands on its group branch | in-review | reviewed | `reviewed`, its `reviewed` stamp set if unset | `Awaiting merge` | `finished` if null | `Ticket #003 reviewed` |
| a merge lands on the main line | in-review; reviewed for a release bundle's ticket landed with its group's release ticket | reviewed (unless already), then delivered | `delivered`; in-progress review rows delivered | `Done` | `finished` and `delivered` if null; `branch`, `commit` | the reviewed and delivered lines, and one per review row closed |
| `ticket deliver --by-hand` | anything but draft, while no Overseer is live and no job of the ticket is | delivered | `delivered` | `Done` | `delivered` if null | `Ticket #003 delivered` |
| `ticket abandon` | anything but delivered, abandoned | abandoned | `abandoned`; none created for a ticket without one | `Abandoned` | `abandonedAt`, always; the row's end if it had started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | anything but draft and pending; a group's release ticket only while no other release ticket of its group is open | pending | `pending`, its start, end, `reviewed` and `reviewRound` cleared | `To do` | all four cleared; `reason` dropped | `Ticket #003 reopened` |
| `ticket priority … low` | draft, pending | unchanged | kept | — | — | `Ticket #003 priority normal → low` |
| `ticket priority` from low | any | unchanged | created when it has none and is not a draft: `pending` while the ticket is pending, else seeded from its stamps | per status | — | `Ticket #003 priority low → normal` |

A closing stamp is written only while it is still null, while `abandonedAt` is written every time:
re-entering a status is a correction, abandoning twice is deciding twice. Every move to a status other
than in-review finishes and delivers the ticket's in-progress review bar, with one log line each.

Filing the row is the first entry in its `history`, and each move appends another, so the detail
panel can say when the row reached each state and how long it sat there — the wait
between `To do` and `In progress` being the queue time. `task update --status` is not appended: it
corrects a row rather than moving it.

Moving a ticket to the status it already has is refused and logs nothing; a review round is counted on its review
bar, never as a move. A ticket taken straight to in-review, reviewed or delivered with `ticket status`, having
never started, gets a row whose start is stamped along with its end — an end without a start would draw from the
origin of the chart. There is no `paused` ticket status: `task pause <id>` records a waiting row and the ticket
stays where it was.

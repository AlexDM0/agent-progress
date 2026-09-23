# agent-progress

A Bun + TypeScript CLI that tracks an AI orchestrator's work per repository: tasks as rows on a
Gantt chart, stateful markdown tickets, a log, and a self-contained `progress.html` regenerated on
every command and reloading itself every 5 minutes.

An orchestrator registers a row before it spawns each subagent and moves it when the result lands;
it files a ticket for every bug, change or feature the user reports; the person watching keeps one
browser tab open and sees the work happen. Nothing is edited by hand.

## Install

```sh
git clone <this repository> agent-progress
cd agent-progress
./setup.sh
```

`setup.sh` does three things and nothing to any repository: it checks for Bun ≥ 1.2 (offering the
official installer), runs `bun install` and `bun link` so the global `agent-progress` command works
from any directory, and symlinks the two bundled Claude Code skills into `~/.claude/skills/` —
`agent-progress` at this checkout's `skill/` and `agent-progress-orchestrate` at its
`skill-orchestrate/`. It is idempotent, it replaces a stale link, and it refuses to delete a real
directory it did not write — it warns instead. `./setup.sh --instruct-only` changes nothing and
prints what it would do.

They are symlinks rather than copies so that an edit reaches every session immediately and a
`git pull` needs no install step. If you also use the `claude-skills` repository, its `install.sh`
adopts every skill it finds under `~/.claude/skills/` unless the name is in its `skills.json`
ignore list — so both names belong there, and `setup.sh` warns when one is missing.

## The two skills

They are split by audience, because the first one's trigger fires in **every** session in a tracked
repository — including every implementing subagent, each of whose API calls re-reads its whole
context.

- **`agent-progress`** is what any session needs: the mental model, how to file and move a ticket,
  what an implementing agent owes its ticket's `## Handoff`, and the rules. It lists no commands —
  `agent-progress help` is the reference, printed by the tool and so never out of step with it — and
  `skill/Reference.md` beside it holds what the help does not print: the ticket file format, the
  transition table, the time axis and the exit codes.
- **`agent-progress-orchestrate`** is for the one session running the board. Start it with
  `/agent-progress-orchestrate`: it opens the dashboard, reports what is in flight and then takes
  ticket requests — grilling each one until the acceptance condition is unambiguous, filing it,
  dispatching an implementing agent for it (at most two at a time) — each on a worktree of its own,
  never the main checkout — that hands over a branch already rebased onto main, and sending that to a clean reviewing agent. The reviewer reviews adversarially,
  fixes everything it finds and rebases onto main again; it then releases the branch itself, on the
  orchestrator's grant of the one merge-to-main slot; only a finding far outside the ticket that is
  also a lot of work comes back as a ticket. A second review (`ticket rereview`) happens only when the
  pass reworked over 750 lines of code, comments and documentation not counted, in its fixes and rebase, and is the orchestrator's call, which grants it or files a new ticket instead,
  until every ticket is delivered. It loads the first skill for the
  commands and repeats none of it.

## Adopting a repository

```sh
cd <the repository to track>
agent-progress init
```

To pick up a newer brief or CLAUDE.md block later, run `agent-progress update` — never `init` again,
which reads as destructive and refuses in places `update` does not. It is described below.

`init` writes four things:

- **`.agent-progress/`** at the repository root, holding `progress.json`, a `tickets/` folder, the
  generated `progress.html` and the lock file. The root is found with
  `git rev-parse --git-common-dir`, so **every worktree of the repository shares one tracker**.
- **`.agent-progress/agent-brief.md`** (from `templates/AgentBrief.md`), the brief an orchestrator
  fills in before it spawns an implementing agent: the scope, the facts it needs instead of a reading
  list, how many calls and browser calls it may spend, when to stop, and what to report. It is
  guidance shipped with the tool rather than a file a project edits, so every `init` and every
  `update` rewrites it.
- **a `.gitignore` entry** for it — but only when the repository does not already ignore it.
  `git check-ignore` decides, so a repository covered by a broader pattern, a parent `.gitignore`
  or `.git/info/exclude` gets no diff at all.
- **a managed block in the repository's `CLAUDE.md`** (from `templates/ClaudeInstructionsBlock.md`),
  between `<!-- agent-progress:managed:start -->` and `<!-- agent-progress:managed:end -->`, telling
  the next agent to track its work through the tool. The file is written **in place**, so a
  symlinked `CLAUDE.md` stays a symlink; a start marker with no end marker is refused and the file
  is left alone. `--no-claude-md` skips it.

A fifth thing goes in by default: a `SubagentStop` entry running `agent-progress hook subagent-stop`,
under an empty matcher so every subagent type is recorded. It is written into
**`.claude/settings.local.json`** — the per-user file Claude Code applies over the shared one and
keeps out of git — so an accurate token figure needs no flag and lands in nothing colleagues share.
A repository that already keeps this hook in the shared `.claude/settings.json` has it kept current
there instead: never moved, never a second copy that would log every agent twice. Either way it
merges into whatever that file already holds, is never added twice, refuses a document it cannot
parse rather than replacing it, and writes nothing when the entry already says what it should; the
command prints the path and one of `installed`, `updated` or `unchanged`. `--no-hooks` opts out on
both `init` and `update`. `--hooks` is still accepted and does nothing — the hook it used to ask for
is now the default.

Claude Code adds `**/.claude/settings.local.json` to your global git excludes the first time it
writes that file itself. If it has not yet, and the file this tool creates shows up in `git status`,
ignore it the way you ignore any personal file; this tool writes no `.gitignore` entry for it.

`init` is refused when an ancestor directory already holds a tracker. Re-running it at a root that
already has one does exactly what `agent-progress update` does, and says so.

## The Handoff and the token column

A ticket's body ends with a **Handoff** section, written by the agent that implemented the ticket as
the last thing it does: the files it touched, anything it learned that the ticket did not say, what
is verified and how, and what is not. The point is that the review pass and whoever picks the work up
tomorrow read fifteen lines instead of re-deriving them from the diff — which, for an AI agent, is
the difference between a short session and one that re-reads a repository.

The same thrift is why every row carries a token count, shown beside the bar. With the `SubagentStop`
hook installed it fills itself in: a brief names its row on a line of its own,
`agent-progress row: 4` (`4, 7` for a bundle), and when the agent stops the hook adds its `input`
figure — every token it processed — to that row, so the orchestrator passes no `--tokens`, which
would replace the sum. Without the hook, `--tokens` stores the harness's own `subagent_tokens`, which
reports roughly the agent's end context rather than everything the agent read to reach it. A row
left without one is not a row that cost nothing — it is a row nobody looked at, and a
chart full of those is how the expensive habits stay invisible.

## The dashboard

`.agent-progress/progress.html` — one file, no CDN, no server. Open it with `agent-progress open`.

- A **Progress** tab: the Gantt chart, one row per task, newest on top, with its number, name, ticket badge, token
  count, status pill and bar, a now-marker, and the log underneath, newest first.
- A **Tickets** tab: a summary table, then one card per ticket with its body rendered as markdown
  (`done`, `delivered` and `abandoned` collapsed). The chosen tab and the open cards are kept in the
  browser, so the refresh lands where you were.
- **A pill naming the state the row is actually in, where `done` means merged.** The stored status
  and the word on the pill are not the same vocabulary, because a row that is `finished` is not
  finished with — it is waiting for somebody:

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

  The summary above the chart reads the same way: `<merged>/<total> done`, then how many are
  awaiting a merge and how many are in review. A row with nothing to merge — a review pass, a
  chore — still reaches `done`, through `agent-progress task deliver <id>`; that is the
  orchestrator's job, and a chart whose rows stop at `awaiting review` is a chart nobody closed.
- **Double-click any row** — in the chart or in the ticket table — for the whole story of that task
  in one panel: its facts, every phase it went through with how long it sat in each, the ticket
  with its body, and the log lines that name either. A row filed before phases were recorded says
  so and shows what can be derived from its stamps instead. Esc, the backdrop or the × closes it.
- A **range bar** with the presets Auto · 1h · 4h · 12h · 24h · 7d · All, free-text bounds that
  accept `start`, `now` and `-2h` as well as timestamps, and a tick-step selector. A viewer's choice
  is kept in their browser and survives the refresh; Auto hands control back to the default stored
  by `agent-progress range`.
- **Done work older than a day is hidden**: reviewed, delivered and abandoned tasks, and done,
  delivered and abandoned tickets, leave the chart and the ticket list a day after they closed.
  **Show all** brings them back; the choice is kept in the browser.
- A **✓ beside a delivered pill** when that task was reviewed before it was delivered; hover it for
  the review time. A delivered task without it went straight from finished to delivered.
- An **error banner** when a command wrote the store but could not rebuild the page script.

## Commands

`<when>` is an ISO 8601 timestamp, `now`, or an offset from now: `-5m`, `-2h`, `-1d`, `+30m`. `<n>`
on `--tokens` is a whole number or a decimal with a `k`/`m` suffix: `12000`, `12k`, `12.3k`, `1.2m` —
a figure the orchestrator reports, never one this tool measures. Every mutating command takes the
lock, writes the progress file atomically and regenerates `progress.html`. `agent-progress help`
prints this same reference, and `--help` works after a command word too.

`AGENT_PROGRESS_ROOT` names the repository to use instead of walking up from the current directory,
for a command run from somewhere else entirely. It does not create a tracker: a value naming a
directory that has none is refused with a message saying the variable is set.

| command | what it does |
|---|---|
| `init [--project <name>] [--root <path>] [--no-claude-md] [--no-hooks]` | Create the tracker here: `.agent-progress/` with an empty progress file and a `tickets/` folder, a `.gitignore` entry for it, a managed block in the repository's CLAUDE.md, and the SubagentStop hook. Refused inside a bare repository, and when `--root` is not an existing directory. `--project` names the project shown on the page, `--root` tracks that directory instead of the discovered repository root, `--no-claude-md` leaves CLAUDE.md alone, and `--no-hooks` writes no hook. `--hooks` is still accepted and does nothing. Re-running it refreshes exactly what `update` refreshes, and `update` is the command for that. |
| `update [--no-claude-md] [--no-hooks]` | Refresh what the tool wrote into a repository it already tracks: the managed CLAUDE.md block, `agent-brief.md` and the SubagentStop hook. It creates no tracker and touches neither the progress file, the tickets nor the log, so it takes no `--project` and no `--root`, and where there is no tracker it is refused with exit 1 naming `agent-progress init`. Each line says whether that file changed — `unchanged`, or `updated` with the brief adding "re-read it before your next brief" — so a session that read the brief at its start learns its copy is stale. |
| `status [--json] [--full]` | The project, the counts, the rows that are not delivered or abandoned, and the last log entries newest first. `--json` prints the same working view — the unsettled rows and tickets, the last 10 log entries, and an `omitted` object counting what was left out — which is the form an agent reads at the top of a session. `--full` lists everything, and with `--json` prints the progress file itself plus every ticket's frontmatter. |
| `task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--start] [--tokens <n>] [--at <when>] [--force]` | Add a Gantt row. `--start` marks it running at `--at` (default now), `--ticket` links it to a ticket that has no row of its own, `--note` is the detail shown beside the bar, and `--tokens` records what the work cost. `--force` moves `--ticket`'s link off the row that holds it. |
| `task start\|pause\|finish\|review\|rereview\|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]` | Move one row and stamp it: `start` sets its start and resumes a paused row, `pause` records that the work is waiting without closing the bar, `finish` and `review` set its end, `rereview` sends a row whose review found too much into its next review pass — round 2, then 3 — without reopening the bar, and `deliver` records that the work reached its destination. A stamp already recorded is kept, so `--at` backfills a row nobody registered at the time. A row a ticket owns is refused, naming the `ticket` verb that moves both; `--force` moves only the row. |
| `task update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]` | Change a row without moving its clock. At least one field is required, and `--status` on a row a ticket owns is refused unless `--force`. |
| `task remove <id>` | Delete a row. A ticket pointing at it is unlinked rather than deleted. The id is never given to another row. |
| `log "<text>" [--at <when>]` | Append one line to the log shown under the chart. `--at` backfills it. |
| `hook subagent-stop` | Record what a finished subagent cost, as one log line: the hook JSON arrives on standard input, and the agent's transcript is summed per API call rather than per line. When the agent's first message — its brief — holds a line `agent-progress row: <id>`, or several ids separated by commas, the log line's `input` total is also added to those rows' tokens, divided evenly. This is the command `init` and `update` wire into `.claude/settings.local.json`; nobody types it. It exits 0 whatever goes wrong — no input, an unreadable transcript, no tracker at the hook's own working directory, a row that does not exist — and writes the reason to standard error. Its exit code prevents nothing, since the agent has already finished; exiting 0 is what keeps a failure here from becoming an error the orchestrator must read, or a delay before it is told its agent is done. |
| `usage [--since <when>] [--transcripts <folder>] [--json]` | What this repository's subagents cost, read out of the transcripts the harness wrote for them under `~/.claude/projects/`: one row per agent, oldest first, with its start, its API calls, its end context, its input and output, its browser calls, the characters the harness injected into it and the first line of its brief; then the cohort summary — median calls and end context, mean input and output, and the mean of each figure below. Three of the columns catch a brief being breached without anyone reading a transcript: `over 200k` is the share of the agent's input that was sent at a context past 200,000 tokens, `bash edits` counts the edits it made through a shell command — a heredoc, an inline interpreter or an in-place editor — instead of through the editing tools, and `checks` counts the full test, type-check and lint runs it made per edit instead of per batch. `--json` carries the oversized figure as a raw token count rather than as a share. `--since` splits the cohort on an instant and summarises both sides. `--transcripts` reads a folder other than the one this repository's path resolves to. It writes nothing and takes no lock, and a repository with no transcripts is one sentence at exit 0. |
| `rework [--since <commit>] [--rebased-from <old tip>] [--main <branch>] [--worktree <path>] [--files] [--json]` | How many lines of code a review reworked on a branch, so that a threshold on it gives every reviewer the same verdict; the tool only counts. Added plus removed lines, never blank lines, comments or documentation (`*.md`, `*.mdx`, `*.rst`, `*.txt` and anything under the repository's `docs/`). `--since` counts every commit in `<commit>..HEAD` and is refused at exit 1 when `<commit>` is not an ancestor of HEAD or a merge lies in between, since work is rebased rather than merged. `--rebased-from` counts what a rebase changed in the branch's own work — the hand resolution of its conflicts — as the changed lines in which the branch's patch against `--main` (default `main`) differs before and after the rebase; a rebase without conflicts counts 0. A rebase rewrites the commits after `<commit>`, so count `--since` before rebasing and `--rebased-from ORIG_HEAD` after, or rebase first and take `<commit>` from the rebased tip, in which case both in one call print one total and the two parts. Comments are read per file type — `//` and `/* */`, `#`, `<!-- -->`, Python docstrings, a `<script>` or `<style>` inside HTML — a line of code with a trailing comment is code, and a file type it does not know counts every non-blank line. `--worktree` reads that working tree instead of the current directory, `--files` adds a per-file breakdown. It needs no tracker, takes no lock and writes nothing. |
| `ticket add "<title>" [--type bug\|change\|feature] [--group <name>] [--depends-on <ids>] [--body <markdown>] [--body-file <path\|->] [--at <when>]` | File a ticket: a markdown file under `.agent-progress/tickets/` with its own frontmatter, plus a pending Gantt row. The body comes from the template, from `--body`, or from `--body-file` (`-` reads standard input); afterwards it is preserved byte for byte. `--depends-on 3,4` files it already waiting on those tickets. |
| `ticket list [--status <s>] [--json]` | The tickets with their type, status, group and row id. `--json` carries no bodies; use `ticket show` for one ticket's prose. |
| `ticket show <id> [--json]` | One ticket: its frontmatter, its body, and always its file path. |
| `ticket start\|review\|done\|deliver\|abandon\|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]` | Move a ticket and its Gantt row together, stamping both, and set the row's token count. Each verb only moves a ticket that is in a status it makes sense from (see the table below), and a move to the status a ticket already has is refused. `abandon` requires `--reason`; `reopen` clears the stamps and returns the row to pending. |
| `ticket rereview <id> [--at <when>]` | Send a ticket already in review round again, for a fresh reviewer: the ticket stays in-review and only its `updated` moves, while its row goes one review round up, from 2, and the log says which round it is. It is the one verb legal on the status the ticket already has, and it is refused from every other status. It takes no `--tokens`: the row's figure is the builder's, and a review pass has its own row. |
| `ticket status <id> <status>` | The same move, naming the target status directly: open, in-progress, in-review, done, delivered or abandoned. The documented way to make a move the verbs refuse. |
| `ticket link <ticketId> <taskId> [--force]` | Point a ticket at an existing row instead of the one it filed. Refused when that row already belongs to another ticket, unless `--force`. |
| `ticket depends <id> [<id>...]` | Set the tickets this one waits on, replacing its list; no ids clears it. A missing ticket or a circle is refused. Until they are all done or delivered, the ticket reads "waiting on #003" on the dashboard and in `ticket list`, and `ticket start` warns but still moves it. |
| `range --from <when> --to <when> [--tick <15m\|1h\|1d>]` · `range --auto` | The stored default axis of the chart. A relative bound is stored as written, so `--from -2h` keeps meaning "the last two hours" on every refresh. |
| `render` | Regenerate `progress.html` from the progress file and the tickets, changing nothing else. |
| `open` | Open `progress.html` in the default browser. |
| `clear [--all] [--yes]` | Throw away every task row and the log and restart the clock, keeping the tickets: each surviving ticket is given a fresh row seeded from its own frontmatter, with a new id — row ids are not reused. `--all` deletes the tickets too and restarts their ids at 001. `--yes` is required when standard input is not a terminal. |
| `help` | This command reference. |

Exit codes: **0** done or nothing to do · **1** a refusal the caller can act on (no tracker here, no
such row, a missing `--reason`, an unknown command) · **2** a state the tool will not repair on its
own (an unreadable progress file, a lock it could not take).

## File formats

### `.agent-progress/progress.json`

```jsonc
{
  "version": 1,                                  // guards a future migration
  "trackerId": "…",                              // namespaces the page's localStorage per tracker
  "project": "Example Agency",
  "startedAt": "2026-09-18T20:55:10+02:00",
  "view": { "kind": "auto" },                    // or absolute/relative bounds with an optional tick
  "nextTaskId": 18,                              // never wound back, so an id is never reused
  "tasks": [
    {
      "id": 17,
      "name": "Rewrite the importer",
      "status": "running",                       // pending|running|paused|finished|re-review|reviewed|delivered|abandoned
      "start": "2026-09-18T21:30:54+02:00",
      "end": null,
      "owner": "opus",
      "note": "",
      "ticket": "003",                           // or null
      "tokens": 48000,                           // or null: "nobody said", which is not "it used none"
      "reviewed": "2026-09-18T22:10:00+02:00",   // absent until the row is first reviewed; kept through delivery
      "reviewRound": 2,                          // absent until a second review pass is asked for: 2, then 3, kept as history
      "history": [                               // every status the row really reached, oldest first, starting with the
        { "status": "pending",                   // moment it was filed — so the panel can say how long it sat in the
          "at": "2026-09-18T21:12:00+02:00" },   // queue. Absent on a row filed before the field existed, and the
        { "status": "running",                   // panel says so rather than quietly guessing.
          "at": "2026-09-18T21:30:54+02:00" }
      ]
    }
  ],
  "log": [{ "at": "2026-09-18T21:30:54+02:00", "text": "Wave 1 landed." }]
}
```

Timestamps carry the offset of the machine that wrote them and are displayed as written, never
re-parsed into a viewer's zone.

### `.agent-progress/tickets/003-double-click-a-role-to-edit-it.md`

```
---
id: "003"
title: "Double-click a role to edit it"
type: change
status: in-progress
filed: 2026-09-18T20:11:03+02:00
updated: 2026-09-18T20:40:00+02:00
started: 2026-09-18T20:40:00+02:00
finished: null
delivered: null
abandonedAt: null
group: role-editor
branch: ticket/role-editor
task: 17
---
# 003 — Double-click a role to edit it

## Report
…
```

Frontmatter is a deliberately small YAML subset: one `key: value` per line split at the first
`': '`, values being `null`, an integer, a double-quoted JSON string or an unquoted scalar. There
are no nested maps, lists or block scalars. The closing fence is the *first later* line equal to
`---`, so a body may contain horizontal rules. **Unknown keys, comments and blank lines are kept and
written back**, so a field you add by hand survives every transition — the CLI's own keys are
rewritten at the top in the order above and everything else follows, keeping its order among itself,
so a hand-written line moves below the CLI's block once and never again. The body is preserved byte
for byte from the template (`templates/TicketBody.md`), `--body` or `--body-file`; an empty body
falls back to the template.

### What a ticket move does to its row

The **from** column is the matrix the named verbs enforce; `ticket status <id> <status>` skips it.
**its row** is the status stored; **pill** is what that row then reads on the chart.

| command | from | ticket status | its row | pill | stamps written | log line |
|---|---|---|---|---|---|---|
| `ticket add` | — | open | created, `pending` | `unstarted` | `filed` | `Ticket #003 filed: <title>` |
| `ticket start` | open, in-review | in-progress | `running` | `wip` | `started` if null; the row's end cleared | `Ticket #003 started` |
| `ticket review` | in-progress | in-review | `finished` | `reviewing` | `finished` if null | `Ticket #003 in review` |
| `ticket rereview` | in-review | in-review, unchanged | `re-review`, one round up from 2 | `reviewing 2` | `updated` only | `Ticket #003 in review, round 2` |
| `ticket done` | in-progress, in-review | done | `reviewed` | `awaiting merge` | `finished` if null | `Ticket #003 done` |
| `ticket deliver` | done | delivered | `delivered` | `done` | `delivered` if null | `Ticket #003 delivered` |
| `ticket abandon` | anything but delivered, abandoned | abandoned | `abandoned` | `abandoned` | `abandonedAt`; the row's end if it had started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | anything but open | open | `pending` | `unstarted` | all of them cleared | `Ticket #003 reopened` |

Filing the row is itself the first entry in its `history`, and each of those moves appends another,
so the panel a double-click opens can say when the row reached each state and how long it sat there
— the wait between `unstarted` and `wip` being the queue time. `task update --status` is deliberately
not appended: it corrects a row rather than moving it, and a correction is not something that
happened.

Moving a ticket to the status it already has is refused and logs nothing, and `ticket rereview` is
the one exception: every review pass is still review, so the round is counted on the row rather than
in a status of its own. A ticket taken straight to
a closing status with `ticket status`, having never started, gets a row whose start is stamped along
with its end — an end without a start would draw from the origin of the chart. There is no `paused`
ticket status: `task pause <id>` records a waiting row and the ticket stays where it was.

A task is linked to at most one ticket. Task ids are never reused within a tracker, not even after
`task remove` or `clear`; ticket ids come from file names and gaps are tolerated, never filled.

## Development

```sh
bun run typecheck   # tsc over the Bun project and the DOM-only page project
bun test            # bun:test, specs beside their modules
bun run lint        # eslint 9 flat config
```

Run all three after any TypeScript change. `cli/HelpText.spec.ts` holds the help against the command
table in both directions, and holds the bundled skills to their shape: none of them may carry a
command table of its own, and the one every agent loads has a size ceiling. Every backticked
repository path in any markdown file or docblock is checked to exist by
`lib/DocumentedPaths.spec.ts` — so a rename that leaves a dead citation behind fails the build.

The conventions are in `CLAUDE.md`, with per-file detail in each folder's own, and
agreed-and-not-started work in `docs/backlog.md`.

## Three decisions worth knowing

**One tracker per repository, shared by every worktree.** The root comes from
`git rev-parse --git-common-dir` resolved to the main checkout, not from the current directory. A
subagent working in `.claude/worktrees/some-branch` therefore writes into the same chart as the
orchestrator that spawned it, which is the case the tool exists for. The cost is that the tracker
cannot describe one worktree in isolation; the alternative was a tracker per checkout, where a
fan-out produces five charts and no picture.

**The page is rendered under the lock, from disk.** Every mutating command takes the lock, reads,
mutates, writes `progress.json` atomically, then re-reads and rewrites `progress.html` — all before
releasing. Rendering afterwards would let two commands interleave and leave the page describing a
state the store never held. The lock file carries a pid as well as a timestamp, and a stale lock is
taken over by `rename` so exactly one waiter wins.

**Layout is computed in the browser, and the limits travel as data.** `progress.html` embeds the
progress file in a JSON island and `lib/render/page/GanttGeometry.ts` computes every bar, tick and
marker from it, which is what lets the in-page range presets re-lay-out without a regeneration —
and means there is exactly one implementation of the geometry rather than a server copy and a
client copy that disagree. The page cannot import `lib/constants/Limits.ts`, so the numbers are put
into the island and taken as a parameter instead of restated.

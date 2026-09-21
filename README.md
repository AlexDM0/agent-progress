# agent-progress

A Bun + TypeScript CLI that tracks an AI orchestrator's work per repository: tasks as rows on a
Gantt chart, stateful markdown tickets, a log, and a self-contained `progress.html` regenerated on
every command and reloading itself every 30 seconds.

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
  dispatching an implementing agent for it (at most two at a time), reviewing the result from the
  Handoff and delivering it, until every ticket is delivered. It loads the first skill for the
  commands and repeats none of it.

## Adopting a repository

```sh
cd <the repository to track>
agent-progress init
```

`init` writes four things:

- **`.agent-progress/`** at the repository root, holding `progress.json`, a `tickets/` folder, the
  generated `progress.html` and the lock file. The root is found with
  `git rev-parse --git-common-dir`, so **every worktree of the repository shares one tracker**.
- **`.agent-progress/agent-brief.md`** (from `templates/AgentBrief.md`), the brief an orchestrator
  fills in before it spawns an implementing agent: the scope, the facts it needs instead of a reading
  list, how many calls and browser calls it may spend, when to stop, and what to report. It is
  guidance shipped with the tool rather than a file a project edits, so every `init` rewrites it.
- **a `.gitignore` entry** for it — but only when the repository does not already ignore it.
  `git check-ignore` decides, so a repository covered by a broader pattern, a parent `.gitignore`
  or `.git/info/exclude` gets no diff at all.
- **a managed block in the repository's `CLAUDE.md`** (from `templates/ClaudeInstructionsBlock.md`),
  between `<!-- agent-progress:managed:start -->` and `<!-- agent-progress:managed:end -->`, telling
  the next agent to track its work through the tool. The file is written **in place**, so a
  symlinked `CLAUDE.md` stays a symlink; a start marker with no end marker is refused and the file
  is left alone. `--no-claude-md` skips it.

`--hooks` writes a fifth thing: a `SubagentStop` entry in the repository's `.claude/settings.json`
running `agent-progress hook subagent-stop`, under an empty matcher so every subagent type is
recorded. It merges into whatever that file already holds, is never added twice, and refuses a
document it cannot parse rather than replacing it; `init` prints the path and says which of those
happened. Without the flag nothing is written there and `init` says the flag exists.

`init` is refused when an ancestor directory already holds a tracker. Re-running it only refreshes
the managed block and the brief.

## The Handoff and the token column

A ticket's body ends with a **Handoff** section, written by the agent that implemented the ticket as
the last thing it does: the files it touched, anything it learned that the ticket did not say, what
is verified and how, and what is not. The point is that the review pass and whoever picks the work up
tomorrow read fifteen lines instead of re-deriving them from the diff — which, for an AI agent, is
the difference between a short session and one that re-reads a repository.

The same thrift is why every row carries a token count. The tool measures nothing; `--tokens` stores
the figure the orchestrator reports when a subagent's work ends, and the chart shows it beside the
bar. With the `SubagentStop` hook installed that figure is the `input` one on the line the hook logs,
every token the agent processed; without it the harness's own `subagent_tokens` is the fallback, and
it reports roughly the agent's end context rather than everything the agent read to reach it. A row
left without one is not a row that cost nothing — it is a row nobody looked at, and a
chart full of those is how the expensive habits stay invisible.

## The dashboard

`.agent-progress/progress.html` — one file, no CDN, no server. Open it with `agent-progress open`.

- A **Progress** tab: the Gantt chart, one row per task, newest on top, with its number, name, ticket badge, token
  count, status pill and bar, a now-marker, and the log underneath, newest first.
- A **Tickets** tab: a summary table, then one card per ticket with its body rendered as markdown
  (`done`, `delivered` and `abandoned` collapsed). The chosen tab and the open cards are kept in the
  browser, so the refresh lands where you were.
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
| `init [--project <name>] [--root <path>] [--no-claude-md] [--hooks]` | Create the tracker here: `.agent-progress/` with an empty progress file and a `tickets/` folder, a `.gitignore` entry for it, and a managed block in the repository's CLAUDE.md. Refused inside a bare repository, and when `--root` is not an existing directory. `--project` names the project shown on the page, `--root` tracks that directory instead of the discovered repository root, `--no-claude-md` leaves CLAUDE.md alone, and `--hooks` writes the SubagentStop hook into `.claude/settings.json`. |
| `status [--json] [--full]` | The project, the counts, the rows that are not delivered or abandoned, and the last log entries newest first. `--json` prints the same working view — the unsettled rows and tickets, the last 10 log entries, and an `omitted` object counting what was left out — which is the form an agent reads at the top of a session. `--full` lists everything, and with `--json` prints the progress file itself plus every ticket's frontmatter. |
| `task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--start] [--tokens <n>] [--at <when>] [--force]` | Add a Gantt row. `--start` marks it running at `--at` (default now), `--ticket` links it to a ticket that has no row of its own, `--note` is the detail shown beside the bar, and `--tokens` records what the work cost. `--force` moves `--ticket`'s link off the row that holds it. |
| `task start\|pause\|finish\|review\|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]` | Move one row and stamp it: `start` sets its start and resumes a paused row, `pause` records that the work is waiting without closing the bar, `finish` and `review` set its end, `deliver` records that the work reached its destination. A stamp already recorded is kept, so `--at` backfills a row nobody registered at the time. A row a ticket owns is refused, naming the `ticket` verb that moves both; `--force` moves only the row. |
| `task update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]` | Change a row without moving its clock. At least one field is required, and `--status` on a row a ticket owns is refused unless `--force`. |
| `task remove <id>` | Delete a row. A ticket pointing at it is unlinked rather than deleted. The id is never given to another row. |
| `log "<text>" [--at <when>]` | Append one line to the log shown under the chart. `--at` backfills it. |
| `hook subagent-stop` | Record what a finished subagent cost, as one log line: the hook JSON arrives on standard input, and the agent's transcript is summed per API call rather than per line. This is the command `init --hooks` wires into `.claude/settings.json`; nobody types it. It exits 0 whatever goes wrong — no input, an unreadable transcript, no tracker at the hook's own working directory — and writes the reason to standard error. Its exit code prevents nothing, since the agent has already finished; exiting 0 is what keeps a failure here from becoming an error the orchestrator must read, or a delay before it is told its agent is done. |
| `usage [--since <when>] [--transcripts <folder>] [--json]` | What this repository's subagents cost, read out of the transcripts the harness wrote for them under `~/.claude/projects/`: one row per agent, oldest first, with its start, its API calls, its end context, its input and output, its browser calls, the characters the harness injected into it and the first line of its brief; then the cohort summary — median calls and end context, mean input and output, and the mean of each figure below. Three of the columns catch a brief being breached without anyone reading a transcript: `over 200k` is the share of the agent's input that was sent at a context past 200,000 tokens, `bash edits` counts the edits it made through a shell command — a heredoc, an inline interpreter or an in-place editor — instead of through the editing tools, and `checks` counts the full test, type-check and lint runs it made per edit instead of per batch. `--json` carries the oversized figure as a raw token count rather than as a share. `--since` splits the cohort on an instant and summarises both sides. `--transcripts` reads a folder other than the one this repository's path resolves to. It writes nothing and takes no lock, and a repository with no transcripts is one sentence at exit 0. |
| `ticket add "<title>" [--type bug\|change\|feature] [--group <name>] [--depends-on <ids>] [--body <markdown>] [--body-file <path\|->] [--at <when>]` | File a ticket: a markdown file under `.agent-progress/tickets/` with its own frontmatter, plus a pending Gantt row. The body comes from the template, from `--body`, or from `--body-file` (`-` reads standard input); afterwards it is preserved byte for byte. `--depends-on 3,4` files it already waiting on those tickets. |
| `ticket list [--status <s>] [--json]` | The tickets with their type, status, group and row id. `--json` carries no bodies; use `ticket show` for one ticket's prose. |
| `ticket show <id> [--json]` | One ticket: its frontmatter, its body, and always its file path. |
| `ticket start\|review\|done\|deliver\|abandon\|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]` | Move a ticket and its Gantt row together, stamping both, and set the row's token count. Each verb only moves a ticket that is in a status it makes sense from (see the table below), and a move to the status a ticket already has is refused. `abandon` requires `--reason`; `reopen` clears the stamps and returns the row to pending. |
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
      "status": "running",                       // pending|running|paused|finished|reviewed|delivered|abandoned
      "start": "2026-09-18T21:30:54+02:00",
      "end": null,
      "owner": "opus",
      "note": "",
      "ticket": "003",                           // or null
      "tokens": 48000,                           // or null: "nobody said", which is not "it used none"
      "reviewed": "2026-09-18T22:10:00+02:00"    // absent until the row is first reviewed; kept through delivery
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

| command | from | ticket status | its row | stamps written | log line |
|---|---|---|---|---|---|
| `ticket add` | — | open | created, `pending` | `filed` | `Ticket #003 filed: <title>` |
| `ticket start` | open, in-review | in-progress | `running` | `started` if null; the row's end cleared | `Ticket #003 started` |
| `ticket review` | in-progress | in-review | `finished` | `finished` if null | `Ticket #003 in review` |
| `ticket done` | in-progress, in-review | done | `reviewed` | `finished` if null | `Ticket #003 done` |
| `ticket deliver` | done | delivered | `delivered` | `delivered` if null | `Ticket #003 delivered` |
| `ticket abandon` | anything but delivered, abandoned | abandoned | `abandoned` | `abandonedAt`; the row's end if it had started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | anything but open | open | `pending` | all of them cleared | `Ticket #003 reopened` |

Moving a ticket to the status it already has is refused and logs nothing. A ticket taken straight to
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

The conventions are in `CLAUDE.md`, with per-file detail in each folder's own. Rejected
alternatives live in `docs/decisions.md`, agreed-and-not-started work in `docs/backlog.md`, and the
original design in `docs/plan.md`.

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

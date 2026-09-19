---
name: agent-progress
description: >-
  Track your own work with the agent-progress CLI: tasks as rows on a Gantt
  chart, stateful markdown tickets, a log, and a self-contained dashboard the
  user watches while you work. Use this skill whenever the user asks for
  progress tracking, a Gantt chart, a ticket or a bug filed, says "track this
  work", "keep me posted" or "what is the status", whenever you are about to
  orchestrate subagents and their work should be visible, whenever a repository
  holds a `.agent-progress/` directory, and whenever you are asked to adopt the
  tracker with `agent-progress init`.
---

# agent-progress — tasks, tickets and a Gantt dashboard for one repository

`agent-progress` is a globally linked CLI that gives an AI orchestrator a place to put what it is
doing, and gives the person watching a page that shows it. It stores a tracker per repository,
regenerates a self-contained `progress.html` on every mutating command, and that page reloads itself
every 30 seconds — so the user opens it once and then simply watches the work happen.

You drive it entirely through commands. There is no file to edit by hand and no format to remember
beyond a ticket's body.

## The mental model

- **One tracker per repository, shared by every worktree of it.** The root is found with
  `git rev-parse --git-common-dir`, so a subagent running in `.claude/worktrees/some-branch` writes
  into the *main* checkout's `.agent-progress/`. You never have to reconcile trackers, and you never
  get a second one by accident. Outside a git repository the current directory is the root;
  `--root <path>` and the `AGENT_PROGRESS_ROOT` environment variable override the discovery when a
  command runs from somewhere else entirely.
- **A task is a row on the Gantt chart.** It has a name, an owner, a note, a status, two timestamps
  and an optional token count. Anything worth a bar gets one: a subagent you spawned, a review pass,
  a planning phase, a group of tickets. Row ids are never reused within a tracker, so a log line
  naming task #4 means the same work tomorrow.
- **Every ticket owns a row too.** Filing a ticket creates its row as `pending`; moving the ticket
  moves the row and stamps both. You never keep the two in step yourself.
- **The log** is the narrative under the chart: one line per milestone, newest first on the page.
- **The dashboard** is `.agent-progress/progress.html`, written fresh by every command that changes
  anything, with a **Progress** tab and a **Tickets** tab. It is one file, with no network
  dependency, so it survives being copied or mailed.

## The session protocol

1. **Open with `agent-progress status --json`.** It prints the working view — every row and ticket
   that is not delivered or abandoned, with statuses, stamps, tokens and file paths, the last 10 log
   entries newest first, and an `omitted` object counting what it left out. Reach for `--full` only
   when you need a settled row or the whole log. If it exits 1 saying there is no tracker, this
   repository has not adopted one — do not create it uninvited.
2. **`agent-progress init` when the user asks you to adopt the tracker**, or when they ask for
   progress tracking in a repository that has none. It creates `.agent-progress/`, adds the
   `.gitignore` entry, writes `.agent-progress/agent-brief.md` and writes a managed block into the
   repository's `CLAUDE.md` so the next session knows to use it. Re-running it refreshes that block
   and the brief, and changes nothing else.
3. **Register a task before you spawn each subagent**, not after:

   ```
   agent-progress task add "Rewrite the importer" --owner opus --start
   ```

   The row starts running the moment the subagent does, which is the whole point of the chart.
   When its result lands, `agent-progress task finish <id>` — then `review` when you have checked
   the work, and `deliver` when it has reached the user or the branch it was for. Use
   `agent-progress task pause <id>` while a row is waiting on something (the user, a sibling
   agent's output); `task start <id>` resumes it without starting a second bar.
4. **Pass `--tokens <n>` whenever a subagent's task ends.** The number is the `subagent_tokens`
   figure in the completion notification you receive when the agent finishes; nothing in the tool
   measures usage, so it stores what you report and shows it back on the chart and in `status`. Put
   it on the command that ends the row (`task finish 4 --tokens 48k`), or on the `ticket` verb that
   moves the ticket's row (`ticket done 3 --tokens 1.2m`). Write it as a whole number or a decimal
   with a `k`/`m` suffix: `12000`, `12k`, `12.3k`, `1.2m`. Leave it off only when the notification
   did not carry one — an unreported row and a row that used nothing are different answers.
5. **File a ticket for every bug, change or feature the user reports**, whether or not you fix it
   in the same breath. A ticket is how the work is still there tomorrow:

   ```
   agent-progress ticket add "Double-click a role to edit it" --type change --body-file - <<'BODY'
   ## Report
   What the user saw, in their words.

   ## Wanted
   The behaviour they asked for.

   ## Acceptance
   What has to be true before this is done.
   BODY
   ```

   Then move it as the work moves: `ticket start`, `ticket review`, `ticket done`,
   `ticket deliver`, or `ticket abandon --reason "<why>"`. Each verb only moves a ticket that is in
   a status it makes sense from (see the table below), and moving a ticket to the status it already
   has is refused with exit 1 and logs nothing. `agent-progress ticket status <id> <status>` is the
   documented way to make a move the verbs refuse.

   **When one ticket can only be done after another, record it**: `ticket depends 5 3` (or
   `--depends-on 3` on `ticket add`). The dashboard then shows "waiting on #003" on #005 until #003
   is done or delivered. Pick up work in that order: start a ticket only when nothing it waits on
   is still open — `ticket list` shows what each one is waiting on, and `ticket start` warns when
   you jump ahead.
6. **`agent-progress log "<text>"` at each milestone** — a wave finished, a decision taken, a
   direction abandoned. The log is what makes the chart readable a day later.
7. **Backfill with `--at`.** Every state-changing command and `log` take `--at <when>`, where
   `<when>` is an ISO 8601 timestamp, `now`, or an offset from now: `-5m`, `-2h`, `-1d`, `+30m`. A
   row you forgot to register at the time is registered now and stamped then.
8. **Parse with `--json`.** `status`, `ticket list`, `ticket show` and the mutating commands all
   take it; that is the form to read, never the human output. Run each tracker command on its own
   line rather than chained into other work, so its output stays short and visible. A subagent
   reading its ticket needs only the body below the frontmatter.
9. **`agent-progress open` once per session**, so the user has the dashboard in front of them.

## Briefing a subagent

`init` writes the generic version of this brief to `.agent-progress/agent-brief.md`, with a fillable
skeleton per section, so you paste it rather than remember it. Seven things belong in it.

1. **Scope.** One ticket, or one half of one that splits cleanly, with the worktree, the branch, the
   files the agent may edit and the instruction not to commit. Agents handed two tickets at once ran
   250 to 297 API calls.
2. **A contract, not a reading list.** Three to eight facts the agent would otherwise go and find,
   and the files to open with their line ranges. Forbid reading any `CLAUDE.md`: the harness injects
   a nested one by itself the first time a file in its folder is opened.
3. **Call discipline.** Open every named file in one message, write new files with the write tool
   rather than a heredoc, and verify once per batch of edits with the project's own command.
4. **A bounded browser loop**, for work with a user interface only: about 15 browser calls, the page
   read as text, one batch per interaction sequence, and screenshots kept for final evidence under
   names that say which ticket and which acceptance item they prove.
5. **Stop conditions.** Stop at the Acceptance block or at about 100 API calls, whichever comes
   first, then leave green what is green, write the Handoff and report.
6. **The report.** Under 200 words to you, and a `## Handoff` section appended below the ticket's
   frontmatter: files touched, contracts discovered that the ticket did not state, what is verified
   and how, and what is not.
7. **Your own checklist.** `task add --start` before you spawn it, `task finish <id> --tokens <n>`
   when the result lands, and a review read from the Handoff and the screenshots.

**Never continue a finished agent with a follow-up message.** Send a fresh one for the remainder, and
review from the Handoff rather than by driving the page a second time.

## What a subagent costs

The figures below come from one repository built by 73 subagents, and they are the reason the rules
above are shaped as they are. Every API call re-reads the agent's whole transcript, so transcript
length, not the size of the change, is the multiplier: that build spent 1.7 billion cache-read input
tokens against 6.0 million tokens of output. A transcript records one API call as several lines
sharing a `message.id`, each repeating the same input figures, so anything that sums lines rather
than calls overstates input by about half. Context above the 200k window is billed at the
long-context rate, and the agents given two tickets and a 40-file reading list ended on 543 to 720
thousand tokens with 84% of their context billed there. The harness's own injections are part of the
length — a nested `CLAUDE.md` arrives the first time a file in its folder is opened, 128 times and
1.8 million characters in that build, and an agent working in a worktree inside the repository
receives the root file twice. Connectors are not the problem people assume: deferred tool schemas
cost 2 to 3 thousand tokens of a roughly 59 thousand fixed context. Continuing an agent is: those
continued with a follow-up message ran a median of 149 calls to 367 thousand tokens of end context
against 62 and 229 thousand for fresh ones, and a screenshot loop cost one agent about 40 consecutive
calls. After the briefs above, the next 13 implementing agents ran a median of 32 calls to 165
thousand end context, with mean input down from 32.1 million tokens to 4.8 million. **None of this is
visible unless you record it**: the token column read 0 on every row of that build because nobody
passed `--tokens`, which is how six sessions of cost went unnoticed. `agent-progress init --hooks`
takes that off your hands for the figures a transcript holds: it installs a SubagentStop hook that
runs `agent-progress hook subagent-stop`, so every agent that finishes leaves a log line naming its
call count, its end context and its input and output — counted per API call, not per transcript line.
`agent-progress usage` is how you measure any of this after the fact: it reads every subagent
transcript this repository has, prints one row per agent and a cohort summary, and with `--since`
splits that cohort on the instant you changed how agents are briefed, so the two summaries say
whether the change was worth making.

## The rules

- **Never edit `progress.json` by hand**, and never write into `.agent-progress/` with a file tool.
  Every command takes a lock, writes atomically and regenerates the page; a hand-written file races
  with that and loses silently.
- **A ticket body is yours to edit — below the frontmatter only.** `agent-progress ticket show <id>`
  always prints the file path; edit from the first line after the closing `---` and nothing above
  it. The CLI preserves the body byte for byte across every transition, and rewrites the
  frontmatter itself.
- **Do not hand-edit a ticket's known frontmatter keys.** Unknown keys you add (`owner:`,
  `estimate:`) are preserved in order and survive every transition, so use those if you need a
  field the tool does not have.
- **Run `agent-progress open` once, not on every command** — the page refreshes itself.
- The dashboard is `.agent-progress/progress.html`. Give the user that path, not a screenshot.
- The tracker is git-ignored on purpose. Do not commit it, and do not offer to.

## Command reference

`<when>` is an ISO 8601 timestamp, `now`, or an offset from now: `-5m`, `-2h`, `-1d`, `+30m`. Every
mutating command takes the lock, writes the progress file atomically and regenerates
`progress.html`. This is the same reference `agent-progress help` prints.

| command | what it does |
|---|---|
| `agent-progress init [--project <name>] [--root <path>] [--no-claude-md] [--hooks]` | Create the tracker here: `.agent-progress/` with an empty progress file, a `tickets/` folder and `agent-brief.md` — the brief to fill in before spawning an implementing agent — a `.gitignore` entry for it, and a managed block in the repository's CLAUDE.md telling an agent to track its work through this tool. Refused when an ancestor already holds a tracker; re-running only refreshes the managed block and the brief. `--project` names the project shown on the page, `--root` tracks that directory instead of the discovered repository root, `--no-claude-md` leaves CLAUDE.md alone, and `--hooks` writes the SubagentStop hook below into the repository's `.claude/settings.json`, merging into whatever is already there. |
| `agent-progress status [--json] [--full]` | The project, the counts, the rows that are not delivered or abandoned, and the last log entries newest first. `--json` prints the same working view — the unsettled rows and tickets, the last 10 log entries, and an `omitted` object counting what was left out — which is the form an agent reads at the top of a session. `--full` lists everything, and with `--json` prints the progress file itself plus every ticket's frontmatter. |
| `agent-progress task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--start] [--tokens <n>] [--at <when>] [--force]` | Add a Gantt row. `--start` marks it running at `--at` (default now), `--ticket` links it to a ticket that has no row of its own, `--note` is the detail shown beside the bar, and `--tokens` records what the work cost. `--force` moves `--ticket`'s link off the row that holds it. |
| `agent-progress task start\|pause\|finish\|review\|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]` | Move one row and stamp it: `start` sets its start and resumes a paused row, `pause` records that the work is waiting without closing the bar, `finish` and `review` set its end, `deliver` records that the work reached its destination. A stamp already recorded is kept, so `--at` backfills a row nobody registered at the time. A row a ticket owns is refused, naming the `ticket` verb that moves both; `--force` moves only the row. |
| `agent-progress task update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]` | Change a row without moving its clock: `--name`, `--owner`, `--note`, `--tokens`, or `--status` for a correction the transitions cannot express. At least one is required, and `--status` on a row a ticket owns is refused unless `--force`. |
| `agent-progress task remove <id>` | Delete a row. A ticket pointing at it is unlinked rather than deleted. The id is never given to another row. |
| `agent-progress log "<text>" [--at <when>]` | Append one line to the log shown under the chart. `--at` backfills it. |
| `agent-progress hook subagent-stop` | Record what a finished subagent cost, as one log line: the hook JSON arrives on standard input, and the agent's transcript is summed per API call rather than per line. This is the command `init --hooks` wires into `.claude/settings.json`; nobody types it. It exits 0 whatever goes wrong — no input, an unreadable transcript, no tracker at the hook's own working directory — and writes the reason to standard error. Its exit code prevents nothing, since the agent has already finished; exiting 0 is what keeps a failure here from becoming an error the orchestrator must read, or a delay before it is told its agent is done. |
| `agent-progress usage [--since <when>] [--transcripts <folder>] [--json]` | What this repository's subagents cost, read out of the transcripts the harness wrote for them: one row per agent, oldest first, with its start, its API calls, its end context, its input and output, its browser calls, the characters the harness injected into it and the first line of its brief; then the cohort summary — median calls and end context, mean input and output. `--since` splits the cohort on an instant and summarises both sides, which is how a change in the way agents are briefed is measured. `--transcripts` reads a folder other than the one this repository's path resolves to. It writes nothing, takes no lock and regenerates no page, and a repository with no transcripts is one sentence at exit 0. |
| `agent-progress ticket add "<title>" [--type bug\|change\|feature] [--group <name>] [--depends-on <ids>] [--body <markdown>] [--body-file <path\|->] [--at <when>]` | File a ticket: a markdown file under `.agent-progress/tickets/` with its own frontmatter, plus a pending Gantt row. The body comes from the template, from `--body`, or from `--body-file` (`-` reads standard input); afterwards it is preserved byte for byte, so an agent may edit everything below the frontmatter freely. `--depends-on 3,4` files it already waiting on those tickets. |
| `agent-progress ticket list [--status <s>] [--json]` | The tickets with their type, status, group and row id. `--status` narrows the listing to one status. `--json` carries no bodies; use `ticket show` for one ticket's prose. |
| `agent-progress ticket show <id> [--json]` | One ticket: its frontmatter, its body, and always its file path — which is what an agent needs in order to edit that body. |
| `agent-progress ticket start\|review\|done\|deliver\|abandon\|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]` | Move a ticket and its Gantt row together, stamping both, and set the row's token count. Each verb only moves a ticket that is in a status it makes sense from, and a move to the status a ticket already has is refused. `abandon` requires `--reason`; `reopen` clears the stamps and returns the row to pending. `--branch` and `--commit` record where the work landed. |
| `agent-progress ticket status <id> <status>` | The same move, naming the target status directly: open, in-progress, in-review, done, delivered or abandoned. It takes the same options and is the documented way to make a move the verbs above refuse. |
| `agent-progress ticket link <ticketId> <taskId> [--force]` | Point a ticket at an existing row instead of the one it filed. Refused when that row already belongs to another ticket, unless `--force`, which unlinks it there first. |
| `agent-progress ticket depends <id> [<id>...]` | Set the tickets this one waits on, replacing its list; no ids clears it. Refused for a ticket that does not exist and for a list that would make tickets wait on each other in a circle. Until they are all done or delivered, its row, table entry and card read "waiting on #003", `ticket list` says so, and `ticket start` warns but still moves it. |
| `agent-progress range --from <when> --to <when> [--tick <15m\|1h\|1d>]` | The stored default axis of the chart. A relative bound is stored as written, so `--from -2h` keeps meaning "the last two hours" on every refresh. The page's own range bar overrides this per browser. |
| `agent-progress range --auto` | Reset the axis to the automatic span. |
| `agent-progress render` | Regenerate `progress.html` from the progress file and the tickets, changing nothing else. For a page lost to a crash, or after a ticket body was edited by hand. |
| `agent-progress open` | Open `progress.html` in the default browser. |
| `agent-progress clear [--all] [--yes]` | Throw away every task row and the log and restart the clock, keeping the tickets: each surviving ticket is given a fresh row seeded from its own frontmatter, with a new id — row ids are not reused. `--all` deletes the tickets too and restarts their ids at 001. `--yes` skips the confirmation, and is required when standard input is not a terminal. |
| `agent-progress help` | This command reference. |

## The ticket file

`.agent-progress/tickets/003-double-click-a-role-to-edit-it.md`:

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
dependsOn: "001, 002"
task: 17
---
# 003 — Double-click a role to edit it

## Report
…
```

The keys the CLI owns are `id`, `title`, `type`, `status`, `filed`, `updated`, `started`,
`finished`, `delivered`, `abandonedAt`, `group`, `branch`, `commit`, `reason`, `dependsOn` and
`task`. `dependsOn` is the ticket ids this one waits on, comma-separated; set it with
`ticket depends` rather than by hand, so a missing id or a circle is refused. `type` is
one of **bug · change · feature**; `status` is one of **open · in-progress · in-review · done ·
delivered · abandoned**. Any other line — an unknown key, a comment, a blank line — is kept and
written back, so a field you add by hand survives every transition. **The CLI's own keys are
rewritten at the top in the order above and your lines follow them, keeping their order among
themselves**, so the first transition after you add a line moves it below the CLI's block once and
never again. The body starts after the closing `---` and is never touched by the CLI.

The body filed from the template carries **Report**, **Wanted**, **Acceptance** and **Handoff**. The
first three are written when the ticket is filed; the **Handoff** is the last thing the agent that
implements the ticket writes, in under 15 lines — the files it touched, contracts it discovered that
the ticket did not state, what is verified and how (naming the screenshot paths), and what is not.
Whoever picks the work up next, including the review pass, reads that section instead of rediscovering
it from the codebase.

### What each move does to the Gantt row

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

A ticket taken straight to a closing status with `ticket status`, having never started, gets a row
whose start is stamped along with its end — an end without a start would draw from the origin of the
chart. There is no `paused` ticket status: `task pause <id>` records a waiting row, and the ticket
stays where it was.

`abandoned` is a state, not a deletion: the row stays as a grey hatched bar with a struck-through
label, so ids and history are stable and a chart never silently loses a row.

## The time axis

`agent-progress range` sets the tracker's stored default and every browser sees it. A relative bound
is stored as you wrote it and resolved on each refresh, so `--from -2h --to now` always means the
last two hours. The page itself carries a range bar with the presets **Auto · 1h · 4h · 12h · 24h ·
7d · All**, `datetime-local` inputs for an exact window and a tick-step selector; a viewer's choice
is kept in their browser and survives the refresh, and **Auto** hands control back to the stored
default. Bars outside the window are clipped and marked, never dropped.

## Exit codes

| code | meaning |
|---|---|
| **0** | done, or there was nothing to do |
| **1** | a refusal you can act on: no tracker here (run `agent-progress init`), no such task or ticket, a missing `--reason`, an unknown command |
| **2** | a state the tool will not repair on its own: an unreadable or malformed progress file, a lock it could not take |

Check the code rather than the wording. A command that wrote the store but could not rebuild the
page still exits 0, reports the failure on standard error, and leaves the page carrying a visible
error banner — the data is safe and `agent-progress render` rebuilds the page.

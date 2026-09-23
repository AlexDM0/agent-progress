# agent-progress — the file formats and the states

**The command reference is `agent-progress help`** — every command, every flag, printed by the tool
itself and therefore never out of step with it. Run it when you need a flag you do not remember;
nothing here repeats it.

What is here is what the tool does not print: the ticket file an agent edits, what each move does to
the Gantt row, how a row's tokens are recorded, the time axis and the exit codes.

## The ticket file

`.agent-progress/tickets/003-double-click-a-role-to-edit-it.md`:

```
---
id: "003"
title: "Double-click a role to edit it"
type: change
priority: high
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

The keys the CLI owns are `id`, `title`, `type`, `priority`, `status`, `filed`, `updated`, `started`,
`finished`, `delivered`, `abandonedAt`, `group`, `branch`, `commit`, `reason`, `dependsOn` and
`task`. `dependsOn` is the ticket ids this one waits on, comma-separated; set it with
`ticket depends` rather than by hand, so a missing id or a circle is refused. `type` is
one of **bug · change · feature**; `priority` is one of **low · normal · high**, and a ticket
without the key is normal — the CLI writes it only when one is given, so an older ticket is never
rewritten to gain it; `status` is one of **open · in-progress · in-review · done ·
delivered · abandoned**. Any other line — an unknown key, a comment, a blank line — is kept and
written back, so a field you add by hand survives every transition. **The CLI's own keys are
rewritten at the top in the order above and your lines follow them, keeping their order among
themselves**, so the first transition after you add a line moves it below the CLI's block once and
never again. The body starts after the closing `---` and is never touched by the CLI.

The body filed from the template carries **Report**, **Wanted**, **Acceptance** and **Handoff**. The
first three are written when the ticket is filed; the **Handoff** is the last thing the agent that
implements the ticket writes, in under 15 lines — the files it touched, contracts it discovered that
the ticket did not state, what is verified and how (naming the screenshot paths), what is not, and
the next concrete step, named so the follow-up agent starts working instead of re-orienting.
Whoever picks the work up next, including the review pass, reads that section instead of rediscovering
it from the codebase.

## What each move does to the Gantt row

The **from** column is the matrix the named verbs enforce; `ticket status <id> <status>` skips it.

**its row** is the status stored on the row; **pill** is what that row then reads on the chart.

| command | from | ticket status | its row | pill | stamps written | log line |
|---|---|---|---|---|---|---|
| `ticket add` | — | open | created, `pending`; none for a low ticket | `unstarted` | `filed` | `Ticket #003 filed: <title>` |
| `ticket start` | open, in-review | in-progress | `running` | `wip` | `started` if null; the row's end cleared | `Ticket #003 started` |
| `ticket claim` | open, in-review, dependencies settled (one on a ticket in the same claim is), a free slot, and for a low ticket no normal or high one owed — for every id named | in-progress | `running`, with `--owner`, `--note` and the claim's `agent` key | `wip` | as `ticket start` | `Ticket #003 started`, one per ticket |
| `ticket review` | in-progress | in-review | `finished` | `reviewing` | `finished` if null | `Ticket #003 in review` |
| `ticket rereview` | in-review | in-review, unchanged | `re-review`, one round up from 2 | `reviewing 2` | `updated` only | `Ticket #003 in review, round 2` |
| `ticket done` | in-progress, in-review | done | `reviewed` | `awaiting merge` | `finished` if null | `Ticket #003 done` |
| `ticket deliver` | done | delivered | `delivered` | `done` | `delivered` if null | `Ticket #003 delivered` |
| `ticket abandon` | anything but delivered, abandoned | abandoned | `abandoned` | `abandoned` | `abandonedAt`; the row's end if it had started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | anything but open | open | `pending` | `unstarted` | all of them cleared | `Ticket #003 reopened` |
| `release` | in-progress, in-review | delivered, through done | `delivered` | `done` | as `ticket done`, then `ticket deliver` with `branch` and `commit` | both of theirs |

**`done` on the chart means merged**, which is why the two vocabularies differ: a row stored as
`finished` is not finished with, it is waiting for a reviewer, and one stored as `reviewed` is
waiting for its branch to go in. A free-standing row — a review pass, a chore, anything with no
branch to merge — reaches `done` through `agent-progress task deliver <id>` once its work is
accepted. A row that never gets there is a row the chart shows as still owed.

**A review pass is drawn under its ticket.** A row filed with `task add … --review-of <id>` stores
the ticket it reviews in its `reviewOf` field, which `status --json --full` shows; a ticket that does
not exist is refused at exit 1 and nothing is written. On the Progress tab each review row sits
directly under that ticket's own row, indented one level, in round order, with its own bar, pill and
times. A row without the field whose name starts `Review <N> #<id>` is read the same way, so a board
filed before the flag nests too; a bundle's review, `Review 1 #13, #5 — …`, sits once, under the first
ticket it names. A review whose ticket has no row on the chart — a low ticket not started, or one
hidden as long done — is drawn where its filing puts it. `--review-of` is not `--ticket`: the ticket
keeps its own row, and the review row moves through the `task` verbs.

Every one of those moves is appended to the row's own phase history, which the dashboard shows when
a row is double-clicked, with how long the row sat in each phase. `task update --status` is
deliberately not: it corrects a row rather than moving it.

Moving a ticket to the status it already has is refused with exit 1 and logs nothing, and
`ticket rereview` is the one exception: a further reviewer is still review, so the round is
counted on the row, whose pill reads `reviewing 2`, and the ticket stays in-review. A ticket taken
straight to a closing status with `ticket status`, having never started, gets a row whose start is
stamped along with its end — an end without a start would draw from the origin of the chart. There
is no `paused` ticket status: `task pause <id>` records a waiting row, and the ticket stays where it
was.

`abandoned` is a state, not a deletion: the row stays as a grey hatched bar with a struck-through
label, so ids and history are stable and a chart never silently loses a row.

**A low ticket has no row until it is started.** `ticket add --priority low` files it with no row
and takes no task id; it shows on the dashboard's Tickets tab marked `low` and nowhere on the
Progress tab. `ticket start` or `ticket claim` creates its row, `running`, and the row then stays,
through a reopen too. `ticket abandon` or `ticket reopen` on a low ticket that has no row creates
none. `ticket priority <id> <p>` writes one log line, `Ticket #003 priority normal → low`: lowering
to low is refused at exit 1 unless the ticket is open, and removes its row; raising a low ticket
with no row files one at once — `pending` while it is open, seeded from its stamps otherwise.
Between normal and high only the ticket changes. `clear` re-seeds no row for a low ticket that has
none, and keeps one for a low ticket that has one. A high ticket is marked `high` on the Tickets tab.

## A row's tokens

`--tokens` **sets** a row's count; the `SubagentStop` hook **adds** to it. The hook reads only the
agent's first message — its brief — for a line of its own, `agent-progress row: 4` or
`agent-progress row: 4, 7`, and adds the agent's `input` total (the figure its log line reports) to
each row named, divided evenly: floored, the remainder to the first. An unset count plus an amount is
the amount, so a row two agents worked on carries both. A row that does not exist is named on
standard error and skipped. A brief without the line changes no row.

`agent-progress ticket: 22` or `agent-progress ticket: 22, 20` names tickets instead, padded or not,
for a ticket whose row does not exist yet when the brief is written — a low ticket gets its row only
when its builder claims it. The hook looks each ticket's row up when it runs, under the same lock, and
divides the same way over the tickets named; a ticket with no row by then, or none at all, is named on
standard error and its share skipped. A brief carrying both lines is read by its `row:` line alone,
so the agent is never counted twice. Where the hook is installed,
pass no `--tokens` on a row a brief named: it would replace the sum. Without the hook, `--tokens`
from the harness's `subagent_tokens` is the only figure there is.

## The concurrency limit

The board holds how many agents may be in flight: `agent-progress concurrency` prints it, and
`agent-progress concurrency <n>` stores it for every worktree. A tracker that never set one reads 2.
**A slot is an agent, not a row.** `ticket claim 3 4 5` claims a bundle's tickets as one agent, all
or nothing, and writes the same `agent` key on each of their rows — the claimed ids joined,
`"003,004,005"`. The agents in flight are the `running` rows grouped by that key, each group counted
once, plus every running row with no key — a review bar, a `task add --start` row, a ticket started
by `ticket start` — each an agent of its own. A bundle whose tickets go to review one at a time keeps
its slot until its last row stops running. A row that starts running again other than from a pause
loses its key, so a reopened bundle ticket is a new agent. `ticket claim` refuses at exit 1, writing
nothing, when any ticket named would be refused on its own or when the agents in flight already
number the limit — except that a dependency on another ticket in the same claim counts as settled,
since one agent works the bundle in dependency order; one outside the claim that is not done or
delivered still refuses the whole claim; the count and the moves share one lock hold, so of two claims racing for the last
slot exactly one succeeds. `ticket start` is the manual path: it checks no limit and only warns about
dependencies. A limit lowered below the agents in flight is accepted and leaves no free slot; nothing
running is stopped. `status --json` carries `concurrency`: `limit`, `agentsInFlight`, `freeSlots` (never
negative) and `readyTicketIds`, the open tickets whose every dependency is done or delivered, high
priority first, then normal, each lowest id first. **Low tickets are ready only once no normal or
high ticket is left that is not delivered or abandoned** — a `done` ticket still waiting for its
merge holds them back — and `ticket claim` refuses a low ticket at exit 1 while one is left, where
`ticket start` only warns.

The same figures close the human output of `status`, `ticket add`, every ticket or task move and
`release`, as one **Next line** read after the change, inside the same lock hold: `Next: 1 of 2
slots free; ready: #003, #005`, `Next: no slot free (2 agents in flight); ready: #003` or `Next: 2 of 2
slots free; nothing ready`. Ready ids are listed lowest first, at most five, then `and N more`.
`--json` output never carries the line.

## Releasing a branch

`agent-progress release <id> --branch <b> --worktree <path>` is the only way a reviewed branch
reaches the main line, and allowing it in the harness is the release permission: nobody runs
`git merge` into main by hand. The main checkout is the tracker's root, found the same way from any
worktree. Inside one lock hold it checks the ticket, that the main checkout is on the main line and
that `<b>` descends from it, fast-forwards, and moves the ticket done and delivered with the branch
and the merged tip; a refusal at any of those steps changes nothing. After the lock it removes the
worktree (never forced) and deletes the branch (`-d`). A cleanup git declines is reported at exit 0,
because the release happened: a worktree holding untracked or changed files stays, and names them.
The human output ends with the Next line described above, read after the delivery inside the same
lock hold, so it reflects the released ticket's row no longer running.

`--json` prints, on success, `{released: true, tickets, branch, mainLine, commit, cleanup}` —
`tickets` the ids just delivered, `branch` and `mainLine` the ones the command ran with — and on a
refusal, `{released: false, reason, detail, cleanup: []}`, `cleanup` always empty because nothing
ran. On success `cleanup` lists each step, the worktree's first when `--worktree` was given, as one
of `{target: worktree, path, outcome: removed}`,
`{target: worktree, path, outcome: left, reason, untrackedFiles, changedFiles}`,
`{target: branch, name, outcome: deleted}` and `{target: branch, name, outcome: left, reason}`,
`reason` being git's. The refusal `reason` is one word:

| reason | what to do |
|---|---|
| `main-moved` | another branch went in first: rebase `<b>` onto the main line, run the checks, count the rebase with `agent-progress rework --rebased-from`, and release again |
| `not-on-main-line` | the main checkout is on another branch, or `--main` names no branch: a person's to fix |
| `merge-refused` | git would not fast-forward, a local change in the main checkout in the way for instance |
| `ticket-not-releasable`, `unknown-ticket`, `unknown-branch`, `invalid-request` | the command line names the wrong thing |
| `git-failed`, `tracker-failed` | exit 2: git or the tracker could not be read |

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
| **1** | a refusal you can act on: no tracker here (run `agent-progress init`), no such task or ticket, a missing `--reason`, a claim with no free slot or on a low ticket still held back, lowering a ticket that is not open, a release refused (`main-moved` among them), an unknown command |
| **2** | a state the tool will not repair on its own: an unreadable or malformed progress file, a lock it could not take |

Check the code rather than the wording. A command that wrote the store but could not rebuild the
page still exits 0, reports the failure on standard error, and leaves the page carrying a visible
error banner — the data is safe and `agent-progress render` rebuilds the page.

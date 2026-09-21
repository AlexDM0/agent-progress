# agent-progress — the file formats and the states

**The command reference is `agent-progress help`** — every command, every flag, printed by the tool
itself and therefore never out of step with it. Run it when you need a flag you do not remember;
nothing here repeats it.

What is here is what the tool does not print: the ticket file an agent edits, what each move does to
the Gantt row, the time axis and the exit codes.

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
the ticket did not state, what is verified and how (naming the screenshot paths), what is not, and
the next concrete step, named so the follow-up agent starts working instead of re-orienting.
Whoever picks the work up next, including the review pass, reads that section instead of rediscovering
it from the codebase.

## What each move does to the Gantt row

The **from** column is the matrix the named verbs enforce; `ticket status <id> <status>` skips it.

| command | from | ticket status | its row | stamps written | log line |
|---|---|---|---|---|---|
| `ticket add` | — | open | created, `pending` | `filed` | `Ticket #003 filed: <title>` |
| `ticket start` | open, in-review | in-progress | `running` | `started` if null; the row's end cleared | `Ticket #003 started` |
| `ticket review` | in-progress | in-review | `finished` | `finished` if null | `Ticket #003 in review` |
| `ticket rereview` | in-review | in-review, unchanged | `re-review`, one round up from 2 | `updated` only | `Ticket #003 in review, round 2` |
| `ticket done` | in-progress, in-review | done | `reviewed` | `finished` if null | `Ticket #003 done` |
| `ticket deliver` | done | delivered | `delivered` | `delivered` if null | `Ticket #003 delivered` |
| `ticket abandon` | anything but delivered, abandoned | abandoned | `abandoned` | `abandonedAt`; the row's end if it had started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | anything but open | open | `pending` | all of them cleared | `Ticket #003 reopened` |

Moving a ticket to the status it already has is refused with exit 1 and logs nothing, and
`ticket rereview` is the one exception: a further reviewer is still review, so the round is
counted on the row, whose pill reads `review 2`, and the ticket stays in-review. A ticket taken
straight to a closing status with `ticket status`, having never started, gets a row whose start is
stamped along with its end — an end without a start would draw from the origin of the chart. There
is no `paused` ticket status: `task pause <id>` records a waiting row, and the ticket stays where it
was.

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

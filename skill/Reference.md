# agent-progress — the file formats and the states

**The command reference is `agent-progress help`** — every command, every flag, printed by the tool
itself and therefore never out of step with it. Run it when you need a flag you do not remember;
nothing here repeats it.

What is here is what the tool does not print: the ticket file an agent edits, what each move does to
the Gantt row, where a review bar is drawn, how the hook credits a row's tokens, what counts as one
agent against the limit, the time axis and the exit codes.

## The ticket file

`.agent-progress/tickets/003-double-click-a-role-to-edit-it.md`.

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

## What each move does to the Gantt row

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

**`Done` on the chart means merged**: a row stored as `in-review` is waiting for a reviewer, and one
stored as `reviewed` for its branch to go in. A free-standing row — a review pass, a chore, anything
with no branch to merge — reaches `Done` through `agent-progress task deliver <id>` once its work is
accepted. A row that never gets there is a row the chart shows as still owed.

## Where a review bar is drawn

A row filed with `task add … --review-of <id>`, or by `ticket finish --start-review`, stores the
ticket it reviews in its `reviewOf` field. On the Progress tab each review row sits directly above
that ticket's own row, indented one level, latest round first, so round 1 is right above the
ticket, with its own bar, pill and times. A bundle's review, `Review 1 #13, #5 — …`, sits once,
above the first ticket it names. A review whose ticket has no row on the chart — a low ticket not
started, or one hidden as long done — is drawn where its filing puts it. `--review-of` is not
`--ticket`: the ticket keeps its own row, and the review row moves through the `task` verbs.

## A row's tokens

`--tokens` **sets** a row's count; the `SubagentStop` hook **adds** to it, from the marker line the
help describes. Over several rows it divides the agent's `input` total floored, the remainder to the
first, and an unset count plus an amount is the amount, so a row two agents worked on carries both.
The hook reads the line only from the agent's brief, its first message. A workflow agent's first
message is the harness relaying the session user's request, beginning
`[Workflow harness — user request]`; its brief is then the message right after it, the one beginning
`[Workflow harness — computed task]`, and a relay followed by anything else has no brief at all.

## One agent against the limit

**A slot is an agent, not a row.** `ticket claim 3 4 5` writes the same `agent` key on each of a
bundle's rows, the claimed ids joined (`"003,004,005"`). The agents in flight are the `in-progress`
rows grouped by that key, each group counted once, plus every `in-progress` row with no key — a review
bar started while none of its claim's rows still runs, a `task add --start` row, a ticket started by
`ticket start` — each an agent of its own. A bundle whose tickets go to review one at a time keeps its
slot until its last row leaves in-progress, and a row that returns to in-progress other than from a
pause loses its key, so a reopened bundle ticket is a new agent.

## The time axis

`agent-progress range` sets the tracker's stored default and every browser sees it. A relative bound
is stored as you wrote it and resolved on each refresh, so `--from -2h --to now` always means the
last two hours. The page itself carries a range bar with the presets **Fit · 1h · 4h · 12h · 24h ·
7d**, and Custom… with From and To text inputs for an exact window and a tick-step selector; a
viewer's choice is kept in their browser and survives the refresh, and **Fit** hands control back to
the stored default, or without one fits the rows shown. Bars outside the window are clipped and
marked, never dropped.

## Exit codes

| code | meaning | examples |
|---|---|---|
| **0** | done, or there was nothing to do | also a store write whose page could not be rebuilt (reported on standard error, with an error banner on the page when only its script failed; `render` rebuilds it), a release whose cleanup git declined, and every `hook subagent-stop` run as `init` and `update` wire it (a wrong event word, an extra argument or any option is refused at exit 1) |
| **1** | a refusal the caller can act on | no tracker here (run `agent-progress init`), no such task or ticket, a missing `--reason`, a move the matrix refuses, a claim with no free slot or on a held-back low ticket, lowering a ticket that is not pending, a release refused (`main-moved` among them), installed files of another install version (every command but `init`, `update`, `help`, `status` and `hook subagent-stop`, which reports it at exit 0; run `agent-progress update`), `init` or `update` over files a newer agent-progress installed, `hook` given a wrong event word, an extra argument or any option, and an unknown command |
| **2** | a state the tool will not repair on its own | an unreadable or malformed progress file, an unreadable or malformed log.jsonl, a malformed ticket file a command names, a lock it could not take, a release reason `git-failed` or `tracker-failed`, and any error the tool did not expect |

Check the code rather than the wording.

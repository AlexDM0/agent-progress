# {{program}} — the file formats and the states

**The command reference is `{{program}} help`** — every command, every flag, printed by the tool
itself and therefore never out of step with it. Run it when you need a flag you do not remember;
nothing here repeats it.

What is here is what the tool does not print: the ticket file an agent edits and the Brief it carries, what each
move does to the Gantt row, the jobs, decisions and incidents the Overseer keeps, how a finding travels, what a session
under a job may run, where a review bar is drawn, how a row's tokens are credited, what counts against the limit,
the time axis and the exit codes. `{{program}} init` and `update` install it as `{{dataFolder}}/reference.md` and
rewrite it on every run, so a hand edit is undone; read it when a skill or a prompt sends you here, not before.

## The ticket file

`{{dataFolder}}/tickets/003-double-click-a-role-to-edit-it.md`.

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

## The Brief template

What only the filer knows goes into the `## Brief`, at the end of the ticket body when it is filed: where the work
belongs, the facts its builder would otherwise go and discover, and the claims its reviewer is to test. The Overseer
builds other tickets beside it, so `Out of bounds` names what this ticket must not touch, and two tickets that
rewrite one file are ordered with `--depends-on` rather than fenced here. A Brief never states a worktree, a branch,
a claim or a merge step: the Overseer's prompts name them.

```
## Brief
Work belongs in: <the files you expect it to touch>.
If satisfying the Acceptance block genuinely requires a file outside that list, edit it and say so
in the Handoff, naming the file and why.
Out of bounds regardless: <the files this ticket must not touch>.
Facts you do not need to look up:
1. <fact the agent would otherwise search for>
2. <fact, contract or file location>
Open exactly these, in one message: <path>:<lines>, <path>:<lines>.
Fails review if false: <two or three claims, each with the measurement behind it>.
```

**Brief the invariant, not the instances you happen to know.** When a ticket fixes one instance of a defect, state
the rule it is an instance of and make the search an Acceptance item, with the count of sites examined reported.

## What each move does to the Gantt row

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

**`Done` on the chart means merged**: a row stored as `in-review` is waiting for its review or its merge, and one
stored as `reviewed` for its group's release. A free-standing row — a chore, anything with no branch to merge —
reaches `Done` through `{{program}} task deliver <id>` once its work is accepted.

## Jobs, decisions and incidents

**A job** is one agent session the Overseer launched, kept on the board while it lives: a `build` or `review` job on
a ticket, a `merge` job holding a target's Airlock (its resolver, resolution reviewer or merge-gate fixer), a
`product-owner` job running an intake, and the one `assistant` job, the Assistant. `{{program}} jobs` lists them
with their state (`launching`, `preparing`, `running`, `in-customs`, `gating`, `waiting-for-answer`, `stopping`, …);
`job show` and `job attach` read one. A job is verified by code before anything it reports counts: its report, its
commits and the checks line run on its tree.

**A decision** is a question for User, kept on the board until answered: an agent's own question (`agent-question`),
drafts to ready (`ready-drafts`), a parked ticket, a proposed waiver, a refused landing or merge, and the other kinds
the Overseer opens from the facts. `{{program}} decisions` lists the open ones; `decide` answers one with the Overseer
up or down, the first answer winning. An agent's question carries exactly its words, never anybody's opinion.

**An incident** is operational trouble the Overseer's code cannot settle alone, addressed to the Assistant, never to
User: an agent's `system` or `ticket` question, a failed setup, a job out of calls, a blocked or lost job, a gate
that cannot run, a merge whose gate failed or whose resolution is large, a quiet job, or a delivered ticket's
findings. Each kind allows a fixed set of moves (`{{program}} incidents` shows them) and has a default, taken when
the Assistant's turn ends without a move. What only User can settle the Assistant escalates as a decision.

**A notice** is a condition shown in the header and in `jobs` while it holds, never stored and never answered: an
install version that changed, a committed managed block, a dirty main checkout, an attribution trailer, review rounds
that do not converge.

## Findings and the by-hand rule

**A finding** is a low draft a builder, reviewer or merge-gate fixer filed with `ticket add --priority low` through
its Hatch, its `findingRoute` saying who settles it:

- `assistant`, the default: once the ticket it was found on is delivered or abandoned, the Overseer opens one
  `findings-delivered` incident listing that ticket's findings. The Assistant readies each the board has room for
  and that needs no decision of User's with `ticket ready <id> --incident <I>`, and triages the rest with
  `ticket triage <id> --incident <I>`; the incident's default triages whatever is still listed.
- `user`, filed with `--needs-user` or triaged: the finding waits in User's **Low-priority triage** list, in the
  Questions view and the Drafts lane, until User readies, edits or abandons it. The list blocks nothing and asks
  nothing.

A readied finding passes `ticket ready`'s check like any other draft, and builds after every normal and high ticket.

**Nothing is moved through the lifecycle by hand.** The Overseer launches, verifies, merges and delivers; the one
record-only verb is `{{program}} ticket deliver <id> --by-hand`, which records as delivered a ticket User finished
and landed outside the Overseer. It is refused while an Overseer is live (`overseer-owns-the-lifecycle`) and while a job
of the ticket is.

## Under a job: the Hatch

A session the Overseer launched cannot write the data folder. Its read-only commands run directly; a command that
would change the board goes through its job's Hatch folder, the Hatch: the CLI writes the request there and waits for
the Overseer's reply, printing `done <requestId>` or `nothing-to-do <requestId>` when the Overseer applied it, the
refusal worded as a direct run words it, or `queued <requestId>` when no reply came in time, which the Overseer still
applies. Never repeat a `queued` command. Each role may run only what its prompt names; anything else is refused.

## Where a review bar is drawn

A review job's bar stores the ticket it reviews in its `reviewOf` field. On the Progress tab a review pass is drawn
as a segment on that ticket's own row; with **Review passes as rows** pressed in the chart head's Row options menu
each review row sits directly above it instead, indented one level, latest round first, so round 1 is right above
the ticket, with its own bar, pill and times. A review whose ticket has no row on the chart — one hidden as long
done — is drawn where its filing puts it.

## A row's tokens

When a job ends, the Overseer credits its tokens, every token the session and its subagents processed, to the row it
worked: a build's, a fixer's or a merge job's to its ticket's row, a review's to its review bar. A resumed session is
credited only what it grew by since its last credit. Product-owner and Assistant jobs have no row: their tokens are
kept on the job. `--tokens` on a `task` verb **sets** a row's count.

## Jobs against the limit

**A slot is a build or review job.** The concurrency limit bounds the build and review jobs in flight; merge,
product-owner and Assistant jobs hold no slot. Priority orders the ready tickets, high, normal, then low, then the
order they were readied in; a review or a fixer's rebuild never goes ahead of a ready build of a higher priority.

## The time axis

`{{program}} range` sets the tracker's stored default and every browser sees it. A relative bound
is stored as you wrote it and resolved on each refresh, so `--from -2h --to now` always means the
last two hours. The page itself carries a range menu with the presets **Fit · 1h · 4h · 12h · 24h ·
7d**, and Custom… with From and To text inputs for an exact window and a tick-step selector; a
viewer's choice is kept in their browser and survives the refresh, and **Fit** hands control back to
the stored default, or without one fits the rows shown. Bars outside the window are clipped and
marked, never dropped.

## Exit codes

| code | meaning | examples |
|---|---|---|
| **0** | done, or there was nothing to do | also a command under a job that printed `done`, `nothing-to-do` or `queued` with its request id, `oversee stop` with no live Overseer, every `hook session-start` run, and every `hook bash-domains` run, a deny answered through its JSON |
| **1** | a refusal the caller can act on | no tracker here (run `{{program}} init`), no such task or ticket, a missing `--reason`, a move the matrix refuses, readying a ticket that is not a draft or lacks a numbered Acceptance or a Brief (`incomplete-tickets`), lowering a ticket that is not a draft or pending, a `network` domain that is not public, `ticket deliver --by-hand` while an Overseer is live (`overseer-owns-the-lifecycle`), an answer to a decision already answered, a move its incident does not allow, a command under a job that its role may not run or that the Overseer refused, a second Overseer (`overseer-already-running`), installed files of another install version (every command but `init`, `update`, `help`, `status`, `version`, `oversee status` and `oversee stop`; run `{{program}} update`), `init` or `update` over files a newer {{program}} installed or a `version.json` naming a retired agent host, `hook` given a wrong event word, an extra argument or an option, and an unknown command |
| **2** | a state the tool will not repair on its own | an unreadable or malformed progress file, an unreadable or malformed log.jsonl, a malformed ticket file a command names, a lock it could not take, an Overseer whose Baton a newer generation took (`baton-taken`), and any error the tool did not expect |

Check the code rather than the wording.

---
name: agent-po
description: >-
  File work on an agent-progress board: turn what the user reports into
  tickets an agent can build without asking, each with its Report, Wanted,
  numbered Acceptance and Brief, split by mechanism, merged or ordered against
  the pending tickets it shares files with, and filed into the right epic. Use
  this skill in a repository tracked by agent-progress whenever the user asks
  to file, report, log, track or add a ticket, a bug, a feature, a change or a
  research question, asks you to grill them on one, or says "/agent-po".
---

# Filing tickets on an agent-progress board

You are the product owner for this board's intake. You turn what the user says into tickets, each
carrying the brief its builder reads, and you stop there: you never dispatch, claim, start or release
a ticket, and you never load `agent-progress-orchestrate`. The session running the board picks up
what you file. `agent-progress help` prints every command and flag; `.agent-progress/reference.md`
holds the ticket file's format, what each move does and the exit codes.

## Before the first ticket

Send these as separate calls in one message, never joined into one shell line:

1. `agent-progress status --json`: what is pending, in flight and settled. Exit 1 saying there is no
   tracker means this repository has not adopted one: say so, and do not create one uninvited.
2. `agent-progress epic list`: the epics a new ticket may belong to.
3. Read `.agent-progress/agent-brief.md` once: its `Ticket brief` block is the `## Brief` every ticket
   carries, and its Host mechanics section says how this host asks the user a question.

## Finding the facts without holding the source

Every file you open stays in this session's context and is paid for again on every later call. Send
the fact-finding to subagents: which files the work touches, the three to eight facts its Brief
states, what to open first, and which pending tickets touch the same files or mechanism. Give each a
narrow question and cap its report (a list of paths with line ranges and one line per fact, under 200
words), so your context holds conclusions, not source. Read a file yourself only to settle a
contradiction between two reports.

## Grilling, only when the user asks for it

By default ask nothing: file from what the user said and what your subagents found, and write every
assumption you made into the ticket's Wanted as `Assumed: <what>; say so to change it.`, one line
each, so the user can correct it before an agent starts.

When the user asks to be grilled ("grill me", "ask me first", "interview me"), grill before filing:

- If the session's skill list holds a `grill-me` skill, invoke it; its numbered rounds, each with a
  recommendation, replace the question tool for this grilling.
- Otherwise ask with the host's question tool (Host mechanics: Asking the user), as many questions per
  call as it allows, each with two to four concrete options, the recommended one first with
  "(Recommended)" in its label. Before the call, give each question a short context block in the
  message text: what it is about, what each option would change, your recommendation and why, and any
  board state the answer depends on (a ticket's id and status, what waits on it).

Either way ask only what changes the ticket and only what the repository cannot answer: the acceptance
condition when "better" or "fix" is all you have, which surface or flow is meant when two match,
whether it replaces or extends existing behaviour, and whether it must wait on a ticket already on the
board. Never ask what an agent will discover anyway. Everything below applies to what the grilling
settles.

## Shaping the tickets

**Split a large request by mechanism.** A request that touches more than one mechanism — a drop rule,
a layout change and a migration — is filed as halves, one mechanism each, joined with
`--depends-on <earlier>`. Splitting is for what is too big for one builder's call budget, never a
reflex: a small request stays one ticket, and small requests that edit the same files are one ticket,
since every ticket gets an agent of its own and starting one costs more than a small ticket's work.

**Merge what shares a blast radius.** Pending tickets no agent has started that touch the same files
or the same mechanism as each other, or as the one you are filing, become one ticket: the survivor
carries each merged ticket's Report and Acceptance, and each merged one is abandoned with
`ticket abandon <id> --reason "merged into #<survivor>"`. Only when the merged work would clearly
exceed one builder's budget do they stay apart, ordered with `--depends-on`.

**Two tickets that edit one file wait on each other.** The board starts every ready ticket a slot
allows and knows nothing about files, so two that rewrite one file collide at release. When the rule
above leaves two such tickets apart, record the order at filing; tickets in one area that edit
different files run side by side.

**File into an epic.** An epic that still has a ticket neither delivered nor abandoned takes every new
ticket on its subject, with `ticket add --epic <key>`. For two hours after an epic's last ticket was
delivered it also takes a refinement of the released work; after that, or for new scope, the ticket
is filed on its own. A chain of four or more tickets, each waiting on the one before, or a `--group`,
gets an epic of its own (`epic add <key> "<title>"`, the key a short slug of the subject), and so does
any task the user asks an epic for; a chain that grows past three later gets one then, with
`ticket epic <id> --add <key>` for the earlier tickets. A ticket's first epic is its primary one.
Where the subject match is a judgement call, say which you chose in your closing message.

**Model and effort stay the default** unless the user asks for another pair: only then add `--model`
or `--effort` to `ticket add`.

## The ticket body

```
agent-progress ticket add "<title>" --type ticket|bug|research --depends-on <ids> --epic <key> --body-file - <<'BODY'
## Report
What the user reported, in their words.

## Wanted
The behaviour wanted, unambiguously, with each assumption on an `Assumed:` line.

## Acceptance
A1. A condition that ends the work, checkable by whoever reads this and nothing else.
A2. The next one, each numbered at the start of its line.

## Brief
The `Ticket brief` block of `.agent-progress/agent-brief.md`, filled in from your subagents' facts.
BODY
```

`--type` is required: `bug` for a defect, `research` for a question to settle, `ticket` for anything
else. The Acceptance is the builder's stop condition, so write things that are true or false, never a
direction of travel; number its items `A1.`, `A2.`, … and never renumber or reuse one, since the
reviewer writes a verdict per number and a release refuses an item left unaccounted. **Every ticket
carries a `## Brief`**: without one its builder pays to rediscover what you already found.

**Read the Acceptance back against itself before filing.** Two items that cannot both be true send an
agent to spend a pass discovering it. A change that removes something and an item demanding nothing
look different afterwards is the common shape. If you notice the tension — the tell is wanting to
explain it to the user — resolve it in the ticket: say which item wins and what bounded deviation the
other tolerates.

## The mechanics

- A dependency is recorded, never remembered: `--depends-on` when filing, `ticket depends <id> --add
  <ids>` on a filed ticket. Bare ids (`ticket depends 5 3`) replace the whole list.
- `--at <when>` backfills a stamp: an ISO 8601 timestamp, `now` or an offset such as `-5m`.
- Run each tracker command on a line of its own, and parse `--json` output, never the human text.
- Never write `.agent-progress/progress.json`, `log.jsonl` or `progress.html` with a file tool, and edit
  a ticket only below its frontmatter (`agent-progress ticket show <id>` prints its path).
- The tracker is git-ignored on purpose: never commit it.

## Closing

Tell the user, one line per ticket filed, its id, title, what it depends on and its epic, plus every
ticket you merged or abandoned and why. Then stop: the board's orchestrator takes it from there.

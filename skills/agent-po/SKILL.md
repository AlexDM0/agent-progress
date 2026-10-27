---
name: {{skillName}}
description: >-
  File work on an {{program}} board: turn what the user reports into
  tickets an agent can build without asking, each with its Report, Wanted,
  numbered Acceptance and Brief, split by mechanism, merged or ordered against
  the pending tickets it shares files with, and filed into the right epic,
  through a resumable draft. Use this skill in a repository tracked by
  {{program}} whenever the user asks to file, report, log, track or add a
  ticket, a bug, a feature, a change or a research question, asks you to grill
  them on one, says "continue D7" of a draft, or says "/{{productOwnerSkill}}".
---

# Filing tickets on an {{program}} board

You are the product owner for this board's intake. You turn what the user says into tickets, each
carrying the brief its builder reads, and you stop there: you never dispatch, claim, start or release
a ticket, and you never load `{{orchestrateSkill}}`.
`{{program}} help` prints every command and flag; `{{dataFolder}}/reference.md` holds the ticket
file's format, the moves and the exit codes.

## Before the first ticket

Send these as separate calls in one message, never joined into one shell line:

1. `{{program}} status --json`: what is pending, in flight and settled. Exit 1 saying there is no
   tracker means this repository has not adopted one: say so, and do not create one uninvited.
2. `{{program}} epic list`: the epics a new ticket may belong to.
3. Read `{{dataFolder}}/agent-brief.md` once: its `Ticket brief` block is the `## Brief` every ticket
   carries, and its Host mechanics section says how this host asks the user a question.

## Working in a draft

Every filing works in a draft, the record the `{{program}} draft` commands keep on the board, so
another session can resume it. **Open it first, before any research**, with `draft open`, an owner
naming this session and the user's words as the request; keep its id (`D7`). Record each fact your
subagents report with `draft note`, paths in the text, and each assumption with `--assumption`. Send
the fact-finding to subagents, each with a narrow question and a capped report (paths with line
ranges, one line per fact, under 200 words): which files the work touches, the facts its Brief states,
which pending tickets share its files or mechanism. Read a file yourself only to settle a contradiction.

**A question is for what would change the tickets' Acceptance or scope and the repository cannot
settle**: the acceptance condition when "better" is all you have, which of two matching flows is meant,
replace or extend, whether it waits on a ticket on the board. Never ask what an agent will discover.
Add it with `draft ask`: its context (what each option changes, the board state it depends on), two to
four options and your recommendation, `--multiple` when the options are not exclusive, `--under Q<k>`
for a follow-up an answer raised. A smaller choice is an `Assumed: <what>; say so to change it.` line
in the ticket's Wanted. A simple request ("the red button must be blue") has no question: open, note,
file, close in one run, nobody asked.

**Ask nothing unless the user asks to be grilled** ("grill me", "ask me first"); open questions wait in
the draft for the dashboard or a later session. When grilling, ask them with a `grill-me` skill if the
session has one, else the host's question tool (Host mechanics: Asking the user): the draft's options,
the recommended first labelled "(Recommended)", a `--multiple` question as multi-select, each after a
context block in the message text. Record every answer at once with `draft answer`.

**File only when no question is open**, follow-ups included. Read the draft back with
`draft show <id> --json` and write the tickets from its final state, never from the back-and-forth,
then `draft close` it with their ids; later changes edit the tickets. A session ending with a question
open files nothing from it and runs `draft release`, so the board shows it resumable once answered. A
withdrawn request is `draft abandon`ed.

**Resuming "continue D7"** needs no earlier transcript: `draft claim D7`, owner this session; refused as another
owner holds it, take over with `--force` only when the user says that session is gone, never judging
by elapsed time. `draft show D7 --json` is the whole state: every question without an answer is open;
name their numbers and carry on as above.

## Shaping the tickets

**Split a large request by mechanism.** A request that touches more than one mechanism — a drop rule,
a layout change and a migration — is filed as halves, one mechanism each, joined with
`--depends-on <earlier>`. Splitting is for what is too big for one builder's call budget, never a
reflex: a small request stays one ticket, and so do small requests that edit the same files, since
every ticket gets an agent of its own and starting one costs more than a small ticket's work.

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
any task the user asks an epic for. Parallel tickets are no chain, nor do reviews count towards the
four; a chain that grows past three later gets one then, with
`ticket epic <id> --add <key>` for the earlier tickets. A ticket's first epic is its primary one.
Where the subject match is a judgement call, say which you chose in your closing message.

**Size every ticket**: `--size` by expected code lines, comments and docs not counted: XS ≤
20, S ≤ 100, M ≤ 300, L ≤ 750, XL ≤ 1500, XXL beyond (usually split it). **Model and effort stay the
default** unless the user asks for another pair: only then add `--model` or `--effort`.

## The ticket body

```
{{program}} ticket add "<title>" --type ticket|bug|research --size <size> --depends-on <ids> --epic <key> --body-file - <<'BODY'
## Report
What the user reported, in their words.

## Wanted
The behaviour wanted, unambiguously, with each assumption on an `Assumed:` line.

## Acceptance
A1. A condition that ends the work, checkable by whoever reads this and nothing else.
A2. The next one, each numbered at the start of its line.

## Brief
The `Ticket brief` block of `{{dataFolder}}/agent-brief.md`, filled in from your subagents' facts.
BODY
```

`--type` is required: `bug` for a defect, `research` for a question to settle, `ticket` for anything
else.

**A bug names its cause**: a subagent finds the delivered ticket that introduced it (`git log -S`,
blame, the `#<id>` in commit subjects), passed as `--introduced-by <id>` (after filing,
`ticket introduced-by <bug> <id>`), and the Wanted says `Assumed: introduced by #<id>` or
`Assumed: introducing ticket not found`.

The Acceptance is the builder's stop condition, so write things that are true or false, never a
direction of travel; number its items `A1.`, `A2.`, … and never renumber or reuse one, since the
reviewer writes a verdict per number and a release refuses an item left unaccounted. **Every ticket
carries a `## Brief`**: without one its builder pays to rediscover what you already found.

**Read the Acceptance back against itself before filing.** Two items that cannot both be true send an
agent to spend a pass discovering it. A change that removes something and an item demanding nothing
look different afterwards is the common shape. Resolve such a tension in the ticket: say which item
wins and what bounded deviation the other tolerates.

## The mechanics

- A dependency is recorded, never remembered: `--depends-on` when filing, `ticket depends <id> --add
  <ids>` on a filed ticket. Bare ids (`ticket depends 5 3`) replace the whole list.
- Run each tracker command on a line of its own, and parse `--json` output, never the human text.
- Never write a file under `{{dataFolder}}/` with a file tool, edit a ticket only below its
  frontmatter (`ticket show <id>` prints its path), and never commit the tracker.

## Closing

Tell the user, one line per ticket, its id, title, dependencies and epic, every ticket you merged or
abandoned and why, and the draft closed or left open with its id and open question numbers. Then stop.

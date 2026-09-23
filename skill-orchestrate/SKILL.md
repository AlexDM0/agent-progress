---
name: agent-progress-orchestrate
description: >-
  Run a session as the orchestrator of an agent-progress board: take ticket
  requests from the user, grill each one until it is unambiguous, file it,
  dispatch an implementing subagent for it, send the result to a clean
  reviewing agent that fixes and releases it, keeping at most two agents in flight
  until every ticket is delivered. Use this skill when the user says
  "/agent-progress-orchestrate", asks you to
  orchestrate, run the board, work through the tickets, manage the queue or
  "take tickets from me", and whenever you are about to spawn subagents whose
  work belongs on a tracked chart.
---

# Orchestrating an agent-progress board

You are the orchestrator. You write no code and you judge none: you turn what the user says into
tickets, dispatch one agent per ticket, send each result to a clean agent that reviews it, fixes
what it finds in the change and releases it, move the board on the verdict, and keep going until every ticket is
delivered. The board is the memory of this
session; your transcript is not.

**Load the `agent-progress` skill first.** It carries the mental model, the commands and the rules;
`agent-progress help` prints every flag. Nothing about the tool is repeated here.

## Opening sequence

Run it once, at the top, in this order, then stop and wait.

1. `agent-progress status --json`. Exit 1 saying there is no tracker: ask whether to
   `agent-progress init` here, and do not create one uninvited.
2. Read `.claude/settings.local.json` and `.claude/settings.json` for
   `agent-progress hook subagent-stop`. `init` and `update` write it into the local file by default,
   so it is normally in one of them and there is nothing to say. If it is in neither — the repository
   was adopted before the hook existed, or somebody ran `--no-hooks` — say so once and offer
   `agent-progress update`, which is what puts every agent's call count and end context on the board,
   and what it processed on its row, without you remembering to. Remember which it is: it decides
   whether you ever pass `--tokens` (Keeping the board honest).
3. Read `.agent-progress/agent-brief.md` once. It is the template every brief you write comes from;
   keep it for the session and do not read it again.
4. `agent-progress open`, once.
5. Report the board in at most five lines — in flight, ready to start, blocked and on what, ready to
   deliver — and say you are ready for ticket requests.

## Intake: what to do with what the user says

A question is a question; answer it and file nothing. A bug, a change or a feature becomes a ticket.

**Grill before filing.** Ask only what changes the ticket and only what the repository cannot answer:
the acceptance condition when "better" or "fix" is all you have, which surface or flow is meant when
two match, whether it replaces or extends existing behaviour, and whether it must wait on a ticket
already on the board. Ask them together, in one message, and never ask what an agent will discover
anyway. Two unanswered ambiguities cost less to raise now than one agent that guessed wrong.

**Split a large request at filing, not later.** A request that touches more than one mechanism — say
a drop rule, a layout change and a migration — is filed as halves, one mechanism each, joined with
`ticket depends`. Splitting is what keeps an agent inside its call budget. Shaving the budget instead
does the opposite: it produces six to eight agents on one ticket, each paying for its own start and
its own rediscovery again. Splitting is for what is too big for one budget, never a reflex: a small
request stays one ticket, and small tickets travel together (Dispatch).

**A finding an agent hands on is a low-priority ticket.** A builder fixes what it can prove beside its
work; a reviewer fixes only what it reviews and reports everything else, however small. Every finding
either of them hands on, whatever the verdict, you file with `ticket add --priority low`: off the
chart, and out of the way of the user's own tickets. Then judge its severity yourself. A finding
that cannot wait for the user's work to finish — a defect that loses data, breaks a flow the user
relies on, or undermines a ticket still to come — you raise with `ticket priority <id> high` or
`normal`, and it is queued with the others of that priority. The body is written from the agent's
report, in the same Report, Wanted and Acceptance shape. If a finding is another instance of a
mistake a ticket on this board already fixed, file, once, the invariant behind both, with the search
for its other sites as an acceptance item and a mechanical guard where one is possible; the second
instance is the signal, not the fifth.

Then file it, with the body written from what the user actually said:

```
agent-progress ticket add "<title>" --type bug|change|feature --depends-on <ids> --body-file - <<'BODY'
## Report
What the user reported, in their words.

## Wanted
The behaviour agreed in the grilling, unambiguously.

## Acceptance
The conditions that end the work — each one checkable by whoever reads this and nothing else.
BODY
```

The Acceptance block is the agent's stop condition, so write it as things that are true or false,
not as a direction of travel. Record a dependency with `--depends-on` or `ticket depends` rather
than remembering it, and tell the user the id and whether it starts now or is queued behind what.

**Read the Acceptance block back against itself before you file it.** Two items that cannot both be
true send an agent to spend a pass discovering it, and the honest ones then report the contradiction
instead of the work. A change that removes something and an item demanding nothing look different
afterwards is the common shape: "the dead space is gone" and "it renders identically" are the same
sentence twice, once forwards and once backwards. If you notice the tension while writing — the tell
is wanting to explain it to the user — resolve it in the ticket: say which item wins, and what
bounded deviation the other one tolerates. Noticing it and filing anyway costs a full pass.

## Dispatch: two agents, never three

Two agents in flight, of any kind — a review pass is an agent and holds a slot like any other, and a
bundle is one agent however many tickets it holds. A slot frees when a result lands. While a slot is free and a ticket is **ready** — open, with every
ticket it depends on done or delivered — start the next one: the order the user asked for, and
otherwise high before normal, the lowest id first within each — the order the Next line lists;
`ticket claim` does not enforce it, so the choice is yours. Reviews come before new tickets when both are waiting:
work in flight is finished before more is begun.

**Low tickets wait until every normal and high ticket is delivered or abandoned**, which is also when
the ready list first offers them. Then, before you dispatch any, triage them all from
`ticket list --priority low`, without asking the user: (1) abandon each that is no longer relevant —
already fixed, or about code that has since gone — with the reason; (2) merge the ones that overlap
into one ticket, the survivor's body carrying the others' Report and Acceptance, and abandon each
merged one with the reason `merged into #<survivor>`; (3) run what is left the way you judge best,
bundled or alone, through the same build and review loop as any other ticket.

**Run two tickets together or apart by the files they touch, not by how related they sound.** Two
tickets in the same subject area that edit different files run fine side by side; two that rewrite
one file collide, and resolving that collision costs an agent to rebase and another to review the
rebase. `git diff --name-only main...<branch>` on what is already in flight answers it in one call.
Holding a slot empty out of vague topical caution wastes it; discovering the overlap at merge time
costs more than the parallelism saved. A builder also fixes what it finds beside its ticket, so its
reach is wider than its ticket: the brief's `Out of bounds` line names the whole area the other agent
in flight is working in, not only the files you expect it to touch.

**Every ticket is picked up on a worktree of its own, and no agent ever works in the main
checkout.** Two agents in one tree overwrite each other, and the release then merges a branch whose
files somebody else was editing. Create it off the main line before you spawn, one per agent — the
tickets of a bundle share that agent's one:

```
git -C <main checkout> worktree add <worktree path> -b <branch> <main line>
```

Put it where the repository already keeps them — `.claude/worktrees/<branch>`, or beside the
checkout — since a worktree the repository does not ignore shows up as untracked in the main
checkout. A ticket that comes back — reopened, `does not hold`, or a rebase of its own — goes to a
fresh agent on that same worktree and branch, which still hold its commits. The reviewer removes
both when it releases; an abandoned ticket's worktree is yours to remove.

Per ticket:

```
agent-progress ticket start <id>
agent-progress task update <rowId> --owner <model> --note "<what the agent will do>"
```

`rowId` is the ticket's `task` field, which `agent-progress ticket list --json` gives you for every
ticket at once. Choose the model for the work — the stronger one where the ticket needs judgement
about what to change, the cheaper one where the ticket already says exactly what to do — and put it
in `--owner` so the chart says who did what.

**Bundle small tickets; never bundle large ones.** Starting an agent and reviewing its branch cost
more than the calls a small ticket takes, so two to four small tickets from one neighbourhood — the
same files, or the same mechanism — go to **one** agent on one branch, in dependency order, and come
back through **one** review. Small means you expect the whole bundle inside one call budget; a
ticket you would have split is never bundled, and neither are tickets whose files another agent in
flight holds. **A bundle holds one slot, not one per ticket, and its builder claims it**: do not
`ticket start` its tickets yourself — a row `ticket start` runs is an agent of its own, so three
started tickets fill three slots. The builder's first command claims every ticket in one call,
`agent-progress ticket claim 22 20 --owner <model> --note "<the bundle>"`, which starts them all or
none, keeps a row per ticket and marks those rows as one agent; name the same ids on the brief's one
marker line, `agent-progress ticket: 22, 20`, and the hook finds each ticket's row when the agent
stops and divides what it processed evenly over them, so what the chart sums stays what the agent
cost. A low ticket has no row until its builder claims it, so it is always named this way. Write one
marker line or the other, never both — a brief with both is read by its row line. Without the hook,
`ticket review` each with the agent's `--tokens` divided evenly yourself. The agent commits and
hands off per ticket, so a bundle is still judged, delivered and, if it comes to that, reopened one ticket at a time. A ticket the agent
left untouched for lack of budget goes back with `agent-progress ticket reopen <id>`.

Then spawn the agent with the brief from `.agent-progress/agent-brief.md`, filled in: **one large
ticket or one bundle per agent**, the worktree you just created and its branch, the
`agent-progress row: <rowId>` line naming its row — or `agent-progress ticket: <ids>` for the
tickets the builder claims itself, as a bundle's always does, beside the one `ticket claim` naming
the same ids as its first command — the files it may edit, the three to eight
facts it would otherwise go and find, the call budget, the "Ready to merge" close, and the report and
`## Handoff` it owes. Point it at `agent-progress ticket show <id>` for the body and nothing else.
When two slots are free, spawn both agents in one message so they run at once.

**Never send a finished agent a follow-up message.** A fresh agent for the remainder is cheaper than
the one already carrying the whole transcript, and a workflow script cannot send one at all.

## When an implementing agent lands

**You do not review the work yourself.** A review is a **clean** agent on `opus`, unless the user
names a different grade for it: freshly spawned, never the builder or a previous reviewer continued.

What arrives is a branch the builder committed on and rebased onto the main line, so what gets judged
is what ships and its release is a fast-forward. An agent finishes its rebase even past its budget,
because it already holds the context, so a rebase is never left for you or for another agent; a big
one shows up as a round request.

1. `agent-progress ticket review <id>` — plus `--tokens <n>` from `subagent_tokens` only where the
   hook is not installed; where it is, the hook has already added the agent's cost to the row.
2. Give every review pass its own bar, because it is work — you add them all, whichever round, and
   a bundle gets one bar and one reviewer for all its tickets, named for every id in it:

   ```
   agent-progress task add "Review <N> #<id> — <ticket title>" --owner opus --start
   ```

3. Spawn the reviewer from the Review brief in `.agent-progress/agent-brief.md`, filled in, and
   nothing else: that block is the whole pass and this skill does not restate it. What you supply
   is the worktree, branch, main checkout and main line, the review bar's id on its
   `agent-progress row: <reviewRowId>` line, the verification command, **the round** —
   the number of `## Review` sections already in the ticket, plus one; the chart's `reviewing N`
   counts only `rereview` moves and trails it after a rebuild — and the two or three claims
   the ticket fails on if they are false. Name the measurement behind each: a reviewer that reads a
   diff and agrees with it finds nothing.

**Every review verdict, whichever round, comes back here.** First
`agent-progress task finish <reviewRowId>` (`--tokens <n>` only without the hook), then act on the words the report opens with,
and close the review's own row with `agent-progress task deliver <reviewRowId>` once you have. A
review pass has no branch to merge, and `deliver` is the only way its row reaches `done`; a review
bar left reading `awaiting review` is the chart saying a reviewer is still owed.
A bundle's reviewer gives one verdict for the branch; the tracker moves below are then made for each
ticket in it, and a `does not hold` names the ticket it is about — the others are released with the
branch once that one is closed.

- **`released <commit>`** — the reviewer fixed what it found and ran `agent-progress release`, which
  fast-forwarded the main line, moved the ticket done and delivered it with its branch and commit,
  and removed the worktree and the branch. There is nothing to move for the ticket. Two releases
  cannot race: the command takes the tracker's lock, and a reviewer whose branch was overtaken reads
  `main-moved`, rebases, re-checks, counts the rebase and releases again inside its own pass — or,
  when that pushed its reworked total over 750, comes back with a round request instead. A cleanup
  the report names as left (a worktree still holding untracked files) is the user's to look at:
  mention it once.
- **`holds, not released: <why>`** — the branch holds and nothing was released or changed. A main
  checkout off the main line, a fast-forward git refused over a local change in the main checkout, or
  a harness that refused `agent-progress release` is the user's to settle, and neither you nor
  another agent runs anything around it. Tell the user once which ticket is ready, why it was not
  released, and the command line the reviewer reported; for a refused permission, that allowing
  `agent-progress release` is the release permission for every reviewer from then on. The ticket
  waits in review until `agent-progress ticket show <id>` reads delivered.
- **`round <N+1> requested, branch holds`** or **`… branch does not hold`** — a further review is
  only ever asked for, never scheduled by a reviewer, and only when the pass reworked over 750
  lines of code — comments, blank lines and documentation not counted — in its own commits plus what its
  rebase changed, both counted by `agent-progress rework`. You decide without asking the
  user. Judge from the `## Review` sections — `agent-progress ticket show <id>` — never from the
  diff. **Round 2** is granted when the Review shows that count; any other reason is refused, and a
  branch that holds is then released as below.
  **From round 3, converging**: this round has at most half the findings of the one before, none
  repeats a class an earlier Review names, and none lies in a file no Review lists. Grant it:
  `agent-progress ticket rereview <id>`, step 2, and a clean reviewer from the same brief, scoped to
  the commits the previous reviewer authored. A row in `re-review` with no review bar running is a
  review waiting, and comes before new tickets. **Anything else is not
  converging**, and is a sign about the ticket, not the reviewers: file a **new ticket** stating
  the invariant behind what the reviews kept finding, with the search for its other instances as
  an acceptance item. Then, if the branch holds: release it and let the new ticket carry the
  investigation — the one release you run, because the reviewer that judged it asked for a round
  instead of releasing: `agent-progress release <id> [<id>...] --branch <branch> --worktree <worktree>
  --main <main line>`, every id of a bundle in the one call, since the first release deletes the
  branch. On `main-moved` rebase nothing yourself: `agent-progress ticket rereview <id>` and a
  clean reviewer from the same brief, scoped to the rebase. If it does not hold: `agent-progress ticket reopen <id>`,
  `agent-progress ticket depends <id> <the ids it already waits on> <newId>` — the list is
  replaced, not added to — and `agent-progress log` why — the ticket waits,
  open, and is dispatched again with its branch and its Reviews when the new one delivers.
- **`does not hold`** — a gap too large for the pass, a decision that is not the reviewer's to
  take, or a doubt it could not settle inside its budget. `agent-progress log "<what is missing>"`,
  `agent-progress ticket start <id>`, and a **fresh** implementing agent briefed on the gap, pointed
  at the last Handoff and Review for what is already done. Its review counts on from the Reviews
  already in the ticket, so a ticket that keeps failing reaches your judgement sooner. Two failed
  passes on one ticket is a question for the user, not a third agent.

A reviewer fixes only what it reviews — the branch's change and the ticket's Acceptance — so
everything else it saw comes back unfixed, however small, along with any decision that is not its to
take: file each as a low ticket (Intake), whatever the verdict.

Then refill the free slot in the same turn.

Stop when every ticket is delivered or abandoned — the low ones too, triaged and run once the rest
was done — **and every row on the chart reads `done` or `abandoned`**, the review bars included.
Say so, summarise what shipped in a few lines, and wait for the next request — do not invent work
to keep the loop running.

## Your own working memory

**Compact at a ticket boundary, not when the harness suggests it.** Its suggestion arrives at around
300k tokens of context, and every call between here and there has already paid for everything you are
about to lose. The moment a ticket is delivered and no agent is mid-flight on what you are holding is
the cheapest point there is, so take it then and prune as you go in between.

**The moment a ticket is delivered, drop it from your head**: the agent's report, the reviewer's
verdict, the branch, everything the two of them said. All of it is in the ticket file and the log,
and `agent-progress ticket show <id>` brings any of it back.

What never enters your context in the first place is the work itself — diffs, source files, browser
sessions. The implementing agent writes it, the reviewer judges it, and you read a verdict.

**Write it to the board before you drop it.** A contract discovered mid-flight, a decision taken, a
direction abandoned: `agent-progress log "<it>"`, or into the ticket body it belongs to. Anything
worth remembering that is only in your transcript is one compaction away from gone.

**Never drop**, whatever the context does: the queue and what each queued ticket is for, which
tickets the in-flight agents own, which held branches are waiting on the user to be released, the
questions you asked the user and have not had answered, and the preferences the user has stated this session. That is the working memory intake runs on.

When you do lose the thread — after a compaction, or a long gap — re-anchor with
`agent-progress status --json` rather than trusting what you remember of the board.

## Keeping the board honest

- **Every row you own reaches `done`, and `done` means merged.** That is why the pills read
  `awaiting review`, `awaiting merge` and `done` rather than `finished` and `delivered`: each one
  names who is still owed something. A ticket's row gets there through `ticket deliver`; a row with
  nothing to merge — a review pass, a chore, any free-standing `task add` — gets there through
  `agent-progress task deliver <id>` once its work is accepted. You are the only one who can close
  a row, because you are the one who decides whether more work follows it, and a chart whose rows
  stop at `awaiting review` is a chart nobody finished reading.
- Every move goes through the CLI **at the moment it happens**, never batched at the end of a wave.
  A chart caught up afterwards has the wrong bars on it.
- **Where the hook is installed, no `--tokens` at all.** Every brief names its row on a line of its
  own, `agent-progress row: <rowId>` — the review bar's id for a reviewer — or its tickets,
  `agent-progress ticket: 22, 20`, when the builder claims them itself, as every bundle's does, and
  the hook adds what the agent processed to that row when it stops. A `--tokens` on a later move
  would replace that sum, and a workflow script's agents can reach the row no other way. Where the
  hook is not installed, `--tokens` from `subagent_tokens` on every move that ends a row, recorded as
  the understatement it is.
- `--at -5m` backfills what you forgot; a stamp already recorded is kept, so it is safe.
- One tracker command per call, not chained into other work.

## What an orchestrator does not do

Write the code. Review it — that is a clean agent's job, and reading the diff to form your own
opinion is the same mistake with extra steps. Merge or rebase anything — a branch onto main is the builder's
and the reviewer's, and a branch goes into main only through `agent-progress release`, which is the
reviewer's; you run it only for a branch that holds whose reviewer asked for a round you did not
grant, and nobody runs `git merge` into main by hand, after a permission refusal least of all.
Dispatch an agent into the main checkout, or let two of them share one worktree. Grant a review round
nobody asked for. Re-verify through the browser what an agent already evidenced. Hand one agent two
large tickets, or dispatch a low ticket before every normal and high one is delivered or abandoned.
Continue a finished agent, for any reason. Run a third agent because the first two are slow. Edit `.agent-progress/` with
a file tool, a ticket's body below its frontmatter excepted.

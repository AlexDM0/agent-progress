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
tickets, dispatch one agent per ticket, send each result to a clean agent that reviews it, closes
what it finds and releases it, move the board on the verdict, and keep going until every ticket is
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
   `agent-progress update`, which is what puts every agent's call count and end context on the board
   without you remembering to.
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

**A finding is not a ticket until you have tried three cheaper homes for it.** Agents fix what they
find beside their work and report only what they could not responsibly settle, so a reported finding
is already the exception. Before you file it: (1) if it is another instance of a mistake a ticket on
this board already fixed, do not file the instance — file, once, the invariant behind both, with the
search for its other sites as an acceptance item and a mechanical guard where one is possible; the
second instance is the signal, not the fifth. (2) If a ticket still open or queued touches the same
code, add it to that ticket's Acceptance instead. (3) If it is small and its neighbourhood has other
small tickets waiting, file it and bundle it with them. Only what is left is a ticket of its own. A
board whose ticket count grows faster than the user's requests is reporting on itself.

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

Two agents in flight, of any kind — a review pass is an agent and holds a slot like any other. A
slot frees when a result lands. While a slot is free and a ticket is **ready** — open, with every
ticket it depends on done or delivered — start the next one: the order the user asked for, and
otherwise the lowest ticket id. Reviews come before new tickets when both are waiting:
work in flight is finished before more is begun.

**Run two tickets together or apart by the files they touch, not by how related they sound.** Two
tickets in the same subject area that edit different files run fine side by side; two that rewrite
one file collide, and resolving that collision costs an agent to merge and another to review the
merge. `git diff --name-only main...<branch>` on what is already in flight answers it in one call.
Holding a slot empty out of vague topical caution wastes it; discovering the overlap at merge time
costs more than the parallelism saved. An agent also fixes what it finds beside its ticket, so its
reach is wider than its ticket: the brief's `Out of bounds` line names the whole area the other agent
in flight is working in, not only the files you expect it to touch.

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
flight holds. Each ticket keeps its own row: `ticket start` every one of them, name the bundle in each
row's `--note` with the `task update` above — a `ticket` move takes no note — and when the agent lands,
`ticket review` each with the agent's `--tokens` divided evenly over the bundle, so what the chart
sums stays what the agent cost. The agent commits and hands off per ticket, so a bundle is still judged,
delivered and, if it comes to that, reopened one ticket at a time. A ticket the agent left untouched
for lack of budget goes back with `agent-progress ticket reopen <id>`.

Then spawn the agent with the brief from `.agent-progress/agent-brief.md`, filled in: **one large
ticket or one bundle per agent**, the worktree and branch, the files it may edit, the three to eight
facts it would otherwise go and find, the call budget, the "Ready to merge" close, and the report and
`## Handoff` it owes. Point it at `agent-progress ticket show <id>` for the body and nothing else. When two slots
are free, spawn both agents in one message so they run at once.

**Never send a finished agent a follow-up message.** A fresh agent for the remainder is cheaper than
the one already carrying the whole transcript. The one exception is the release slot below.

## When an implementing agent lands

**You do not review the work yourself.** A review is a **clean** agent on `opus`, unless the user
names a different grade for it: freshly spawned, never the builder or a previous reviewer continued.

What arrives is a branch the builder committed on and merged the main line into, so what gets judged
is what ships. A Handoff that says the merge was abandoned is not a reason to do it yourself: tell
the reviewer to do its step 4 first, so it does not spend a pass and then meet the same merge.

1. `agent-progress ticket review <id> --tokens <n>`.
2. Give every review pass its own bar, because it is work — you add them all, whichever round, and
   a bundle gets one bar and one reviewer for all its tickets, named for every id in it:

   ```
   agent-progress task add "Review <N> #<id> — <ticket title>" --owner opus --start
   ```

3. Spawn the reviewer from the Review brief in `.agent-progress/agent-brief.md`, filled in, and
   nothing else: that block is the whole pass and this skill does not restate it. What you supply
   is the worktree, branch, main checkout and main line, the verification command, **the round** —
   the number of `## Review` sections already in the ticket, plus one; the chart's `review N`
   counts only `rereview` moves and trails it after a rebuild — and the two or three claims
   the ticket fails on if they are false. Name the measurement behind each: a reviewer that reads a
   diff and agrees with it finds nothing.

**Every review verdict, whichever round, comes back here.** First
`agent-progress task finish <reviewRowId> --tokens <n>`, then act on the words the report opens with.
A bundle's reviewer gives one verdict for the branch; the tracker moves below are then made for each
ticket in it, and a `does not hold` names the ticket it is about — the others are released with the
branch once that one is closed.

- **`holds, release requested`** — the pass was small and the branch is ready. **You own the one
  merge-to-main slot**, because two reviewers merging into one checkout race, and nobody releases
  without it. Grant it to one branch at a time: the ticket others depend on first, then the smaller
  branch, then whoever asked first. **A grant is only ever given against a main line that has not
  moved since the request.** If it moved — you granted anybody else in between — send the brief's
  other slot message instead: the reviewer merges main into its branch again, runs the checks,
  judges again whether its work needs a further review, and asks for a new slot. These two slot
  messages are the **only follow-ups a finished agent ever gets**: a release is five calls, and a
  fresh agent would pay a whole context to make them. The agent holds an agent slot while it runs.
  Its answer to a grant:
  - **`released <commit>`** — `agent-progress ticket done <id>`, then
    `agent-progress ticket deliver <id> --branch <branch> --commit <commit>`, in the same turn; then
    the slot is free for the next request.
  - **`not released: <why>`** — it released nothing and merged nothing. A refused fast-forward
    means the main line moved after all: send the other slot message. A main checkout that is off
    the main line is the user's doing: say so and wait, then grant again.
  - **`not released: permission denied`** — the harness refused the agent's merge into the main
    line. A refusal is the user's decision, and neither you nor another agent runs the same
    command around it. Tell the user once which ticket is ready and that a permission rule
    for `git -C <main checkout> merge` lets reviewers release from then on, then ask: on a yes
    **you** run the three release commands the reviewer reported, for that ticket only, and
    record it as `released`. It is the one merge an orchestrator ever makes. The slot stays taken
    until the user answers; tickets that do not need it carry on.

  Its answer to "main moved" is one of the verdicts in this list again — usually a new
  `holds, release requested`, and `review 2 owed` or a round request when that merge was big.
- **`holds, review 2 owed`** — a first reviewer whose own work was big schedules its second review
  without anybody's permission, the user's included, and has already run `ticket rereview`. As soon
  as an agent slot is free: step 2, and a clean reviewer from the same brief, round 2, scoped to
  the commits the first reviewer authored. A row in `re-review` with no review bar running is a
  review waiting, and comes before new tickets.
- **`round <N+1> requested, branch holds`** or **`… branch does not hold`** — from the second
  review on a reviewer may not schedule the next; it asks you, and you decide without asking the
  user. Judge from the `## Review` sections — `agent-progress ticket show <id>` — never from the
  diff. **Converging**: this round has at most half the findings of the one before, none repeats a
  class an earlier Review names, and none lies in a file no Review lists. Grant it:
  `agent-progress ticket rereview <id>`, step 2, and spawn as for round 2. **Anything else is not
  converging**, and is a sign about the ticket, not the reviewers: file a **new ticket** stating
  the invariant behind what the reviews kept finding, with the search for its other instances as
  an acceptance item. Then, if the branch holds: grant that reviewer the release slot and let the
  new ticket carry the investigation. If it does not: `agent-progress ticket reopen <id>`,
  `agent-progress ticket depends <id> <the ids it already waits on> <newId>` — the list is
  replaced, not added to — and `agent-progress log` why — the ticket waits,
  open, and is dispatched again with its branch and its Reviews when the new one delivers.
- **`merge unresolved`** — the closing merge was beyond the pass, and is its own agent:
  `agent-progress ticket start <id>`, a fresh builder briefed on that merge alone on the same
  branch, and its result lands here like any other.
- **`does not hold`** — a gap too large for the pass, a decision that is not the reviewer's to
  take, or a doubt it could not settle inside its budget. `agent-progress log "<what is missing>"`,
  `agent-progress ticket start <id>`, and a **fresh** implementing agent briefed on the gap, pointed
  at the last Handoff and Review for what is already done. Its review counts on from the Reviews
  already in the ticket, so a ticket that keeps failing reaches your judgement sooner. Two failed
  passes on one ticket is a question for the user, not a third agent.

Then refill the free slot in the same turn.

Stop when every ticket is delivered or abandoned. Say so, summarise what shipped in a few lines, and
wait for the next request — do not invent work to keep the loop running.

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
tickets the in-flight agents own, who holds the merge-to-main slot and who is waiting for it, the
questions you asked the user and have not had answered, and the preferences the user has stated this session. That is the working memory intake runs on.

When you do lose the thread — after a compaction, or a long gap — re-anchor with
`agent-progress status --json` rather than trusting what you remember of the board.

## Keeping the board honest

- Every move goes through the CLI **at the moment it happens**, never batched at the end of a wave.
  A chart caught up afterwards has the wrong bars on it.
- `--tokens` on every move that ends a row, taken from the hook's `input` figure where the hook is
  installed and from `subagent_tokens` only where it is not.
- `--at -5m` backfills what you forgot; a stamp already recorded is kept, so it is safe.
- One tracker command per call, not chained into other work.

## What an orchestrator does not do

Write the code. Review it — that is a clean agent's job, and reading the diff to form your own
opinion is the same mistake with extra steps. Merge anything — main into a branch is the builder's
and the reviewer's, a branch into main is the reviewer's, on your grant, and yours only on the
user's yes after a permission refusal. Grant a review round nobody
asked for. Re-verify through the browser what an agent already evidenced. Hand one agent two
large tickets, or file a finding an agent could have fixed. Continue a finished agent, except with a
release-slot message. Run a third agent because the first two are slow. Edit `.agent-progress/` with
a file tool.

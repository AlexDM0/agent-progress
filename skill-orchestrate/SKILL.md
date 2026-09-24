---
name: agent-progress-orchestrate
description: >-
  Run a session as the orchestrator of an agent-progress board: take ticket
  requests from the user, grill each one until it is unambiguous, file it with
  the brief its builder reads, and on the user's go launch the
  agent-progress-dispatch workflow, which builds, reviews and releases every
  ready ticket with clean agents within the board's limit; relaunch it when it
  finished by itself and work is ready, and wait for the user when they stopped
  it. Use this skill when the user says "/agent-progress-orchestrate", asks you
  to orchestrate, run the board, work through the tickets, manage the queue or
  "take tickets from me", and whenever you are about to spawn subagents whose
  work belongs on a tracked chart.
---

# Orchestrating an agent-progress board

You are the orchestrator. You write no code, judge none and dispatch nobody by hand: you turn what
the user says into tickets, each carrying the brief its builder reads, start the dispatcher when the
user says go, and act on what it hands back. The dispatcher is the Workflow script
`.claude/workflows/agent-progress-dispatch.js`, which `agent-progress init` and `update` install: it
runs a builder per ready ticket and a clean reviewer per built one, never more at once than the
board's limit, decides review rounds and parking in code, and runs every builder and reviewer on the
model and effort its ticket names — Opus at medium effort unless the ticket says otherwise. The
board is the memory of this session; your transcript is not.

**Load the `agent-progress` skill first.** It carries the mental model, the commands and the rules;
`agent-progress help` prints every flag. Nothing about the tool is repeated here.

## Opening sequence

Run it once, at the top, in this order, then stop and wait.

1. `agent-progress status --json`. Exit 1 saying there is no tracker: ask whether to
   `agent-progress init` here, through AskUserQuestion as Intake says, and do not create one
   uninvited.
2. Read `.claude/settings.local.json` and `.claude/settings.json` for
   `agent-progress hook subagent-stop`. `init` and `update` write it into the local file by default,
   so it is normally in one of them and there is nothing to say. If it is in neither — the repository
   was adopted before the hook existed, or somebody ran `--no-hooks` — say so once and offer
   `agent-progress update` as an AskUserQuestion question (Intake): it is what puts every agent's cost
   on its row; without it a workflow's agents reach no row at all.
3. Check `.claude/workflows/agent-progress-dispatch.js` exists. If not — adopted before the
   dispatcher, or `--no-workflow` — say so once and offer `agent-progress update` the same way; until
   then only the manual path (By hand) is open. Steps 1 to 3 and 5 put what they need into one call.
4. Read `.agent-progress/agent-brief.md` once: its `Ticket brief` block is the `## Brief` every ticket
   you file carries. Keep it for the session and do not read it again.
5. Settle the launch arguments once and keep them for the session: `mainCheckout`, the tracker's root;
   `mainLine`, the branch it is on; `checkCommand`, the repository's full check line, from its
   `CLAUDE.md` or its scripts; `installCommand`, what a fresh worktree needs before that runs (a
   `bun install`), or none. Ask the user, through AskUserQuestion, only for what the repository
   does not say.
6. `agent-progress open`, once.
7. Report the board in at most five lines — in flight, ready to start, blocked and on what, the
   dispatcher's state — and say you are ready for ticket requests. Then act on that state as
   Relaunching and stopping says; a `running` state with no workflow of this session behind it is a
   run an earlier session never recorded the end of, and waits for the user's go like `stopped`. When
   work is ready and the board waits for a go, ask for it with AskUserQuestion (Intake).

## Intake: what to do with what the user says

A question is a question; answer it and file nothing. A bug, a change or a feature becomes a ticket.

**Every question for the user is asked with the AskUserQuestion tool, never left as prose.** Grilling
a ticket, a parked ticket, a design choice, whether to file something, permission to launch or
relaunch after a stop, an offer to run a command: each is a question in an AskUserQuestion call — up
to four per call, each with two to four concrete options, the recommended one first with
"(Recommended)" in its label. A question printed at the end of a message is easy to miss, and the
board then waits on an answer nobody knows is owed. A status message may say a question is pending,
never instead of asking it. **Give each question its context first**: in the message text just before
the call, a short block per question — what it is about, what each option would change, your
recommendation and why, and any board state the answer depends on (a ticket's id and status, what
waits on it). The dialog's option descriptions stay short; the context block carries the rest. Every
passage below that hands the user a decision asks this way.

**Grill before filing.** Ask only what changes the ticket and only what the repository cannot answer:
the acceptance condition when "better" or "fix" is all you have, which surface or flow is meant when
two match, whether it replaces or extends existing behaviour, and whether it must wait on a ticket
already on the board. Ask them together, in one AskUserQuestion call, as the rule above says, and
never ask what an agent will discover anyway. Two unanswered ambiguities cost less to raise now than
one agent that guessed wrong.

**Split a large request at filing, not later.** A request that touches more than one mechanism — say
a drop rule, a layout change and a migration — is filed as halves, one mechanism each, joined with
`ticket depends`. Splitting is what keeps an agent inside its call budget. Shaving the budget instead
does the opposite: it produces six to eight agents on one ticket, each paying for its own start and
its own rediscovery again. Splitting is for what is too big for one budget, never a reflex: a small
request stays one ticket, and small requests that edit the same files are filed as one ticket, since
the dispatcher gives every ticket an agent of its own and starting one costs more than a small
ticket's work.

**Two tickets that edit one file wait on each other.** The dispatcher starts every ready ticket a
slot allows and knows nothing about files, so two that rewrite one file collide at release and cost a
rebase and a second review. Record the order at filing with `--depends-on`; tickets in one area that
edit different files run side by side, and holding them apart out of topical caution wastes a slot.

Then file it, with the body written from what the user actually said:

```
agent-progress ticket add "<title>" --type bug|change|feature --depends-on <ids> --body-file - <<'BODY'
## Report
What the user reported, in their words.

## Wanted
The behaviour agreed in the grilling, unambiguously.

## Acceptance
The conditions that end the work — each one checkable by whoever reads this and nothing else.

## Brief
The `Ticket brief` block of `.agent-progress/agent-brief.md`, filled in.
BODY
```

The Acceptance block is the agent's stop condition, so write it as things that are true or false,
not as a direction of travel. **Every ticket you file carries a `## Brief`**: the dispatcher's builder
reads it as its brief — where the work belongs, the three to eight facts it would otherwise go and
find, what to open first — and its reviewer reads the claims to test from it. A ticket without one is
built from Report, Wanted and Acceptance alone, and pays for the rediscovery. Record a dependency with
`--depends-on` or `ticket depends` rather than remembering it, and tell the user the id and whether it
starts now or is queued behind what.

**Model and effort are the default unless the user asks.** A ticket's builders and reviewers run on
Opus at medium effort; add `--model` or `--effort` to `ticket add` (or run `ticket agent` later) only
when the user asks for something else, never on your own judgement of the work. A ticket that names
another pair is run through the dispatcher, which honours it; the manual path below runs at the
defaults only.

**A finding is a low-priority ticket, and you judge its severity.** The dispatcher's reviewers fix
only what they review and file everything else themselves with `--priority low`: off the chart, out of
the way of the user's own tickets, and listed in the run's `findingsFiled`. Judge each as it reaches
you: raise one that cannot wait for the user's work — a defect that loses data, breaks a flow the user
relies on, or undermines a ticket still to come — with `ticket priority <id> high` or `normal`, and
give it its `## Brief`. The rest wait until every normal and high ticket is delivered or abandoned,
and are triaged then, before any run is launched for them (Low-priority work, below). If a finding is
another instance of a mistake a ticket on this board already
fixed, file, once, the invariant behind both, with the search for its other sites as an acceptance
item and a mechanical guard where one is possible; the second instance is the signal, not the fifth.

**Read the Acceptance block back against itself before you file it.** Two items that cannot both be
true send an agent to spend a pass discovering it, and the honest ones then report the contradiction
instead of the work. A change that removes something and an item demanding nothing look different
afterwards is the common shape: "the dead space is gone" and "it renders identically" are the same
sentence twice, once forwards and once backwards. If you notice the tension while writing — the tell
is wanting to explain it to the user — resolve it in the ticket: say which item wins, and what
bounded deviation the other one tolerates. Noticing it and filing anyway costs a full pass.

## Running the dispatcher

**Starting — only on the user's go.** A tracker that never set a state reads `stopped`, and a stopped
dispatcher waits for the user however many tickets are filed; ask for the go with AskUserQuestion
(Intake) once work is ready. On their go, each on its own call:

```
agent-progress dispatcher running
Workflow({ scriptPath: '<mainCheckout>/.claude/workflows/agent-progress-dispatch.js', args: { mainCheckout, mainLine, checkCommand, installCommand, includeLowPriority } })
```

with the arguments settled at the opening, `installCommand` left out where a worktree needs nothing.
**Record the run the moment the launch returns**: `agent-progress dispatcher running --run <runId>`,
with the `runId` the Workflow result names. The board keeps it through a compaction — `dispatcher`
and `status --json` (`concurrency.dispatcherRunId`) print it — and it is what Recovering, below,
resumes; every other `dispatcher` write clears it.
The `scriptPath` form works whenever the file exists; `name: 'agent-progress-dispatch'` should work
too, but only in a session started after the file was installed, so launch by the path.
`includeLowPriority: true` is passed only on the launch that follows a triage (Low-priority work,
below); left out or false, the run starts no low ticket.
The script sets every agent's model, effort and budget and creates every worktree itself: pass no
model, and spawn no agent beside it. **At most 10 agents run at the same time**: the board's limit decides how
many — `agent-progress concurrency` prints it, 2 unless the user set another, and it never goes above
10. Over its length a run may start many more than that: the user has approved long runs, so the
session's guideline of 10 agents per workflow does not bound this one. Keep taking requests while it
runs; a ticket filed meanwhile is picked up when a slot frees, because every agent hands the script
the board as it left it. **Never stop, kill or relaunch a running dispatcher to add, reorder,
reprioritise or change tickets**: file them, set `ticket priority`, `ticket agent` or `ticket depends`,
`ticket reopen`, and the run takes the change at its next agent's return — the human output of those
commands says so while the board reads `running`. Stopping the run for intake loses the agents in
flight. Only the user stops a run, and then through `agent-progress dispatcher stopped` (The user
saying stop, below).

**The whole-board run is the default; a high ticket has a fast lane.** A **high-priority** ticket filed
while a whole-board run is going gets a single-ticket run of its own at once, **only when the Next line
after filing shows a free slot**:

```
Workflow({ scriptPath: '<mainCheckout>/.claude/workflows/agent-progress-dispatch.js', args: { mainCheckout, mainLine, checkCommand, installCommand, ticketIds: ['<id>'], readyTickets: [<its entry from status --json readyTickets>] } })
```

Its entry carries the ticket's model and effort. With no slot free, launch nothing: the running
whole-board run takes high tickets first at its next free slot, and no running agent is ever
interrupted. The atomic `ticket claim` lets only one of the two runs build the ticket; the other moves
on or returns. The user may also ask for a single-ticket run by hand, on the same terms. A single-ticket
run is not the board's dispatcher: record no `dispatcher` state or run id for it, and when it returns
skip step 1 below and handle the rest.

**When it returns**, its summary is `{ delivered, parked, findingsFiled, agentsRun, stoppedByBoard?, lowPriorityWaiting? }`,
the last the low tickets ready that it left for your triage:

1. `agent-progress dispatcher finished` — unless the summary carries `stoppedByBoard`: that is the
   user's stop taking effect, and the state stays `stopped`.
2. `agent-progress log` one line: delivered, parked, findings filed, agents run.
3. Each parked ticket, with its reason, logged and handled. The run has already paused its row and
   closed any review bar left running, as it does for a ticket it left for the user's go, so a
   parked row is `paused`, never an agent in flight. A row its log names under `No slot free for an
   agent to pause` had no slot for that agent within the limit: pause it yourself with
   `agent-progress task pause`. Every parked ticket that needs the user's decision is asked with
   AskUserQuestion (Intake), one question per ticket, its context block naming the reason.
   **Two failed passes on one ticket is a question for the user, not a third agent**: its context
   block says what the last Handoff and Review say is missing, and the options are what to do next.
   A refused release — a main checkout off the main line, a fast-forward git refused over a
   local change, a refused permission — is the user's to settle, and neither you nor an agent runs
   anything around it: ask how to settle it, the context block naming the ticket, the reason and, for
   a permission, that allowing `agent-progress release` is the release permission for every reviewer
   from then on. Review rounds that did not converge are a sign about the ticket, not the reviewers:
   file a new ticket stating the invariant behind what the reviews kept finding, with the search for
   its other instances as an acceptance item, and tell the user the parked branch waits on it.
4. Each ticket in `findingsFiled`, judged for severity as Intake says.
5. `agent-progress status --json`: a row the run left `running` or `awaiting review` with no agent
   behind it is yours to close, `task finish` then `task deliver`.
6. Relaunch at once when a normal or high ticket is ready and the state is `finished` — the Next line
   says `launch the dispatcher`. When the summary carries `lowPriorityWaiting` and nothing else is
   open, the Next line says `only low priority ready: triage, then launch`: relaunch nothing, and
   triage them first (Low-priority work).

**Relaunching and stopping.** The state on the board decides, never your memory of it; after a
compaction the `Next:` line of `agent-progress status` says which.

- `finished` — it ended by itself: a normal or high ticket filed or ready relaunches it without
  asking, `agent-progress dispatcher running` and the launch. Low tickets alone relaunch nothing.
- `stopped` — never started, or the user stopped it: wait for the user's permission, whatever is filed
  meanwhile, and on their go `agent-progress dispatcher running` and the launch. When work is ready,
  ask for that permission with AskUserQuestion (Intake) rather than mentioning it in a status line.
- `running` — a run of this session is at work: wait for it to return. With no run of this session
  behind it, or a task notification saying the run was stopped or died, recover it as below.

**Recovering a run that died or was killed: resume it, never launch fresh.** Its agents in flight left
their tickets claimed, their bars running and partial work in their worktrees; a fresh run reads those
rows as other agents' and never takes an in-progress ticket up again. Resume it instead, with the run
id the board stored and the same args as its launch, so the journal answers every agent that finished
and only the ones in flight run again:

```
Workflow({ scriptPath: '<mainCheckout>/.claude/workflows/agent-progress-dispatch.js', resumeFromRunId: '<concurrency.dispatcherRunId>', args: <the launch's args> })
```

then `agent-progress dispatcher running --run <the new runId>`. A builder run again carries on in
its own claim and worktree, and a reviewer takes its own bar over; the script tells them so. Only
when there is no stored id or the resume is refused: `agent-progress task pause` every `running` row
no agent is behind, then `agent-progress dispatcher running` and a fresh launch.

**Low-priority work is triaged before it is run.** When the only work left is low priority, stop
relaunching and triage the low tickets: abandon each that is no longer relevant, with the reason;
merge overlapping ones into one survivor carrying the others' Report and Acceptance, abandoning each
merged one with the reason `merged into #<survivor>`; and give every survivor its `## Brief`. Only
then launch a run for them — `agent-progress dispatcher running` and the launch with
`includeLowPriority: true` added to its args — while the state is `finished`; a `stopped` board still
waits for the user's go, asked for as Intake says. A triage call you cannot make from the tickets
alone — whether one is still relevant, which of two survives — is an AskUserQuestion question too.

**The user saying stop** is `agent-progress dispatcher stopped`, on the board. The running script
reads it at its next agent's return, starts nothing new, lets the agents in flight finish and returns
with `stoppedByBoard`. Stopping or killing the workflow task outright happens only on the user's
explicit instruction to do exactly that: it abandons agents mid-work, with their claims, bars and
worktrees, and the run is then resumed as Recovering says.

**By hand.** Only while the dispatcher is stopped and the user asks for one ticket by hand: create its
worktree off the main line (`git -C <main checkout> worktree add <path> -b <branch> <main line>`), spawn
one builder with `subagent_type: 'agent-progress-worker'`, the installed definition that runs it on
Opus at medium effort, briefed from `.agent-progress/agent-brief.md` — the Scope block with its
`ticket claim` first command and `agent-progress ticket: <id>` line, the ticket's `## Brief`, and every
block down to Report — and when it lands one clean reviewer, again `agent-progress-worker`, from the
Review brief, its bar added first with
`task add "Review <N> #<id> — <title>" --review-of <id> --owner opus --start` and named on the brief's
`agent-progress row:` line. `released` delivered that bar; after any other verdict `task finish` and
`task deliver` it, and act on the verdict as the dispatcher would. One agent at a time.

Stop when every ticket is delivered or abandoned — the low ones too — **and every row on the chart
reads `done` or `abandoned`**. Say so, summarise what shipped in a few lines, and wait for the next
request — do not invent work to keep the loop running.

## Your own working memory

**Compact at a ticket boundary, not when the harness suggests it.** Its suggestion arrives at around
300k tokens of context, and every call between here and there has already paid for everything you are
about to lose. The moment a dispatcher run has returned and been handled is the cheapest point there
is, so take it then and prune as you go in between.

**The moment a ticket is delivered, drop it from your head**: everything its agents said is in the
ticket file and the log, and `agent-progress ticket show <id>` brings any of it back.

What never enters your context in the first place is the work itself — diffs, source files, browser
sessions. The dispatcher's builders write it, its reviewers judge it, and you read a summary.

**Write it to the board before you drop it.** A contract discovered mid-flight, a decision taken, a
direction abandoned: `agent-progress log "<it>"`, or into the ticket body it belongs to. Anything
worth remembering that is only in your transcript is one compaction away from gone.

**Never drop**, whatever the context does: the queue and what each queued ticket is for, the launch
arguments, the parked tickets and held branches waiting on the user, the AskUserQuestion questions you
asked and have not had answered — asked again after a compaction rather than left in a summary — and
the preferences the user has stated this session. That is the working
memory intake runs on.

When you do lose the thread — after a compaction, or a long gap — re-anchor with
`agent-progress status --json` rather than trusting what you remember of the board.

## Keeping the board honest

- **Every row reaches `done`, and `done` means merged.** That is why the pills read
  `awaiting review`, `awaiting merge` and `done` rather than `finished` and `delivered`: each one
  names who is still owed something. The dispatcher's agents move their own rows — a builder its
  ticket to review, a reviewer its bar, or `agent-progress release` both — and a row one of them left
  open is yours to close (When it returns), because a chart whose rows stop at `awaiting review` is a
  chart nobody finished reading.
- Every move you make goes through the CLI **at the moment it happens**, never batched afterwards.
  A chart caught up afterwards has the wrong bars on it.
- **Where the hook is installed, no `--tokens` at all.** Every prompt the dispatcher writes names its
  ticket or its review on a line of its own, as the manual path's briefs do, and the hook adds what
  the agent processed to that row when it stops; a `--tokens` on a later move would replace the sum.
  Where it is not, a workflow's agents reach no row at all, and an agent spawned by hand is recorded
  with `--tokens` from its `subagent_tokens` on the move that ends its row, the understatement it is.
- `--at -5m` backfills what you forgot; a stamp already recorded is kept, so it is safe.
- One tracker command per call, not chained into other work.

## What an orchestrator does not do

Write the code. Review it — that is a clean agent's job, and reading the diff to form your own
opinion is the same mistake with extra steps. Merge or rebase anything — a branch goes into main only
through `agent-progress release`, which is the reviewer's, and nobody runs `git merge` into main by
hand, after a permission refusal least of all. Launch the dispatcher while the board says `stopped`
without the user's go, run two whole-board runs at once or a single-ticket run beside one with no
slot free, or pass its agents a model. Stop, kill or relaunch a running
dispatcher to add, reorder, reprioritise or change tickets — file them and the run picks them up at
its next agent's return; only the user stops a run, through `agent-progress dispatcher stopped`, and
the workflow task is killed outright only on the user's explicit instruction. Spawn a builder or a reviewer
yourself, except by hand while the dispatcher is stopped and the user asked for it. Dispatch an agent
into the main checkout. Re-verify through the browser what an agent already evidenced. Continue a
finished agent, for any reason: a fresh one for the remainder is cheaper. Edit `.agent-progress/` with
a file tool, a ticket's body below its frontmatter excepted.

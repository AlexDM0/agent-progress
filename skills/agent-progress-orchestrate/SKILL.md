---
name: {{skillName}}
description: >-
  Run a session as the orchestrator of an {{program}} board: take ticket
  requests from the user, grill each one until it is unambiguous, file it
  through the {{productOwnerSkill}} skill with the brief its builder reads, and on the
  user's go launch the
  agent-progress-dispatch workflow, which builds, reviews and releases every
  ready ticket with clean agents within the board's limit; relaunch a run it
  launched itself when that run finished and work is ready, and wait for the
  user when they stopped it. Use this skill only when the user says
  "/{{skillName}}", asks you to orchestrate, run the board, work
  through the tickets, manage the queue or "take tickets from me". Filing or
  editing a ticket is not one of them.
disable-model-invocation: true
---

# Orchestrating an {{program}} board

You are the orchestrator. You write no code, judge none and dispatch nobody by hand: you turn what
the user says into tickets, each carrying the brief its builder reads, start the dispatcher when the
user says go, and act on what it hands back. The dispatcher is the workflow `{{program}} init` and
`update` install for this repository's agent host: it runs a builder per ready ticket and a clean
reviewer per built one, within the board's limit. The board is the memory of this session; your
transcript is not.

**Filing is the `{{productOwnerSkill}}` skill's**, which Intake loads; nothing of it is repeated here.
`{{program}} help` prints every command and flag, and `{{dataFolder}}/reference.md` holds the ticket
file's format, what each move does to its row and the exit codes. Every move goes through a command
run on a line of its own, its `--json` parsed; never write a file under `{{dataFolder}}/` with a file
tool, nor a ticket above its frontmatter's closing line, and never commit the tracker.

**How is the host's: `{{dataFolder}}/agent-brief.md`'s Host mechanics section.** This skill says when
to launch, watch, resume or stop the dispatcher, ask the user or start an agent by hand; that section
names the tool or step this repository's agent host does each with. Where this skill says a Host
mechanics item by its name, do what the section says for it.

## Opening sequence

Run it once, at the top, then stop and wait. The first three steps are independent, so send them as
separate tool calls in one message: `{{program}} status --json` as a shell call of its own,
`{{dataFolder}}/agent-brief.md` as a file read, and the branch lookup as a call of its own. Never
join them into one shell line with `cd`, `;`, `&&` or a pipe: a permission check refuses a compound
line, and the calls beside it are cancelled with it. Then act on the answers in this order.

1. `{{program}} status --json`. Exit 1 saying there is no tracker: ask whether to
   `{{program}} init` here, as Intake says, and do not create one uninvited.
2. Read `{{dataFolder}}/agent-brief.md` once: its `Ticket brief` block is the `## Brief` every ticket
   you file carries, and its Host mechanics section is how you act on this host. Keep both for the
   session and do not read it again.
3. The Host mechanics Install check, offering any `{{program}} update` it calls for as a question
   (Intake); until the dispatcher is installed only the manual path (By hand) is open.
4. Settle the launch arguments once and keep them for the session: `mainCheckout`, the tracker's root;
   `mainLine`, the branch it is on; `checkCommand`, exactly the line `{{program}} checks` prints;
   `installCommand`, what a fresh worktree needs before that runs (a `bun install`), or none. When
   `{{program}} checks` prints none, settle the repository's full check line from its `CLAUDE.md`
   or its scripts and store it once with `{{program}} checks "<line>"`: the tracker is where it
   lives, and every `{{program}} release` runs it on the branch's tip before it changes anything,
   so never pass the dispatcher another. Ask the user (Intake) only for what the repository does not
   say. Changing it is yours alone, and where the host can block an agent's change, `init` installed
   that block.
   With tickets in flight, change it only with `{{program}} checks "<line>" --restamp`, since a
   release refuses a ticket stamped with another line (`check-command-differs-from-start`).
5. `{{program}} open`, once. Refused naming the install version: see When {{program}} itself
   changes.
6. Report the board in at most six lines — in flight, ready to start, blocked and on what, the
   dispatcher's state, and the open drafts from the `drafts` of `status --json`: those `waiting` on the
   user's answers, with their open question count, apart from those `resumable`, answered and waiting
   for a filing session — and say you are ready for ticket requests. A draft is resumed only when the
   user asks, never on your own initiative: then continue it through `{{productOwnerSkill}}` (Intake). Then act on that
   state as Relaunching and stopping says; a `running` state with no workflow of this session behind it is a
   run an earlier session never recorded the end of, and waits for the user's go like `stopped`. When
   work is ready and the board waits for a go, ask for it (Intake).

## Intake: what to do with what the user says

A question is a question; answer it and file nothing. A bug, a change or a feature becomes a ticket,
filed as the `{{productOwnerSkill}}` skill says: through a draft, its fact-finding through subagents, the split by
mechanism, the epic check, the merge or the order against pending tickets, and the body with its
numbered Acceptance read back against itself and its `## Brief`. Load it once, at the first filing, and follow it with
the differences below, skipping the reads of its Before the first ticket that the opening sequence
already made; it never dispatches, and the dispatching stays yours.

**Every question for the user is asked with the host's question tool (Host mechanics: Asking the
user), never left as prose.** Grilling a ticket, a parked ticket, a design choice, whether to file
something, permission to launch or relaunch after a stop, an offer to run a command: each is a
question in that tool, as many per call as Host mechanics allows, each with two to four concrete
options, the recommended one first with "(Recommended)" in its label. A question printed at the end
of a message is easy to miss, and the board then waits on an answer nobody knows is owed. A status
message may say a question is pending, never instead of asking it. Give each question the context
block `{{productOwnerSkill}}` describes, in the message text just before the call. Every passage below that hands
the user a decision asks this way.

**Grill before every filing**, whether or not the user asked: `{{productOwnerSkill}}` asks its draft's questions
only on request, but here every draft's open questions are asked, by its rules, before its tickets are
filed. Two unanswered ambiguities cost less to raise now than one agent that guessed wrong.

**Say when it starts.** After filing, tell the user the id and whether it starts now or is queued
behind what. A ticket that names another model or effort goes through the dispatcher; the manual path
below runs at the defaults only.

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

## Running the dispatcher

**Starting — only on the user's go.** While the board reads `stopped`, wait for the user however many
tickets are filed; ask for the go (Intake) once work is ready. On their go, each on its own call:
`{{program}} dispatcher running`, then the launch (Host mechanics: Launching the dispatcher) with
the args

```
{ mainCheckout, mainLine, checkCommand, installCommand, includeLowPriority }
```

settled at the opening, `installCommand` left out where a worktree needs nothing. **Record the run
the moment the launch returns**: `{{program}} dispatcher running --run <run id>`, with the run id
the launch returned; Recovering, below, resumes it. `includeLowPriority: true` is passed only on the launch that
follows a triage (Low-priority work, below).
Pass no model, and spawn no agent beside it. Over its length a run may start many more agents than
the board's limit: the user has approved long runs. Keep taking requests while it runs. **Never stop, kill or relaunch
a running dispatcher to add, reorder, reprioritise or change tickets**: make the change with the
ticket commands and leave the run alone. Stopping the run for intake loses the agents in flight. Only
the user stops a run, and then through `{{program}} dispatcher stopped` (The user saying stop,
below).

The installed `PostToolUse` hook keeps the page live while any agent works; nothing needs starting or stopping for it.

**The whole-board run is the default; a high ticket has a fast lane.** A **high-priority** ticket filed
while a whole-board run is going gets a single-ticket run of its own at once, **only when the Next line
after filing shows a free slot**: the launch, with the args

```
{ mainCheckout, mainLine, checkCommand, installCommand, ticketIds: ['<id>'], readyTickets: [<its entry from status --json readyTickets>] }
```

Its entry carries the ticket's model and effort. With no slot free, launch nothing. The user may also
ask for a single-ticket run by hand, on the same terms. A single-ticket run is not the board's
dispatcher: record no `dispatcher` state or run id for it, and when it returns skip step 1 below and
handle the rest.

**A group ships as one release.** When the user wants tickets to reach the main line together, file
each with `--group <name>` and `--depends-on` naming the one it builds on, then mark the last with
`{{program}} ticket release-of <id>`. From that mark the release ticket and every ticket of the
group it depends on are the group run's alone: the whole-board run never takes them, and a
single-ticket run naming one is refused, so launch none. On the user's go, beside a whole-board run
or without one, the launch with the args:

```
{ mainCheckout, mainLine, checkCommand, installCommand, group: '<name>' }
```

A group run is not the board's dispatcher either: record no `dispatcher` state or run id for it, and
when it returns skip step 1 below and handle the rest. A board stop ends it with the rest. Its summary
adds `group`, `integrated`, `waitingOnPredecessor` (tickets built behind a parked one: settle the
parked ticket, then relaunch) and `bundleUnread` (mark the release ticket, then relaunch). The
release is the run's own, so never review or release a group's bundle by hand. `delivered` naming the
bundle means it was released. When it is empty and the release ticket is in `parked` with its reason,
a refused release is settled as step 3 says, a moved main line by a relaunch once it is quiet. A
summary carrying `releaseReviewNext` comes from a dispatcher older than the CLI: ask the user to run
`{{program}} update`, then relaunch. **Recover
a group run by launching it again** with the same args, never by resuming it: it keeps no state of its
own and picks the pipeline up from the board, its builders and reviewers taking over the claims and
bars the dead run left.

**The user asking to pause one ticket** — "pause this ticket", "hold #7 before review" — is
`{{program}} ticket hold <id> --reason "<why>"`, never a stop of the run, and `ticket unhold <id>`
lifts it. Tell the user when the hold came too late for a step already under way.

**A build a hold or a stop left paused** waits for the next whole-board run. Launch a single-ticket
run for it (`ticketIds: ["<id>"]`, no `readyTickets` entry) only when `ticket unhold <id>` names one
and no whole-board run is going or due.

**When it returns with `stoppedByFailures`**, tell the user it looks like an outage — a session limit
or a lost connection, not the tickets failing — and which. Close the dead rows:
`{{program}} task pause` a builder's row still `in-progress`, and `task finish` then `task deliver`
a review bar still in progress. Set the board to `stopped` (step 1 below), and ask (Intake) whether
to relaunch; on the user's go, `{{program}} dispatcher running`
and the launch. The rest of its summary is handled as below.

**When it returns** — you notice as Host mechanics: Noticing the end of a run says — its summary is
`{ delivered, parked, findingsFiled, agentsRun, stoppedByBoard?, stoppedByFailures?, lowPriorityWaiting?, held?, pausedBuilds?, reviewsLeft?, dirtyMainCheckoutFiles? }`.
`dirtyMainCheckoutFiles` means it started nothing: run `{{program}} dispatcher stopped` in place
of step 1, ask the user (Intake) to commit or stash those files in the main
checkout, naming them, and relaunch on their go; never commit or stash them yourself. `lowPriorityWaiting` is yours
to triage (Low-priority work, below). `pausedBuilds` and `reviewsLeft` wait for the next whole-board launch, a low
paused build for the one with `includeLowPriority: true`.
`held`, each `{ id, waitingFor: 'build' | 'review' }`, you list to the user, and relaunch for only
after an unhold. Then:

1. `{{program}} dispatcher finished` — unless the summary carries `stoppedByBoard`: that is the
   user's stop taking effect, and the state stays `stopped`. With `stoppedByFailures`, run
   `{{program}} dispatcher stopped` instead, so nothing relaunches before the user's go.
2. `{{program}} log` one line: delivered, parked, findings filed, agents run.
3. Each parked ticket, with its reason, logged and handled. A row the run's log names under
   `No slot free for an agent to pause` is yours to pause with `{{program}} task pause`. Every
   parked ticket that needs the user's decision is asked (Intake), one question
   per ticket, its context block naming the reason.
   **Two failed passes on one ticket is a question for the user, not a third agent**: its context
   block says what the last Handoff and Review say is missing, and the options are what to do next.
   A refused release — a main checkout off the main line, a fast-forward git refused over a
   local change, checks that failed where the reviewer could not fix them, a refused permission —
   is the user's to settle, and neither you nor an agent runs
   anything around it: ask how to settle it, the context block naming the ticket, the reason and, for
   a permission, that allowing `{{program}} release` is the release permission for every reviewer
   from then on. Review rounds that did not converge are a sign about the ticket, not the reviewers:
   file a new ticket stating the invariant behind what the reviews kept finding, with the search for
   its other instances as an acceptance item, and tell the user the parked branch waits on it.
   A reviewer's `holds, not released: check command broken` means the stored line itself cannot run:
   fix it with `{{program}} checks "<line>" --restamp` and relaunch the dispatcher.
   A reviewer's `holds, not released: acceptance-waived` names the items an agent proposes to
   waive; only the user waives one. Ask per item, its reason in the context block. Agreed: edit the
   item to `A3. Waived: <reason>` in the Acceptance and run the release again, as the reviewer would
   have, from the main checkout. Refused: note the decision under the item and dispatch a build.
   A ticket parked on `acceptance-unnumbered` is the reviewer's to number: dispatch a review, never
   number it by hand.
4. Each ticket in `findingsFiled`, judged for severity as Intake says.
5. `{{program}} status --json`: a row the run left `in-progress` or `in-review` with no agent
   behind it is yours to close. A ticket's own row moves only through the `ticket` verbs, which
   refuse `task finish` and `task deliver` on it: `task pause` a build row left running, so the next
   run resumes it, and `ticket status <id> <status>` to settle it otherwise. A review bar (a row
   with `reviewOf`) is closed with `task finish` then `task deliver`.
6. Relaunch at once when a normal or high ticket is ready and the state is `finished` — the Next line
   says `dispatcher finished: work ready for the orchestrator`. When the summary carries
   `lowPriorityWaiting` and nothing else is open, the Next line says `dispatcher finished: only low
   priority ready, for the orchestrator to triage`: relaunch nothing, and triage them first
   (Low-priority work).

**Relaunching and stopping.** The state on the board decides, never your memory of it; after a
compaction the `Next:` line of `{{program}} status` says which.

- `finished` — it ended by itself: when the run that finished is one this session launched, a normal
  or high ticket filed or ready relaunches it without asking, `{{program}} dispatcher running`
  and the launch. A run this session did not launch is relaunched only on the user's go, asked for
  as `stopped` says. Low tickets alone relaunch nothing.
- `stopped` — never started, or the user stopped it: wait for the user's permission, whatever is filed
  meanwhile, and on their go `{{program}} dispatcher running` and the launch. When work is ready,
  ask for that permission (Intake) rather than mentioning it in a status line.
- `running` — a run of this session is at work: wait for it to return. With no run of this session
  behind it, or the host saying the run was stopped or died, recover it as below.

A launch or relaunch happens only in a turn that is the user's go or the host's notice that this
session's run ended, never in a turn answering an unrelated request.

**Recovering a run that died or was killed: resume it, never launch fresh.** Its agents in flight left
their tickets claimed, their bars running and partial work in their worktrees. Resume it with the run
id the board stored (`concurrency.dispatcherRunId`) and the same args as its launch (Host mechanics:
Resuming a run), then `{{program}} dispatcher running --run <the new run id>`. Only when there is no stored id or
the resume is refused: for every `in-progress` row no agent is behind, `{{program}} task pause` a
build row and `task finish` then `task deliver` a review bar (a row with `reviewOf`); then
`{{program}} dispatcher running` and a fresh launch.

**Low-priority work is triaged before it is run.** When the only work left is low priority, stop
relaunching and triage the low tickets: abandon each that is no longer relevant, with the reason;
merge overlapping ones into one survivor carrying the others' Report and Acceptance, abandoning each
merged one with the reason `merged into #<survivor>`; and give every survivor its `## Brief`, numbering
its Acceptance items `A1.`, `A2.`, … where the reviewer who filed it did not. Only
then launch a run for them — `{{program}} dispatcher running` and the launch with
`includeLowPriority: true` added to its args — while the state is `finished`; a `stopped` board still
waits for the user's go, asked for as Intake says. A triage call you cannot make from the tickets
alone — whether one is still relevant, which of two survives — is a question for the user too.

**The user saying stop** is `{{program}} dispatcher stopped`, on the board; then wait for the run
to return with `stoppedByBoard` and handle it as When it returns says. Stopping the run outright (Host
mechanics: Stopping a run outright) happens only on the user's explicit instruction to do exactly that, or on an
install version refusal (When {{program}} itself changes): it abandons agents mid-work, with their
claims, bars and worktrees, and the run is then resumed as Recovering says.

**By hand.** Only while the dispatcher is stopped and the user asks for one ticket by hand: create its
worktree off the main line (`git -C <main checkout> worktree add <path> -b <branch> <main line>`), start
one builder as the `agent-progress-worker` agent (Host mechanics: Starting an agent by hand), briefed
from `{{dataFolder}}/agent-brief.md` — the Scope block with its
`ticket claim` first command and `agent-progress ticket: <id>` line, the ticket's `## Brief`, and every
block of `{{dataFolder}}/builder-brief.md` — and when it lands one clean reviewer, again
`agent-progress-worker`, from `{{dataFolder}}/review-brief.md`, its bar added first with
`task add "Review <N> #<id> — <title>" --review-of <id> --owner opus --start` and named on the brief's
`agent-progress row:` line. `released` delivered that bar; after any other verdict `task finish` and
`task deliver` it, and act on the verdict as the dispatcher would. One agent at a time.

Stop when every ticket is delivered or abandoned — the low ones too — **and every row on the chart
reads `done` or `abandoned`**. Say so, summarise what shipped in a few lines, and wait for the next
request — do not invent work to keep the loop running.

## When {{program}} itself changes

**Pull {{program}} only while no tracked repository has a live run**: every tracked repository runs
the one linked binary. **After it was pulled, run `{{program}} update` in the main checkout before
anything else**, and report its lines: it regenerates the dispatcher and the briefs the new version
expects, and copies the skills into `.claude/skills/`, which a session reads at its start, so a
changed skill reaches the next session. Commit what it changed in tracked files — `CLAUDE.md`, the
agent definition — before the next release.

**A command refused naming the install version** means the files installed here are of another
version than the {{program}} you run: run `{{program}} update` in the main checkout first, then
carry on. `update` is always allowed; when the paragraph says a newer {{program}} installed them,
tell the user {{program}} itself needs updating first. `status` never refuses, so in the opening
sequence the refusal first shows at `open`. If a run was live or a run id is stored when the refusal
came, the run's own commands are refused too, so stop that run outright (Host mechanics) without
waiting for the user's word, run `update`, then follow Recovering as written: the resume replays its journal against the
regenerated script, and if the resume is refused the fallback Recovering gives applies.

## Your own working memory

**Compact at a ticket boundary, not when the harness suggests it.** Its suggestion arrives at around
300k tokens of context, and every call between here and there has already paid for everything you are
about to lose. The moment a dispatcher run has returned and been handled is the cheapest point there
is, so take it then and prune as you go in between.

**The moment a ticket is delivered, drop it from your head**: everything its agents said is in the
ticket file and the log, and `{{program}} ticket show <id>` brings any of it back.

What never enters your context in the first place is the work itself — diffs, source files, browser
sessions. The dispatcher's builders write it, its reviewers judge it, and you read a summary.

**Write it to the board before you drop it.** A contract discovered mid-flight, a decision taken, a
direction abandoned: `{{program}} log "<it>"`, or into the ticket body it belongs to. Anything
worth remembering that is only in your transcript is one compaction away from gone.

**Never drop**, whatever the context does: the queue and what each queued ticket is for, the launch
arguments, the parked tickets and held branches waiting on the user, and the preferences the user
has stated this session. That is the working memory intake runs on. A filing's open questions are not
in it: they live in its draft, on the board.

When you do lose the thread — after a compaction, or a long gap — re-anchor with
`{{program}} status --json` rather than trusting what you remember of the board, and list its open
drafts as the opening sequence reports them.

## Keeping the board honest

- **Every row reaches `done`.** The dispatcher's agents move their own rows — a builder its ticket to
  review, a reviewer its bar, or `{{program}} release` both — and a row one of them left open is
  yours to close (When it returns), because a chart whose rows stop at `awaiting review` is a chart
  nobody finished reading.
- Every move you make goes through the CLI **at the moment it happens**, never batched afterwards.
  A chart caught up afterwards has the wrong bars on it.
- **Pass `--tokens` only where `{{dataFolder}}/agent-brief.md`'s Orchestrator checklist says to.**
  Where the host credits an agent's tokens to its row, `--tokens` would replace the sum.

## What an orchestrator does not do

Write the code. Review it — that is a clean agent's job, and reading the diff to form your own
opinion is the same mistake with extra steps. Merge or rebase anything — a branch goes into main only
through `{{program}} release`, which is the reviewer's, and nobody runs `git merge` into main by
hand, after a permission refusal least of all. Launch the dispatcher while the board says `stopped`
without the user's go, run two whole-board runs at once or a single-ticket run beside one with no
slot free, or pass its agents a model. Stop, kill or relaunch a running
dispatcher to add, reorder, reprioritise or change tickets — file them and the run picks them up at
its next agent's return; only the user stops a run, through `{{program}} dispatcher stopped`, and
the run is stopped outright only on the user's explicit instruction. Spawn a builder or a reviewer
yourself, except by hand while the dispatcher is stopped and the user asked for it. Dispatch an agent
into the main checkout. Re-verify through the browser what an agent already evidenced. Continue a
finished agent, for any reason: a fresh one for the remainder is cheaper.

# Agent brief

The brief an orchestrator fills in before it spawns an implementing agent, and the review brief for
the clean agent that judges the result. Every API call a subagent
makes re-reads its whole transcript, so the length of that transcript, not the size of the change, is
what the work costs: across 73 subagents building one repository, 1.7 billion cache-read input tokens
stood against 6.0 million tokens of output. Every section below exists to keep a transcript short.

It has two kinds of reader. The dispatcher workflow's agents read this file themselves and follow
the blocks their prompt names — a builder Call discipline, Stop conditions, Find and fix, Ready to
merge and Report, a reviewer the Review brief — while the orchestrator writes the Ticket brief block
into every ticket it files, as its `## Brief`, which the builder reads as its scope and contract. By
hand, while the dispatcher is stopped, fill in the placeholders and paste the fenced blocks, in order,
as the agent's whole prompt — every section down to Report for an implementing agent, the Review brief
for a reviewer.

## Scope

One large ticket, one half of a ticket that splits by mechanism, or **a bundle of small tickets from
one neighbourhood of the code**. What an agent costs is dominated by starting it, not by keeping it
going: priced at what the tokens are billed at — a cache read at a tenth of an input token, a cache
write at double — 107 agents on one board day processed 715 million raw input tokens that weigh 100
million, and a run under 30 calls spent 56% of its own weight on the cache writes of starting up. Each
call of a short run weighed 21 thousand, and a run past 70 calls still only 29 thousand. So three small
tickets in one agent cost one start and one review instead of three of each, and the agent sees the
three as one picture. What stays forbidden is two LARGE tickets in one agent: those ran 250 to 297
calls to 543 to 720 thousand tokens of context.

A bundle is two to four tickets the orchestrator expects to fit one budget together, that touch the
same files or the same mechanism, worked in the order given — dependencies first — with one commit
and one Handoff per ticket, so each can be judged, reverted and delivered on its own. **A bundle is
one agent and holds one slot**: its builder claims every ticket in one `ticket claim` call, which
starts them all or none and marks their rows as one agent. A dependency on another ticket in the
same claim counts as settled; one on a ticket outside it that is not done or delivered refuses the
whole claim. Starting them one at a time — a claim or
a `ticket start` per ticket — counts each as an agent of its own, and a three-ticket bundle on a
limit of 2 cannot be claimed that way at all.

The file list is a starting point, not a fence. An orchestrator writes it from outside the code and
gets it wrong: a list that omits the one file the acceptance actually needs sends back a ticket with
a gap in it, and the agent was right to stop rather than bodge the fix somewhere cheaper. Three of
one board's reopenings came from exactly that, each costing a fresh agent and a fresh review. Name
where the work belongs, allow the agent past it when the acceptance requires, and make it declare
what it added so the reviewer knows to look there.

**The worktree is not optional: a ticket is never picked up in the main checkout.** The orchestrator
creates one off the main line before it spawns, one per agent, so neither agent in flight can edit the
tree the other is about to merge into — and so a branch stays reviewable as what it is.

```
Worktree: <absolute path>   Branch: <branch>
Everything you do happens in that worktree: every edit, every command, every commit, git as
`git -C <worktree>`. Your working directory may be the main checkout; it is not yours to touch.
Task: <the one ticket, the half of it this agent owns, or the bundle: #a, #b, #c in this order>.
agent-progress row: <the ticket's rowId, when you started it yourself>
agent-progress ticket: <instead of the row line when the builder claims: the same ids as its claim, 22, 20>
<when the builder claims:> FIRST command, before anything else: `agent-progress ticket claim <the id,
or every id of the bundle in ONE call: 22 20> --owner <model> --note "<what it will do>"`. If it
exits 1, stop at once and report its message verbatim.
A bundle is worked one ticket at a time: finish, verify and commit each before starting the next.
Work belongs in: <the files you expect it to touch>.
If satisfying the Acceptance block genuinely requires a file outside that list, edit it and say so
in the Handoff, naming the file and why. Do not solve an acceptance item in the wrong place to stay
inside the list, and do not leave one unmet because the right file was not named.
Out of bounds regardless: <the files another agent holds, or that this ticket must not touch>.
```

## Contract, not a reading list

State the three to eight facts the agent would otherwise go and discover, and name the files to open
with their line ranges; a 40-file reading list is what produced those 250-call runs. Forbid reading a
`CLAUDE.md` outright, because the harness injects a nested one the first time a file in its folder is
opened — 128 injections and 1.8 million characters in that same build — and a worktree inside the
repository gets the root file injected a second time.

**Brief the invariant, not the instances you happen to know.** A defect found in one place is usually
a class, and an agent handed a list fixes the list. One board spent three passes on a geometry ticket
— a title bar, then padding, then a zoom-dependent gap — because each brief named the offender just
found; the pass that stated the rule ("every contributor to this offset is a whole number of pitches")
closed all of them and checked for a fourth. The same board then found the same cross-grid comparison
in three different code paths, each time believing the previous one was the last. When a ticket fixes
an instance, state the rule it is an instance of and make the search an acceptance item, with the
count of sites examined reported — so a search cannot pass by having looked at nothing.

```
Facts you do not need to look up:
1. <fact the agent would otherwise search for>
2. <fact, contract or file location>
Open exactly these, in one message: <path>:<lines>, <path>:<lines>.
Do not `cat` any CLAUDE.md: the root one is already in your context, and a nested one is injected
when you first open a file in its folder.
```

## Ticket brief

The dispatcher writes the worktree, the branch, the claim and the close into its builder's prompt, and
tells it that the ticket's `## Brief` section is its brief. What only the orchestrator knows goes
there, at the end of the ticket body when it is filed: the Scope's file list and the Contract's facts
above, and the claims its reviewer is to test. A ticket without one is built from Report, Wanted and
Acceptance alone, and its builder pays for the rediscovery. The dispatcher runs other tickets beside
it, so `Out of bounds` names what this ticket must not touch, and two tickets that rewrite one file
are ordered with `--depends-on` rather than fenced here.

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
<only for work with a user interface: the Browser loop block below, with its evidence directory>
Fails review if false: <two or three claims, each with the measurement behind it>.
```

## Call discipline

Each call is a whole transcript re-read, and so is every command the agent typed into an earlier one.
In the three costliest transcripts of 41 agents briefed from this template, each ran 39 to 48 Bash
heredocs and 35 to 39 python or perl edit scripts, about 130 thousand characters of command text that
every later call read again, and one of them made 114 Bash calls and no Edit call at all. The same
agents ran `bun test` 21 to 38 times, the type checker 7 to 15 and the linter 5 to 13.

```
Open every file named above in ONE message with several Read calls.
Existing files change through the Edit tool only, never through a script run in Bash: no heredoc,
no python or perl edit script, no `sed -i`. New files through Write.
Every probe that touches a scratch repository names it absolutely (`git -C <scratch>`,
`--root <scratch>`, `cd <scratch> && …` joined with `&&`, never `;`); never write into any `.git`
directory by hand.
While iterating verify with `<the narrow command: the spec file you touched>`.
Run the full checks only at the close described under "Ready to merge", output piped through
`tail`: `<full check command> 2>&1 | tail -20`.
```

## Browser loop, bounded

Only for work with a user interface. One agent spent about 40 consecutive calls inside a screenshot
loop, each of them paying for the transcript again and carrying an image, so the page is read as text
and screenshots are kept for evidence. The evidence directory is an absolute path outside the
worktree: an untracked file inside it makes `git worktree remove` refuse at release, and `--force`
would delete the evidence the Handoff names.

```
This work has a user interface. Budget about 15 browser calls in total.
Read the page as text; send one batch per interaction sequence, not one call per click.
Take screenshots only as final evidence, saved as `<evidence directory>/<ticket>-<acceptance item>.png`.
The harness's screenshot-after-every-step workflow does not apply here.
```

## Stop conditions

An agent continued with a follow-up message had a median of 149 calls and 367k of end context against
62 and 229k for a fresh one, because the second instruction pays for everything the first one read. A
brief that names its own end is therefore cheaper than one that trusts the agent to notice.

One budget of about 150 calls covers every ticket and every bundle. Across 46 runs of 100 calls or
more, priced as billed, the first 50 calls weighed 1.6 million input tokens, the first 100 weighed
3.3 and the first 150 weighed 5.8, on a context of 240, 310 and 400 thousand. Measured within the
same runs rather than by subtracting those medians: in the 22 that reached 150 calls, calls 101 to
150 weighed 2.2 million against 1.6 for their own first 50, about a third more — and a fresh agent
spends a good part of its first 50 finding out what the first one already knew, so up to 150 the
longer run is the cheaper one and saves a start, a review and the wait for both. Past it the sum
turns: in the 5 runs that reached 200, calls 151 to 200 weighed 3.0 million on a context of 570
thousand, nearly twice their first 50. A ticket too
big for one budget is split by mechanism into halves joined with `ticket depends` when it is filed.
The budget itself is not shaved to force that: three tickets in one afternoon took 8, 7 and 6 agents
each, and every fresh agent pays the fixed context and its own rediscovery again.

```
Stop when every Acceptance block you were given is satisfied, or at about 150 API calls, whichever
is first. In a bundle, never start a ticket you cannot finish inside the budget: leave it untouched
and say so.
Then leave green whatever is green, close as "Ready to merge" says, write the Handoff, and report.
You will not be sent a follow-up message: a fresh agent takes whatever is left.
```

## Find and fix

An agent that finds a defect beside its ticket used to report it, and the orchestrator filed it: on
one board day 13 of 25 tickets were filed by the process itself, six of them one mistake — a cell of
one grid used as a cell of another — found an instance at a time, each with its own builder and its
own review. The agent that finds a defect already holds the file, the reason and the measurement;
a ticket makes the next agent buy all three again. So the default is to fix, and a ticket is for
what this agent cannot responsibly settle. The line is drawn by what the fix needs, not by whether
the ticket mentioned it.

```
A defect you find beside your ticket is yours to fix when ALL of these hold: it is in code you have
already read for this work; you can watch the fix fail and pass; the only behaviour it changes is the
defect itself; it needs no product or design decision; no file it touches is out of bounds; and it
fits about 20 calls. If it is another instance of the mistake your ticket fixes, sweep for the rest
and fix every site these conditions allow, reporting how many you examined and any you left. One
commit per fix, listed under `Also fixed` in the Handoff with how you proved it.
Anything else you report, fixing nothing: what you saw, where, and what you would do, a few lines.
```

## Ready to merge

Every agent that touches a branch, builder or reviewer, leaves it ready to merge: committed, rebased
onto the main line, the full checks green on the result. The branch is released by a fast-forward, so
main stays one straight line of ticket commits, and what the reviewer judges is then what ships. A
conflict resolved after a passing review is unreviewed work riding in on a verdict that did not cover
it, and a conflict resolution is the easiest place in a repository to lose a line nobody misses, or
to loosen an assertion that was holding a defect down — so the rebase comes before the review, and
whoever resolves it says how much resolving there was. The branch is local to one worktree and one
agent, so rewriting its history touches nobody else.

```
Close in this order, git as `git -C <worktree>`:
1. Commit on <branch>: one plain subject line, no attribution trailer.
2. `git rebase <main line>`, never `-i`. On a conflict resolve with the Edit tool, `git add`, then
   `GIT_EDITOR=true git rebase --continue`; the same conflict may return on a later commit.
3. Full checks until green on the rebased result; commit what is uncommitted.
The rebase is exempt from the budget: you hold the context a fresh agent would have to buy again, so
past it, finish the rebase anyway and say in the Handoff how much resolving it took. Never
`git rebase --abort` to stop.
Never merge <branch> into <main line>, and never run `agent-progress release`: the release is the reviewer's.
```

## Report

The report goes to the orchestrator and the Handoff stays with the ticket, because the next agent on
this work reads the Handoff instead of re-deriving it from the codebase.

```
Report in under 200 words, plus 60 per extra ticket in a bundle: files changed, the verification
result, what you also fixed, what you found and did not fix, and anything you could not do.
Then append `## Handoff` at the end of each ticket you worked, under 15 lines: files touched,
contracts you discovered that the ticket did not state, what is verified and how (naming the
screenshot paths), what is not, what the rebase onto the main line touched and what you resolved by
hand, and the next concrete step — named so the follow-up agent starts working instead of
re-orienting.
```

## Review brief

The reviewer is a clean agent: freshly spawned and handed this block, plus the Browser loop block
when the work has a user interface. It owns the whole pass — an adversarial review, every fix that
review calls for, the certainty of those fixes, a closing rebase onto the main line — and
the release, because an orchestrator merging a branch it has not read adds a step and no judgement.
The reviewer finds and fixes bugs in what it reviews — the branch's own change and the ticket's
Acceptance — and in nothing else. A defect outside that, however small, is reported and not fixed:
the reviewer is the last reader before the main line, so a fix beside the change ships unreviewed,
and a pass that follows its findings into the neighbourhood spends its budget there. A dispatched
reviewer files each as a low-priority ticket itself, and by hand the orchestrator files what it
reports; either way the orchestrator triages them and runs them once the user's own work is done. A fix
the reviewer watched fail and pass needs no second reader: a second review is for a pass that
reworked over 750 lines of code, documentation and comments not counted, and is always asked of the
orchestrator, which decides between a further round and a new ticket for what keeps turning up.

The round is the number of `## Review` sections already in the ticket, plus one. From round 2 on,
say in the first line that the pass is scoped to the commits the previous reviewer authored and that
what the earlier Reviews settled is not to be re-derived. Step 0 reads the diff once because
reviewers that rebuilt the change file by file spent 43% of their input on reads, most of them of a
file already open, each paid at a context of 150 to 250 thousand tokens. Step 7b is a count, not a
judgement, so that two reviewers reach the same verdict. Harness subagents get their working
directory reset to the main checkout, which is why every git command names its checkout.

```
Worktree: <absolute path>   Branch: <branch>   Main checkout: <absolute path>   Main line: <name>
agent-progress row: <reviewRowId, the id of this review's own bar>
Review ticket <id> (or the bundle #a, #b, #c), round <N>; `agent-progress ticket show <id>` prints
one. Run git as `git -C <worktree>` unless a step names <main checkout>. The work is
`git diff <main line>...HEAD`.

0. Before you change anything, record `git -C <worktree> rev-parse HEAD` as <review start>. Then
   read the change once: the last `## Handoff`, `git -C <worktree> diff --stat <main line>...HEAD`,
   then the full `git -C <worktree> diff <main line>...HEAD` in one call (a large one split by path
   into the fewest calls, all in one message). Open a whole file only where the diff's context
   cannot settle a finding, every such file in one message of Read calls, never `cat` or `sed -n`
   through Bash. Re-read your own fixes with `git -C <worktree> diff <review start>`, not by
   re-opening files.
1. Set out to show the ticket does NOT hold — each ticket of a bundle on its own commits, and
   whatever a Handoff lists under `Also fixed`. The last `## Handoff` says where to look and proves
   nothing: re-run the measurement behind each claim with your own probe or count and state your
   numbers; a guard it watched fail, you watch fail. It fails if any is false: <two or three claims;
   a dispatched review reads them from the ticket's `## Brief`, under `Fails review if false`>.
2. Fix every finding in what you review — the branch's change and the ticket's Acceptance — yourself,
   with the Edit tool (no heredoc, edit script or `sed -i`), one commit per fix, one plain subject
   line. A defect outside that, however small, you report and do not fix, a few lines each with
   where and what you would do; so is a finding that needs a product or design decision or touches a
   file out of bounds. The orchestrator files those.
3. A change you reasoned to but did not watch fail and pass: build the probe and watch it. A doubt
   still open at the budget is `does not hold`, never a caveat.
   Every probe that touches a scratch repository names it absolutely (`git -C <scratch>`,
   `--root <scratch>`, `cd <scratch> && …` joined with `&&`, never `;`); never write into any
   `.git` directory by hand.
4. Count your fixes before you rebase, since the rebase rewrites <review start>:
   `agent-progress rework --since <review start> --worktree <worktree>`.
5. Record `git -C <worktree> rev-parse HEAD` as <pre-rebase tip>, then `git rebase <main line>`,
   never `-i`: resolve with Edit, `git add`, `GIT_EDITOR=true git rebase --continue`. Run
   `<full check command> 2>&1 | tail -20` until green, commit what is uncommitted. Step 3 covers
   hunks you resolved by hand. Count what the rebase changed:
   `agent-progress rework --rebased-from <pre-rebase tip> --main <main line> --worktree <worktree>`.
   The rebase is exempt from the budget: past it, finish the rebase anyway, never
   `git rebase --abort`; a big resolution is what step 7b is for.
6. Append `## Review` at the end of the ticket, under 15 lines: each finding in one line with its
   file, your commits, what the rebase touched and what you resolved by hand, and both counts.
7. The first that applies:
   a. A gap you could not close: `does not hold`.
   b. Over 750 lines of code reworked — the two counts together; the tool counts code only, never
      a comment, a blank line or documentation: request round <N+1>, stating the count and whether
      the branch holds as it stands. Nothing else is a reason for another review.
   c. Otherwise release: step 8.
8. Release through the command, never `git merge`: it fast-forwards <main line>, delivers the
   ticket and your review bar, and cleans up, under the tracker's lock, so it cannot race another release.
   `cd <main checkout>` first, since your worktree is about to go, then run
   `agent-progress release <id> --branch <branch> --worktree <worktree> --main <main line> --json`
   (a bundle: every id in the one call). Act on what it prints:
   - `"released": true`: done. Name any `cleanup` step that is `left`, and the files it lists.
   - `"reason": "main-moved"`: another branch went in first. Repeat step 5 — record the tip, rebase,
     checks, `agent-progress rework --rebased-from` — add that count to your total and to your
     `## Review`, and apply step 7 again: over 750 now requests the next round; otherwise run
     this step again.
   - Any other reason: change nothing and report `holds, not released: <reason>` with its `detail`.
   - Denied by the permission system: do not retry or reword it, and never merge around it; report
     `holds, not released: permission denied` with the command line as you would have run it.

Do not `cat` any CLAUDE.md. You may use up to about 75 API calls, half the builder's budget, since
you judge one change rather than build it; a pass that is done sooner stops sooner. A fix that will
not fit is reported unfixed, never left half made.
Report under 150 words plus 40 per finding handed on, opening with exactly one of: `released <commit>` /
`holds, not released: <why>` /
`round <N+1> requested, branch holds` /
`round <N+1> requested, branch does not hold` /
`does not hold: <what is missing>` — then findings, your changes, what the rebase took.
```

No message is sent to a finished agent, reviewer or builder. Two releases into one checkout would
race, and `agent-progress release` serialises them under the tracker's lock instead of through the
orchestrator: the reviewer whose branch was overtaken reads `main-moved`, rebases, re-checks, counts
the rebase and releases again inside its own pass, or asks for the next round when the rebase pushed
its reworked total over 750.

## Orchestrator checklist

For a ticket dispatched by hand only: the dispatcher's prompts carry their own marker lines and its
agents move their own rows. Register the row before the agent starts and name it in the brief's `agent-progress row: <rowId>`
line; the `SubagentStop` hook reads that line from the brief alone and adds the agent's `input` —
every token it processed, the figure its log line ends on, `input 3.8M (cache read 3.6M)` — to the
row when the agent stops. It adds rather than sets, so a row
several agents worked on carries all of them, and a workflow script's agents reach their row the same
way. A bundle, and a ticket without a row yet — a low one, whose row the builder's own claim creates —
is named by ticket instead, `agent-progress ticket: 22, 20`, the same ids as the builder's one
`ticket claim 22 20`, and the hook divides evenly over their rows, looking each up when the agent
stops; keep one of the two lines, since a brief with both is read by its row line alone. The review
brief always names the review bar's own row. **Where the hook is installed, pass no `--tokens`**: it would replace the sum. The harness's own
`subagent_tokens` is roughly the end context and is the fallback for a repository without the hook,
recorded with `--tokens` as the understatement it is. 30 rows filled in from it summed to 4.8 million
against 273 million processed, and not by a constant factor: a reviewer ending on 90 thousand had
processed 0.4 million, an implementer ending on 420 thousand had processed 35 million. The review is
a clean agent briefed from the Review brief above, never the orchestrator reading the diff.

```
agent-progress task add "<what the agent will do>" --owner <model> --start   # its id goes on the brief's `agent-progress row:` line
agent-progress task finish <id>                # add `--tokens <subagent_tokens>` only without the hook
agent-progress ticket review <id>              # then a clean reviewer in its own row, from the Review brief
agent-progress task add "Review <N> #<id> — <ticket title>" --review-of <id> --owner opus --start   # the review's row, drawn under the ticket's
agent-progress task finish <reviewRowId>       # then `task deliver <reviewRowId>`: for every verdict but `released`, which delivered it
```

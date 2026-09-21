# Agent brief

The brief an orchestrator fills in before it spawns an implementing agent, and the review brief for
the clean agent that judges the result. Every API call a subagent
makes re-reads its whole transcript, so the length of that transcript, not the size of the change, is
what the work costs: across 73 subagents building one repository, 1.7 billion cache-read input tokens
stood against 6.0 million tokens of output. Every section below exists to keep a transcript short.

Fill in the placeholders and paste the fenced blocks, in order, as the agent's whole prompt — every
section down to Report for an implementing agent, the Review brief for a reviewer.

## Scope

One ticket, or one half of a ticket that splits cleanly. Agents handed two tickets at once ran 250 to
297 API calls and ended on 543 to 720 thousand tokens of context, of which 84% was billed above the
200k window at the long-context rate.

The file list is a starting point, not a fence. An orchestrator writes it from outside the code and
gets it wrong: a list that omits the one file the acceptance actually needs sends back a ticket with
a gap in it, and the agent was right to stop rather than bodge the fix somewhere cheaper. Three of
one board's reopenings came from exactly that, each costing a fresh agent and a fresh review. Name
where the work belongs, allow the agent past it when the acceptance requires, and make it declare
what it added so the reviewer knows to look there.

```
Worktree: <absolute path>   Branch: <branch>
Task: <the one ticket, or the half of it this agent owns>.
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
brief that names its own end is therefore cheaper than one that trusts the agent to notice. One budget
of about 100 calls covers every ticket, because the expensive calls are the ones carrying more than
200 thousand of context: 62% of all tokens were processed in those, and the 18 implementing agents
that were 85% of 273 million tokens ran a median of 70 calls to 240 thousand of end context, four of
them past 100. A fresh agent restarts at about 100 thousand, so a ticket too big for one budget is
split by mechanism into halves joined with `ticket depends` when it is filed. The budget itself is
not shaved to force that: three tickets in one afternoon took 8, 7 and 6 agents each, and every fresh
agent pays the fixed context and its own rediscovery again.

```
Stop when the ticket's Acceptance block is satisfied, or at about 100 API calls, whichever is first.
Then leave green whatever is green, close as "Ready to merge" says, write the Handoff, and report.
You will not be sent a follow-up message: a fresh agent takes whatever is left.
```

## Ready to merge

Every agent that touches a branch, builder or reviewer, leaves it ready to merge: committed, level
with the main line, the full checks green on the merged result. What the reviewer judges is then what
ships. A merge resolved after a passing review is unreviewed work riding in on a verdict that did not
cover it, and a conflict resolution is the easiest place in a repository to lose a line nobody
misses, or to loosen an assertion that was holding a defect down — so the merge comes before the
review, and whoever resolves it says how much resolving there was.

```
Close in this order, git as `git -C <worktree>`:
1. Commit on <branch>: one plain subject line, no attribution trailer.
2. `git merge <main line>`; resolve with git and the Edit tool.
3. Full checks until green on the merged result; commit what is uncommitted.
Merge beyond the budget: `git merge --abort`, keep your commit, say so in the Handoff.
Never merge <branch> into <main line>.
```

## Report

The report goes to the orchestrator and the Handoff stays with the ticket, because the next agent on
this work reads the Handoff instead of re-deriving it from the codebase.

```
Report in under 200 words: files changed, the verification result, and anything you could not do.
Then append `## Handoff` at the end of the ticket, under 15 lines: files touched, contracts you
discovered that the ticket did not state, what is verified and how (naming the screenshot paths), what
is not, what the merge of the main line touched and what you resolved by hand, and the next concrete
step — named so the follow-up agent starts working instead of re-orienting.
```

## Review brief

The reviewer is a clean agent: freshly spawned and handed this block, plus the Browser loop block
when the work has a user interface. It owns the whole pass — an adversarial review, every fix that
review calls for, the certainty of those fixes, a closing merge of the main line — and, when that
pass was small, the release, because an orchestrator merging a branch it has not read adds a step and
no judgement. A reviewer that did a lot is a builder nobody has reviewed: the first reviewer
schedules the second review on its own judgement, and from the second on a reviewer asks the
orchestrator, which decides between a further round and a new ticket for what keeps turning up.

The round is the number of `## Review` sections already in the ticket, plus one. From round 2 on,
say in the first line that the pass is scoped to the commits the previous reviewer authored and that
what the earlier Reviews settled is not to be re-derived. The thresholds in step 6 are there so that
two reviewers reach the same verdict; move them for a repository where they fire too often or too
seldom. Harness subagents get their working directory reset to the main checkout, which is why every
git command names its checkout.

```
Worktree: <absolute path>   Branch: <branch>   Main checkout: <absolute path>   Main line: <name>
Review ticket <id>, round <N>; `agent-progress ticket show <id>` prints it. Run git as
`git -C <worktree>` unless a step names <main checkout>. The work is `git diff <main line>...HEAD`.

1. Set out to show the ticket does NOT hold. The last `## Handoff` says where to look and proves
   nothing: re-run the measurement behind each claim with your own probe or count and state your
   numbers; a guard it watched fail, you watch fail. It fails if any is false: <two or three claims>.
2. Fix every finding yourself with the Edit tool — no heredoc, edit script or `sed -i` — one commit
   per fix, one plain subject line.
3. A change you reasoned to but did not watch fail and pass: build the probe and watch it. A doubt
   still open at the budget is `does not hold`, never a caveat.
4. `git merge <main line>`, resolve with git and Edit, run `<full check command> 2>&1 | tail -20`
   until green, commit what is uncommitted. Step 3 covers hunks you resolved by hand. Beyond the
   budget: `git merge --abort`, do step 5, report `merge unresolved`.
5. Append `## Review` at the end of the ticket, under 15 lines: each finding in one line with its
   file, your commits, what the merge touched and what you resolved by hand.
6. The first that applies:
   a. A gap you could not close: `does not hold`.
   b. Your own work is big — your fix commits change over 30 non-spec lines or a non-spec file the
      builder's diff lacks, the merge conflicted in two or more non-spec files or broke a check, or
      step 3 took over ten calls — and <N> is 1: `agent-progress ticket rereview <id>`, asking
      nobody, and nothing else.
   c. Big, and <N> is 2 or more: request round <N+1>, saying whether the branch holds as it stands.
   d. Otherwise request the release. Merge nothing into <main line> yet.
7. Never release without a granted slot. The only follow-ups you may get are these two:
   - "main moved": repeat steps 4 to 6 and report again. You hold no slot.
   - "slot granted": `cd <main checkout>` first, since your worktree is about to go. If
     `git -C <main checkout> branch --show-current` prints <main line>,
     `git -C <main checkout> merge --ff-only <branch>`. Refused, or another branch: change nothing
     and report `not released`. Then `git -C <main checkout> worktree remove <worktree>` (never
     `--force`; refused: say what is untracked) and `git -C <main checkout> branch -d <branch>`.

Do not `cat` any CLAUDE.md. Stop at about 60 API calls, step 3 permitting.
Report under 150 words, opening with exactly one of: `holds, release requested` /
`holds, review 2 owed` / `round <N+1> requested, branch holds` /
`round <N+1> requested, branch does not hold` / `merge unresolved: <why>` /
`does not hold: <what is missing>` — then findings, your changes, what the merge took.
After "slot granted": `released <commit>` or `not released: <why>`.
```

The two release-slot messages are the only ones a finished agent is ever sent, because two reviewers
merging into one checkout race and the orchestrator is the only one who knows both exist. A slot is
granted only against a main line that has not moved since the request; otherwise the reviewer is sent
back to merge, check and judge again, and asks anew. Each is one line, since step 7 holds the
instructions:

```
Slot granted for <branch>: the main line has not moved since you asked. Release now.
```

```
Main moved (#<id> was released), no slot: repeat steps 4 to 6 on <branch> and report again.
```

## Orchestrator checklist

Register the row before the agent starts and record what it cost when it ends. When the `SubagentStop`
hook is installed, take the number from the line it logs, which ends `input 3.8M (cache read 3.6M)`:
`input` is every token that agent processed. The harness's own `subagent_tokens` is roughly the end
context and is the fallback for a repository without the hook, recorded as the understatement it is.
30 rows filled in from it summed to 4.8 million against 273 million processed, and not by a constant
factor: a reviewer ending on 90 thousand had processed 0.4 million, an implementer ending on 420
thousand had processed 35 million. The review is a clean agent briefed from the Review brief above,
never the orchestrator reading the diff.

```
agent-progress task add "<what the agent will do>" --owner <model> --start
agent-progress task finish <id> --tokens <n>   # <n> is `input` from the hook's log line; subagent_tokens only without the hook
agent-progress ticket review <id>              # then a clean reviewer in its own row, from the Review brief
```

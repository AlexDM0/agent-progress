# Agent brief

The orchestrator's brief: how to scope a ticket, write its `## Brief`, and brief an agent by hand.
Every API call a subagent makes re-reads its whole transcript, so the length of that transcript, not
the size of the change, is what the work costs. Every section below exists to keep a transcript short.

The agents read briefs of their own: a builder `.agent-progress/builder-brief.md`, a reviewer
`.agent-progress/review-brief.md`. The dispatcher names the right one in each prompt, and the
orchestrator writes the Ticket brief block below into every ticket it files, as its `## Brief`, which
the builder reads as its scope and contract. By hand, while the dispatcher is stopped, fill in the
placeholders and paste the fenced blocks, in order, as the agent's whole prompt — the Scope and
Contract blocks below and every block of the builder brief for an implementing agent, the review
brief's block for a reviewer. Both run on {{modelDisplayName}} at {{effort}} effort unless their ticket names another model or effort:
the dispatcher passes each agent its ticket's pair, and by hand the `agent-progress-worker` agent
definition carries the defaults, so a ticket that overrides them goes through the dispatcher.

## Scope

One large ticket, one half of a ticket that splits by mechanism, or **a bundle of small tickets from
one neighbourhood of the code**. What an agent costs is dominated by starting it, not by keeping it
going, so three small tickets in one agent cost one start and one review instead of three of each,
and the agent sees the three as one picture. What stays forbidden is two LARGE tickets in one agent.

A bundle is two to four tickets the orchestrator expects to fit one budget together, that touch the
same files or the same mechanism, worked in the order given — dependencies first — with one commit
and one Handoff per ticket, so each can be judged, reverted and delivered on its own. **A bundle is
one agent and holds one slot**: its builder claims every ticket in one `ticket claim` call, which
starts them all or none and marks their rows as one agent. A dependency on another ticket in the
same claim counts as settled; one on a ticket outside it that is not reviewed or delivered refuses the
whole claim. Starting them one at a time — a claim or a `ticket start` per ticket — counts each as an
agent of its own, and a three-ticket bundle on a limit of 2 cannot be claimed that way at all.

The file list is a starting point, not a fence. An orchestrator writes it from outside the code and
gets it wrong, and an agent that stops rather than bodge the fix somewhere cheaper was right to. Name
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
with their line ranges; a long reading list is what produces the longest runs. Forbid reading a
`CLAUDE.md` outright, because the harness injects a nested one the first time a file in its folder is
opened, and a worktree inside the repository gets the root file injected a second time.

**Brief the invariant, not the instances you happen to know.** A defect found in one place is usually
a class, and an agent handed a list fixes the list. When a ticket fixes an instance, state the rule it
is an instance of and make the search an acceptance item, with the count of sites examined reported —
so a search cannot pass by having looked at nothing.

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
are ordered with `--depends-on` rather than fenced here. A group ticket's `## Brief` never states a
worktree, a branch or a release step: the group run's prompts name them, and the release ticket's
reviewer releases the whole group.

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

## Browser loop, bounded

Only for work with a user interface, pasted into the ticket's `## Brief`, where its builder and its
reviewer both read it. A screenshot loop pays for the transcript again on every call and carries an
image each time, so the page is read as text and screenshots are kept for evidence. The evidence
directory is an absolute path outside the worktree: an untracked file inside it makes
`git worktree remove` refuse at release, and `--force` would delete the evidence the Handoff names.

```
This work has a user interface. Budget about 15 browser calls in total.
Read the page as text; send one batch per interaction sequence, not one call per click.
Take screenshots only as final evidence, saved as `<evidence directory>/<ticket>-<acceptance item>.png`.
The harness's screenshot-after-every-step workflow does not apply here.
Stop only the editor you started, by the PID you started it with.
Never `pkill` or `killall` by a pattern: other agents run editors of their own.
```

## Orchestrator checklist

For a ticket dispatched by hand only: the dispatcher's prompts carry their own marker lines and its
agents move their own rows. Claim the ticket before the agent starts, which starts the ticket's own
row rather than a second one beside it, and name that row in the brief's `agent-progress row: <rowId>`
line; the `SubagentStop` hook reads that line from the brief alone and adds the agent's `input` —
every token it processed, the figure its log line names just before `output`,
`input 3.8M (cache read 3.6M)` — to the row when the agent stops. It adds rather than sets, so a row
several agents worked on carries all of them, and a workflow script's agents reach their row the same
way. A bundle, and a ticket without a row yet — a low one, whose row the builder's own claim creates —
is named by ticket instead, `agent-progress ticket: 22, 20`, the same ids as the builder's one
`ticket claim 22 20`, and the hook divides evenly over their rows, looking each up when the agent
stops; keep one of the two lines, since a brief with both is read by its row line alone. The review
brief always names the review bar's own row. **Where the hook is installed, pass no `--tokens`**: it
would replace the sum. The harness's own `subagent_tokens` is roughly the end context, far below what
the agent processed and not by a constant factor, so it is the fallback for a repository without the
hook only, recorded with `--tokens` as the understatement it is. The review is a clean agent briefed
from the review brief, never the orchestrator reading the diff.

```
agent-progress ticket claim <id> --owner <model> --note "<what the agent will do>"   # starts the ticket's own row
agent-progress ticket show <id>                # its `task:` is the rowId on the brief's `agent-progress row:` line
agent-progress ticket finish <id>              # moves that row to in-review, `--tokens <subagent_tokens>` only without the hook; then a clean reviewer in its own row
agent-progress task add "Review <N> #<id> — <ticket title>" --review-of <id> --owner opus --start   # the review's row, drawn above the ticket's
agent-progress task finish <reviewRowId>       # then `task deliver <reviewRowId>`: for every verdict but `released`, which delivered it
```

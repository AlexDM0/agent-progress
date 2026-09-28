# Builder brief

What a builder follows beside its ticket's `## Brief`: every block below, in order. Each API call
re-reads the whole transcript, so what a build costs is the length of its transcript, not the size
of its change; every block here exists to keep that transcript short.

## Call discipline

Each call is a whole transcript re-read, and so is every command typed into an earlier one: a
heredoc or an edit script is paid for again by every later call, and so is each extra run of the
full checks.

```
Open every file named above in ONE message with several Read calls.
Existing files change through the Edit tool only, never through a script run in Bash: no heredoc,
no python or perl edit script, no `sed -i`. New files through Write.
Every probe that touches a scratch repository names it absolutely (`git -C <scratch>`,
`AGENT_PROGRESS_ROOT=<scratch>` before every agent-progress command in it, `cd <scratch> && …`
joined with `&&`, never `;`); `--root` is `init`'s alone, and any other command refuses it. Never
write into any `.git` directory by hand.
While iterating verify with `<the narrow command: the spec file you touched>`.
Run the full checks only at the close described under "Ready to merge", output piped through
`tail`: `<full check command> 2>&1 | tail -20`.
```

## Stop conditions

A brief that names its own end is cheaper than one that trusts the agent to notice, and an agent
continued with a follow-up message pays for everything the first instruction read. One budget of
about {{builderApiCallBudget}} calls covers every ticket and every bundle: up to it a longer run
costs less than a fresh agent rediscovering what the first one knew, and past it the calls grow
dearer than a fresh start.

```
Stop when every Acceptance block you were given is satisfied, or at about {{builderApiCallBudget}} API calls, whichever
is first. In a bundle, never start a ticket you cannot finish inside the budget: leave it untouched
and say so.
Then leave green whatever is green, close as "Ready to merge" says, write the Handoff, and report.
You will not be sent a follow-up message: a fresh agent takes whatever is left.
```

## Find and fix

The agent that finds a defect already holds the file, the reason and the measurement; a ticket makes
the next agent buy all three again. So the default is to fix, and a ticket is for what this agent
cannot responsibly settle.

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

Every agent that touches a branch leaves it ready to merge: committed, rebased onto the main line,
the full checks green on the result. The branch is released by a fast-forward, so what the reviewer
judges is what ships, and the rebase comes before the review.

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

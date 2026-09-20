# Agent brief

The brief an orchestrator fills in before it spawns an implementing agent. Every API call a subagent
makes re-reads its whole transcript, so the length of that transcript, not the size of the change, is
what the work costs: across 73 subagents building one repository, 1.7 billion cache-read input tokens
stood against 6.0 million tokens of output. Every section below exists to keep a transcript short.

Fill in the placeholders and paste the fenced blocks, in order, as the agent's whole prompt.

## Scope

One ticket, or one half of a ticket that splits cleanly. Agents handed two tickets at once ran 250 to
297 API calls and ended on 543 to 720 thousand tokens of context, of which 84% was billed above the
200k window at the long-context rate.

```
Worktree: <absolute path>   Branch: <branch>
Task: <the one ticket, or the half of it this agent owns>.
You may edit: <the files it may touch>. Nothing else. Do not commit.
```

## Contract, not a reading list

State the three to eight facts the agent would otherwise go and discover, and name the files to open
with their line ranges; a 40-file reading list is what produced those 250-call runs. Forbid reading a
`CLAUDE.md` outright, because the harness injects a nested one the first time a file in its folder is
opened — 128 injections and 1.8 million characters in that same build — and a worktree inside the
repository gets the root file injected a second time.

```
Facts you do not need to look up:
1. <fact the agent would otherwise search for>
2. <fact, contract or file location>
Open exactly these, in one message: <path>:<lines>, <path>:<lines>.
Do not `cat` any CLAUDE.md: the root one is already in your context, and a nested one is injected
when you first open a file in its folder.
```

## Call discipline

Each call is a whole transcript re-read, so a batch of reads costs what a single read costs and four
separate verification runs cost four transcripts. The 13 implementing agents briefed this way ran a
median of 32 calls to 165k end context, with a mean input of 4.8 million tokens against 32.1 million
for the agents briefed the old way.

```
Open every file named above in ONE message with several Read calls.
Write new files with the Write tool, never a heredoc.
Verify once per batch of edits with `<verify command>`.
```

## Browser loop, bounded

Only for work with a user interface. One agent spent about 40 consecutive calls inside a screenshot
loop, each of them paying for the transcript again and carrying an image, so the page is read as text
and screenshots are kept for evidence.

```
This work has a user interface. Budget about 15 browser calls in total.
Read the page as text; send one batch per interaction sequence, not one call per click.
Take screenshots only as final evidence, named `<ticket>-<acceptance item>.png`.
The harness's screenshot-after-every-step workflow does not apply here.
```

## Stop conditions

An agent continued with a follow-up message had a median of 149 calls and 367k of end context against
62 and 229k for a fresh one, because the second instruction pays for everything the first one read. A
brief that names its own end is therefore cheaper than one that trusts the agent to notice. The budget
is not a target to undercut: three tickets in one afternoon took 8, 7 and 6 agents each, and every
fresh agent pays the fixed context and its own rediscovery again, so a budget a little too loose
costs less than one too tight.

```
Stop when the ticket's Acceptance block is satisfied, or at the call budget, whichever is first:
about 100 API calls for a small ticket, about 150 for a medium one — <the budget for this one>.
Then leave green whatever is green, write the Handoff, and report.
You will not be sent a follow-up message: a fresh agent takes whatever is left.
```

## Report

The report goes to the orchestrator and the Handoff stays with the ticket, because the next agent on
this work reads the Handoff instead of re-deriving it from the codebase.

```
Report in under 200 words: files changed, the verification result, and anything you could not do.
Then append `## Handoff` below the ticket's frontmatter, under 15 lines: files touched, contracts you
discovered that the ticket did not state, what is verified and how (naming the screenshot paths), what
is not, and the next concrete step — named so the follow-up agent starts working instead of re-orienting.
```

## Orchestrator checklist

Register the row before the agent starts and record what it cost when it ends: the token column read
0 on every row of the 73-agent build because nobody filled it in, and that is how six sessions of
cost stayed invisible. Review from the Handoff and the screenshots — a second browser session buys
evidence that has already been paid for.

```
agent-progress task add "<what the agent will do>" --owner <model> --start
agent-progress task finish <id> --tokens <n>   # <n> is subagent_tokens from the completion notification
agent-progress ticket review <id>              # from the Handoff and the screenshots, never a second browser session
```

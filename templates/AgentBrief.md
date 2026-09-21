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
Run the full checks exactly once, before you write the Handoff, output piped through `tail`:
`<full check command> 2>&1 | tail -20`.
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

Register the row before the agent starts and record what it cost when it ends. When the `SubagentStop`
hook is installed, take the number from the line it logs, which ends `input 3.8M (cache read 3.6M)`:
`input` is every token that agent processed. The harness's own `subagent_tokens` is roughly the end
context and is the fallback for a repository without the hook, recorded as the understatement it is.
30 rows filled in from it summed to 4.8 million against 273 million processed, and not by a constant
factor: a reviewer ending on 90 thousand had processed 0.4 million, an implementer ending on 420
thousand had processed 35 million. Review from the Handoff and the screenshots — a second browser
session buys evidence that has already been paid for.

```
agent-progress task add "<what the agent will do>" --owner <model> --start
agent-progress task finish <id> --tokens <n>   # <n> is `input` from the hook's log line; subagent_tokens only without the hook
agent-progress ticket review <id>              # from the Handoff and the screenshots, never a second browser session
```

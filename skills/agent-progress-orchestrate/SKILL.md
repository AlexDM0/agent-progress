---
name: {{skillName}}
description: >-
  Work an {{program}} board alongside its running Overseer, the Overseer: start
  it on the user's go and give its URL, say what it is doing, turn what the
  user wants into board commands (ready, hold, priority, pause, answer a
  question, message, wind down or stop a job, start an intake), take ticket
  requests through the {{productOwnerSkill}} skill, and put each new question
  to the user. Use this skill only when the user says "/{{skillName}}", asks
  you to orchestrate, run the board, work through the tickets, manage the
  queue or "take tickets from me". Filing or editing a ticket is not one of
  them.
disable-model-invocation: true
---

# Working alongside an {{program}} Overseer

You are the user's interactive wrapper around this board's Overseer, the Overseer. The Overseer drives every ticket
through its build, review and merge, and its Assistant settles the incidents its code cannot. You start it when the
user says go, tell the user what it is doing, and turn what the user wants into commands. You never drive the
lifecycle yourself and never handle an incident.

**Filing is the `{{productOwnerSkill}}` skill's**, which Intake loads; nothing of it is repeated here.
`{{program}} help` prints every command and flag, and `{{dataFolder}}/reference.md` holds the ticket file's format,
the moves, jobs, decisions and incidents, and the exit codes. Run every command on a line of its own and parse its
`--json`; never write a file under `{{dataFolder}}/` with a file tool, nor a ticket above its frontmatter's closing
line, and never commit the tracker.

## Opening sequence

Send the first two as separate calls in one message, never joined into one shell line, then act on them.

1. `{{program}} run status --json`: whether the Overseer is up, its URL, paused or not, its notices and a failed
   Baton pass's warning.
2. `{{program}} status --json`: the drafts, the ready tickets, the jobs, the open decisions and incidents. Exit 1
   saying there is no tracker: ask whether to `{{program}} init` here, and do not create one uninvited.
3. Report the board in at most six lines: the Overseer's state and URL, the jobs in flight, the drafts waiting to be
   readied, the decisions waiting on the user, any notice, and the open filing drafts with their open question
   count. Then say you are ready for requests.
4. When the Overseer is down, ask whether to start it. On the user's yes run `{{program}} run --detach` and give the
   URL it prints. Never start it unasked.

## Intake: what to do with what the user says

A question is a question: answer it from the board and file nothing. A bug, a change or a feature becomes a draft
ticket, filed as the `{{productOwnerSkill}}` skill says. Load it once, at the first filing, skip the reads of its
Before the first ticket the opening sequence already made, and follow it to its closing question, which readies
the drafts the user says yes to in this session.

**Every question for the user is asked with the host's question tool, never left as prose**: two to four concrete
options, the recommended one first with "(Recommended)" in its label, each after a context block in the message
text. A question printed at the end of a message is easy to miss.

## Turning intent into commands

Map what the user says to the one command that does it, read its flags from `{{program}} help`, run it, and report
the outcome in a line:

- ready drafts to build, hold or unhold a ticket, change a priority or a network line, abandon a ticket;
- pause or resume the Overseer, stop or restart it;
- answer an open decision with `decide`, the user's own choice and never yours;
- message, wind down or stop a job;
- start a product-owner intake with `intake`, which the Overseer launches in a session of its own;
- ask the onboarder to `advise` on the pipeline from the gate history: its optimisations arrive as draft low tickets,
  and with no pipeline one runs by itself. Its `pipeline-proposal` decision is the user's to answer.

A command refused at exit 1 is reported with its reason and what would lift it. A refusal naming the install
version means `{{program}} update` is due: ask before running it in the main checkout.

## Waiting for the user's questions

While the user wants you to watch, run `{{program}} await --json` as a background command. It wakes when the log
holds a newly opened decision or an escalated incident; put each such decision to the user with the Watcher's question
tool, exactly as the agent or the Overseer worded it, run `decide` with the answer, and wait again with
`await --after <position>`. A decision the user leaves for later stays open on the board and in the Bridge.

## What you never do

Drive the lifecycle: the Overseer builds, reviews, merges and delivers, and no session moves a ticket through those
steps by hand. Handle an incident: that is the Assistant's, and its escalations reach the user as decisions. Add an
opinion to an agent's question. Write, review or merge code, or start a builder or reviewer yourself. Continue a
finished agent; the one exception is the Overseer's own, which resumes a builder, reviewer or merge-gate fixer in its own
session when its handoff goes red. Re-anchor with `{{program}} status --json` after a compaction or a long gap rather
than trusting your memory of the board.

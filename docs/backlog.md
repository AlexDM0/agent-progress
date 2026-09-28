# Backlog: agreed, not started

Each item is agreed in principle and deliberately not done, with the reason it waits.

---

## A ticket `edit` command

A ticket body is edited with a file tool at the path `agent-progress ticket show <id>` prints, and
the CLI preserves it byte for byte. That works, and it is what the skill tells an agent to do. What
it does not give is a way to *append* to a body — a finding, a second reproduction — without reading
the whole file first and rewriting it.

Agreed: `agent-progress ticket edit <id> [--append] [--body-file <path|->]`, writing through the
same atomic path as everything else and leaving the frontmatter alone. Not started because the
byte-for-byte guarantee is the load-bearing property of ticket bodies, and a command that rewrites
one needs its own specs for the cases that guarantee is about (CRLF, a body containing `---`, a
final newline the author did or did not write) before it is safe to offer.

## Pausing a ticket, not only its row

`task pause <id>` records that a row is waiting, and there is deliberately no ticket status for it:
the ticket statuses in `src/lib/tracker-model/constants/Statuses.ts` are the task statuses without `paused`
and `re-review`, so no ticket status reaches the state, because a paused ticket is still in progress. The gap that leaves is a reader of the Tickets tab
alone: a ticket sitting in `in-progress` for two days looks like work in flight, and only the chart and the
Kanban card (`paused since …`) say it has been paused since Tuesday.

Agreed in principle: surface the linked row's `paused` state on the Tickets tab's card too, as a property
of the row rather than as a ticket status. Not started because it is a render change and the page's template
is designer-owned, so it wants a design answer before a code one.

## The TicketStore moves step 7 left

`src/services/tracker/TicketStore.ts` still holds work that belongs elsewhere. Agreed:

- `createTicket`'s initial frontmatter moves to a model util or a Board method.
- `deleteAllTickets` moves to the ticket writer, `src/adapters/tickets/TicketFileWriter.ts`.
- `readTicket` becomes `board.ticketByReference`; `ticket show` in `cli/tickets/TicketReadingSubcommands.ts`
  still reads without a Board.
- `nextTicketId` takes the row ids from the Board instead of reading `progress.json` a second time.
- `TrackerChange.deleteAllTicketFilesAfterwards` in `src/services/tracker/TrackerPipeline.ts` is
  replaced by a Board query.

Not started because they are internal moves with no behaviour change, left when step 7 closed with
the features regrouped; they wait for the next change to ticket filing, `ticket show` or `clear --all`.

## A combined rework count

A reviewer adds the `rework --since` count and each `rework --rebased-from` count itself, the
repeats after `main-moved` included, to report `reworkedLines`: the review brief's steps 4, 5, 7b
and 8 in `resources/templates/AgentBrief.md` and the reviewer prompt in
`dispatcher/run/utils/AgentPromptUtil.ts` tell it to. Agreed: one count from the tool, so the
reviewer has nothing to add.

Not started because it changes what the reviewer is told, so it waits for a commit meant to change
the brief and the prompts, which retakes `dispatcher/testing/FrozenDispatchTraces.json`; the
dispatcher port kept the old script's instructions.

## Keeping the skill's copy of the formats in step

`skill/Reference.md` carries a word-for-word copy of three `docs/cli.md` sections, the ticket file
format, the ticket moves and the exit codes, kept in step by hand. Agreed: generate those sections of
`skill/Reference.md` from `docs/cli.md`, or pin them with a spec that fails when the two differ.

Not started because it is a code change (a generator or a guard spec, watched failing on each drifted
form), and the migration's step 9 changed documentation only.

## Retaking the README images

`docs/images/panel-tickets.png` and `docs/images/panel-watch.gif` show the ticket words `open` and
`done` that step 4a retired, and `panel-tickets.png` shows no Kanban tab.
`docs/images/terminal-init.svg` and the `terminal-init.png` built from it show init's report as it was
before step 8: its workflow line names `.claude/workflows/agent-progress-dispatch.js` where it now
names `.agent-progress/agent-progress-dispatch.js`.
`docs/images/lifecycle.svg` and `lifecycle.png` state the rework threshold as a figure, which the
README no longer repeats: redraw them without it. Agreed: retake them with
`.readme-graphics/regenerate.sh`. Its `compose.py` still builds the `frame-*`, `story-*` and
`board-day.gif` images only the deleted READMEs used, and the script copies every built image into
`docs/images/`: drop those jobs from `compose.py` first, or delete those copies before committing.

Not started because the script and its demo board are git-ignored and live only in the owner's main
checkout, which must run the merged code first.

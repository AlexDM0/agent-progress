# Backlog: agreed, not started

Each item is agreed in principle and deliberately not done, with the reason it waits.

---

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
and 8 in `resources/templates/ReviewBrief.md` and the reviewer prompt in
`dispatcher/run/utils/AgentPromptUtil.ts` tell it to. Agreed: one count from the tool, so the
reviewer has nothing to add.

Not started because it changes what the reviewer is told, so it waits for a commit meant to change
the brief and the prompts, which retakes `dispatcher/testing/FrozenDispatchTraces.json`; the
dispatcher port kept the old script's instructions.

## Keeping the skill's copy of the formats in step

`skills/agent-progress/Reference.md` carries a word-for-word copy of three `docs/cli.md` sections, the ticket file
format, the ticket moves and the exit codes, kept in step by hand. Agreed: generate those sections of
`skills/agent-progress/Reference.md` from `docs/cli.md`, or pin them with a spec that fails when the two differ.

Not started because it is a code change (a generator or a guard spec, watched failing on each drifted
form), and the migration's step 9 changed documentation only.

## Redrawing two README diagrams

`docs/images/terminal-init.svg` and the `terminal-init.png` built from it show init's report as it was
before step 8: its workflow line names `.claude/workflows/agent-progress-dispatch.js` where it now
names `.agent-progress/agent-progress-dispatch.js`.
`docs/images/lifecycle.svg` and `lifecycle.png` state the rework threshold as a figure, which the
README no longer repeats. Agreed: edit both SVGs, then re-render the PNGs with
`.readme-graphics/render-diagrams.py`.

Not started because the SVGs are hand-drawn, not generated: each wants a design pass rather than a
rerun of the script.

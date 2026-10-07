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

## README images of the spec-kit page

The README shows the tracker page only. Agreed: screenshots of `progress-spec.html`, retaken by
`.readme-graphics/regenerate.sh` like the others.

Not started because `.readme-graphics/` has no spec-kit fixture: it needs a demo spec-kit repository beside its demo
board first.

## A live reload for the spec-kit page

`progress-spec.html` is a snapshot that never reloads itself; a fresh one is another `agent-progress view-spec` run.
Agreed: a stamp the open page polls, as `progress.stamp.js` does for the tracker page, written by each run.

Not started because nothing reruns `view-spec` when a spec-kit file changes, so a polled stamp would only ever see
the runs the user made by hand.

## Git history as a source of stage dates

The spec-kit page dates each stage from the file system's creation and modification times, which a fresh clone or
checkout resets. Agreed: take a file's first and last commit from git where the repository has them, falling back
to the file system for uncommitted files.

Not started because it adds a git dependency and a slower scan to a command that now reads only the files, and the
first version shipped with the file dates and their caveat on the page.

## The orchestrated spec process

`view-spec` only reads a spec-kit repository. Agreed: drive spec-kit work through the board. A spec record per spec,
its phase tracked by the tool rather than derived from the files; one ticket per `tasks.md` phase, cut from the
spec and carrying its dependencies; an approval gate after Specify and after Plan that the orchestrator asks the user
to pass; and commands to add a spec and to cut its tickets.

Not started because it changes the stored format, the command surface and what the orchestrator is told, and the
read-only page comes first to show which of these the work needs.

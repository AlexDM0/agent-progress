# Backlog: agreed, not started

Each item is agreed in principle and deliberately not done, with the reason it waits.

---

## A `--tickets-only` view

`agent-progress status` prints the whole tracker, and the page's Tickets tab shows every ticket. A
session that is working through a ticket queue and does not care about task rows has to read past
both. Agreed: a `--tickets-only` flag on `status`, and the same narrowing as a stored view so the
page can open on the Tickets tab.

Not started because the shape of the flag is not obvious — whether it should also suppress the log,
and whether the page's version belongs in `progress.json` (shared by everyone) or in the browser's
own override (per viewer, like the range). Both answers are cheap to implement and expensive to
change once trackers exist in the wild, so it waits for a session that has actually felt the need.

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

## A `--tokens` total per owner

`agent-progress status` sums the token counts that were reported and says how many rows reported
one. What a session actually wants to know is which agent spent it — the `owner` column is right
there, and grouping by it is a few lines.

Not started because the owner field is free text an orchestrator writes by hand, so the grouping is
only as good as the spelling, and a total under `opus` and another under `Opus` is worse than no
grouping at all. It waits either for the owner to become a vocabulary or for the first session that
has felt the need.

## Pausing a ticket, not only its row

`task pause <id>` records that a row is waiting, and there is deliberately no ticket status for it:
the ticket statuses in `src/lib/tracker-model/constants/Statuses.ts` are the task statuses without `paused`
and `re-review`, so no ticket status reaches the state, because a paused ticket is still in progress. The gap that leaves is a reader of the Tickets tab
alone: a ticket sitting in `in-progress` for two days looks like work in flight, and only the chart
says it has been paused since Tuesday.

Agreed in principle: surface the linked row's `paused` state on the ticket card, as a property of the
row rather than as a ticket status. Not started because it is a render change and the page's template
is designer-owned, so it wants a design answer before a code one.

## A variable that turns the git skip into a failure

The conventions say an environment variable can turn a skipped spec into a failure on a machine that
has the tool. `gitIsAvailable` in `src/testing/ScratchWorkspace.ts` only checks `Bun.which('git')`,
and no such variable exists. When it is built, it is read through a getter in
`src/shared/Environment.ts`, like every environment read.

Not started because it was not taken into the conventions migration, which changes no behaviour
outside its plan; it waits for the first change after the merge that touches the test helpers.

## Renaming the model's `ProgressFile`

`ProgressFile` in `src/lib/tracker-model/@types/ProgressFile.ts` is the model's type for the
tracker's rows, view and settings, named after the file that stores them. Agreed: rename it for what
it is, for example to `TrackerProgress`.

Not started because the owner deferred it in step 6 to the migration's polish sweep (step 10), so the
rename crosses the model, the adapters and the services once, rather than inside a step that was
moving them.

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
the features regrouped; they wait for the polish sweep or the next change to ticket filing,
`ticket show` or `clear --all`.

## A combined rework count

A reviewer adds the `rework --since` count and each `rework --rebased-from` count itself, the
repeats after `main-moved` included, to report `reworkedLines`: the review brief's steps 4, 5, 7b
and 8 in `resources/templates/AgentBrief.md` and the reviewer prompt in
`dispatcher/utils/AgentPromptUtil.ts` tell it to. Agreed: one count from the tool, so the reviewer
has nothing to add.

Not started because it changes what the reviewer is told, so it waits for a commit meant to change
the brief and the prompts, which retakes `dispatcher/testing/FrozenDispatchTraces.json`; the
dispatcher port kept the old script's instructions.

## Keeping the skill's copy of the formats in step

`skill/Reference.md` carries a word-for-word copy of three `docs/cli.md` sections, the ticket file
format, the ticket moves and the exit codes, kept in step by hand. Agreed: generate those sections of
`skill/Reference.md` from `docs/cli.md`, or pin them with a spec that fails when the two differ.

Not started because it is a code change (a generator or a guard spec, watched failing on each drifted
form), and the migration's step 9 changed documentation only.

## Dropping the legacy folders

`src/shared/legacy/`, `src/adapters/legacy/`, `src/services/tracker/legacy/`, `cli/legacy/` and
`page/legacy/` answer the retired formats, words and flags. Agreed: drop each one as its users go,
the way the Legacy folders section of `docs/development.md` describes.

Not started because each waits for its users, as its module header says: every tracked repository
having run `agent-progress update`, and agents no longer typing retired verbs and words, `--hooks`,
or review-shaped names without `--review-of`.

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

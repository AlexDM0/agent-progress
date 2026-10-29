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

## Redrawing two README diagrams

`docs/images/terminal-init.svg` and the `terminal-init.png` built from it show init's report as it was
before step 8: its workflow line names `.claude/workflows/agent-progress-dispatch.js` where it now
names `.agent-progress/agent-progress-dispatch.js`.
`docs/images/lifecycle.svg` and `lifecycle.png` state the rework threshold as a figure, which the
README no longer repeats. Agreed: edit both SVGs, then re-render the PNGs with
`.readme-graphics/render-diagrams.py`.

Not started because the SVGs are hand-drawn, not generated: each wants a design pass rather than a
rerun of the script.

## Out of the code-owned lifecycle epic

Two things the `code-lifecycle` epic deliberately leaves out. Neither is deferred work waiting its turn here: each
returns only as a new decision of the owner's.

- **The Copilot worker adapter**, with `workers --vendor` and the `workerVendor` board key. The runner launches
  Claude Code and nothing else, behind the launcher port in `src/lib/agent-launch/` with one Claude Code adapter, so
  a second vendor is a new adapter behind that seam rather than a change to the lifecycle.
- **A cross-project overview.** Each repository's runner serves only its own board; the view across boards stays
  agent-dashboard's, a separate project reading the monitor registry and each runner's API, so agent-progress keeps
  no machine-wide process.

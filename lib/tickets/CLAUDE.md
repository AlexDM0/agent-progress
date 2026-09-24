# `lib/tickets/` — ticket files and what a status change means

Tickets are markdown files with frontmatter, living in the tracker directory and edited by hand by
agents between CLI runs. This folder owns the file format, the directory as a store, and the table
that says what each status change writes. It does not own any command, any lock or any rendering.

| file | what it is |
|---|---|
| `lib/tickets/Frontmatter.ts` | The YAML-shaped subset below: `parseTicketDocument(text)` → a verdict, `serializeTicketDocument(frontmatter, body)` → the file's text. |
| `lib/tickets/TicketStore.ts` | The tickets directory as a store: `listTickets`, `readTicket`, `writeTicket`, `nextTicketId`, `createTicket` (which assigns the id and composes the body from it, and writes nothing: the command writes the ticket after the progress file), `deleteAllTickets`. |
| `lib/tickets/TicketTransitions.ts` | `ensureTaskForTicket`, `applyTicketTransition`, `applyTicketRereview`, `seedTaskFromTicket` — the ticket → task transition table below — plus `LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS` and `ticketMoveIsLegal`, the matrix the named `ticket` verbs enforce; and the low-priority rule: `ticketStaysOffTheChart`, `ensureTaskForTicketOnTheChart` and `applyTicketPriority`. |

## The frontmatter subset, in full

This is the contract an agent editing a ticket by hand relies on, so it is stated here rather than
left to be read out of the parser.

- The file opens on line 1 with `---`. **The closing fence is the first later line equal to `---`**,
  because bodies contain horizontal rules.
- A leading byte order mark is dropped, and CRLF is accepted. The body is kept byte for byte from the
  character after the closing fence's newline, so a hand-written body never changes under a CLI
  command. The line ending used when writing is recovered from that body.
- Inside the fences every line is one of:
  - `key: value`, split at the **first** `': '` — so `title: Fix: the thing` keeps its second colon;
  - `key:` alone, which is an empty value;
  - a `#` comment line;
  - a blank line.
  Anything else — an indented line, a list item, a bare word — is a nested structure this subset does
  not have, and makes the file malformed. There are no nested maps, lists, anchors or block scalars.
- A value is `null`, an integer, a double-quoted JSON string, or an unquoted scalar taken verbatim.
- The keys the CLI owns are `id`, `title`, `type`, `priority`, `model`, `effort`, `status`, `filed`,
  `updated`, `started`, `finished`, `delivered`, `abandonedAt`, `group`, `branch`, `commit`, `reason`,
  `dependsOn` and `task`. `priority` is `low`, `normal` or `high`, any other value makes the file malformed, and an
  absent or `null` one stays absent in the frontmatter and reads as `normal` through
  `ticketPriorityOf`: it is written only once somebody names one, so no older ticket gains the key
  from a rewrite. `model` and `effort` follow the same rule against the vocabularies of
  `lib/constants/AgentSettings.ts`, an absent one resolving through `agentModelOf` and `agentEffortOf`. `dependsOn` is written `"001, 002"` and read from any mix of commas and spaces, with or
  without `#` or padding; a part that is not a ticket number makes the file malformed. `id`,
  `title`, `type`, `status`, `filed` and `updated` must be present; `type` and `status` must be
  values the tool knows; `task` is an integer or `null`; a timestamp key that is absent reads as
  `null`, which is how tickets written before `delivered` existed still parse.
- **Every other line — an unknown key, a comment, a blank line — is kept in `extra` in order and
  written back.** Add `owner: Alex Example` to a ticket and it survives every transition. The order
  that is preserved is the order among those lines, not their position between the CLI's keys; see
  the rule below.
- The CLI writes every string through `JSON.stringify` and omits an optional key it does not have.
  Reading accepts both forms, so a hand-written ticket with unquoted values parses too.
- **Known keys are rewritten at the top in the fixed order above; everything in `extra` follows in
  its original relative order.** A rewrite therefore moves hand-written lines below the CLI's block
  once, and never again. The CLI owns the order of its own keys; agents own the order of the rest.

## What each status change writes

One row per target status, as `applyTicketTransition` applies it. `ticket add` files a ticket `open`
with `filed` stamped and a `pending` row — no row for a low ticket, see below; every later move is one of these, whether it arrives
through a named verb or through `ticket status <id> <status>`.

| target | row status | ticket timestamps | log line |
|---|---|---|---|
| `open` | `pending` | `started`, `finished`, `delivered` and `abandonedAt` cleared; `reason` dropped | `Ticket #003 reopened` |
| `in-progress` | `running` | `started` if still null | `Ticket #003 started` |
| `in-review` | `finished` | `finished` if still null | `Ticket #003 in review` |
| `done` | `reviewed` | `finished` if still null | `Ticket #003 done` |
| `delivered` | `delivered` | `delivered` if still null | `Ticket #003 delivered` |
| `abandoned` | `abandoned` | `abandonedAt`, always | `Ticket #003 abandoned: <reason>` |

`updated` is stamped on every one of them, and `--branch`, `--commit` and `--reason` are written
when given. **A closing timestamp is set only when it is still null, while `abandonedAt` is set every
time**, because re-entering a status is a correction and abandoning twice is deciding twice.
`abandoned` without a reason is refused. Moving to `open` is the one move that deletes something a
person may have typed, which is why it is the only place `reason` is dropped.

`applyTicketRereview` is outside the table: it stamps `updated`, moves the row to `re-review` and
leaves the ticket `in-review` — see below. `seedTaskFromTicket` reads the same timestamps back the
other way when `clear` rebuilds the rows, ending the bar at `finished` rather than at `delivered`,
because delivery is a later fact about finished work rather than more of it.

## Which moves the verbs allow

`LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS` says which statuses each target may be reached from: start
from open or in-review, review from in-progress, done from in-progress or in-review, deliver from
done, abandon from anything but delivered or abandoned, reopen from anything but open. No row
contains its own key, so moving a ticket to the status it already has is never legal — that move used
to append a second, identical log line.

The six named verbs in `cli/ticket/TicketCommand.ts` consult it; `ticket status <id> <status>`
deliberately does not, which is what keeps a strict matrix affordable. `applyTicketTransition` checks
nothing, so `clear`'s re-seed can rebuild a row in any state.

`applyTicketRereview` is the one move outside that table, and the one exception to the rule above: a
ticket sent back for a second, third or fourth review pass stays `in-review`, because every pass is
still review. It stamps `updated` alone, moves the row to `re-review` and counts the round there, and
it checks its own one legal source rather than being given a matrix row of its own.

## A low ticket lives off the chart until it is started

`ticketStaysOffTheChart` is the one definition: low, never started, and open or abandoned. Such a
ticket without a row is given none — `ticket add` and `applyTicketTransition` go through
`ensureTaskForTicketOnTheChart`, which returns `null` for it, and `clear` skips it — so filing one
takes no task id. A row it already has is always kept, which is why a started low ticket that is
reopened keeps its bar. `applyTicketPriority` is the other way a row appears or goes: lowering to
low is refused unless the ticket is open and removes the row, and raising a row-less ticket files a
`pending` row while it is open or seeds one from its stamps otherwise. It is the one caller of
`removeTask`, so it alone takes `PriorityOperations`, the four operations below plus that one.

## `seedTaskFromTicket` seeds no history, on purpose

A row `clear` rebuilds from a ticket's frontmatter comes back knowing only the status it came back
in — the one phase `addTask` files for it, and none at all when that status is `pending`, since
`seedTaskFromTicket` passes no `filedAt`: the ticket's `filed` stamp is not when this row was
filed — and **not** a phase list reconstructed from `filed`,
`started`, `finished` and `delivered`. The ticket's stamps are the ticket's history, not the row's:
the row did not live through them, and a reconstruction written into `history` would be
indistinguishable from one the tool watched happen. It would also be wrong in a way nobody could
see, since a ticket records no trace of the review rounds its row went through. The ticket's own
stamps are on the detail panel already, in the Ticket section, where they are labelled as the
ticket's; a re-seeded row's phases read as unrecorded, which is what they are.
`cli/clear/ClearCommand.spec.ts` holds this.

## Why `TicketTransitions` takes its store operations as a parameter

`lib/progress/` is a sibling feature of this one, and the layering rule in the root `CLAUDE.md` is
that features never import sideways. `applyTicketTransition`, `ensureTaskForTicket` and
`seedTaskFromTicket` therefore take a `ProgressOperations` object, declared structurally in
`lib/tickets/TicketTransitions.ts`, and the command layer — which holds both features — passes the
real functions in. The four signatures it declares are:

```ts
addTask(progress, input: { name; owner?; note?; ticket?; status?; start?; end?; reviewed?; filedAt? }): Task
findTask(progress, taskId): Task | undefined
transitionTask(progress, taskId, status: TaskStatus, at: string): 'applied' | 'no-such-task'
appendLogEntry(progress, at, text): void
```

`ensureTaskForTicket` takes an `at` of its own on top of `TicketRowInput`, used only when there is
no row yet: the row a ticket files is filed at that moment, and it passes it on as `filedAt` so the
row's first phase says when it entered the queue.

A shape two modules must agree on that neither may import from the other is a structurally typed
parameter, not a shared import.

## Rules that hold here

- Nothing in this folder writes a file except through `lib/platform/AtomicFile.ts`, and nothing takes
  a lock: the command layer holds the lock and decides when the progress file and the ticket file are
  both written, so a transition cannot leave the two out of step.
- Nothing throws because a ticket file is bad. A malformed file is a listing entry and a `null`, so
  one broken file cannot take down `status` or `render`.
- `writeTicket` never touches `updated`. Only a transition knows that a ticket changed and when.
- Ticket ids come from file names, not from parsed frontmatter, so a file nobody can parse still owns
  its number. Gaps are tolerated and never filled.

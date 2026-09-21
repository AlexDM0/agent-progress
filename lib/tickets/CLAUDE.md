# `lib/tickets/` — ticket files and what a status change means

Tickets are markdown files with frontmatter, living in the tracker directory and edited by hand by
agents between CLI runs. This folder owns the file format, the directory as a store, and the table
that says what each status change writes. It does not own any command, any lock or any rendering.

| file | what it is |
|---|---|
| `lib/tickets/Frontmatter.ts` | The YAML-shaped subset below: `parseTicketDocument(text)` → a verdict, `serializeTicketDocument(frontmatter, body)` → the file's text. |
| `lib/tickets/TicketStore.ts` | The tickets directory as a store: `listTickets`, `readTicket`, `writeTicket`, `nextTicketId`, `createTicket`, `deleteAllTickets`. |
| `lib/tickets/TicketTransitions.ts` | `ensureTaskForTicket`, `applyTicketTransition`, `applyTicketRereview`, `seedTaskFromTicket` — the ticket → task transition table from `docs/plan.md` — plus `LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS` and `ticketMoveIsLegal`, the matrix the named `ticket` verbs enforce. |

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
- The keys the CLI owns are `id`, `title`, `type`, `status`, `filed`, `updated`, `started`,
  `finished`, `delivered`, `abandonedAt`, `group`, `branch`, `commit`, `reason`, `dependsOn` and
  `task`. `dependsOn` is written `"001, 002"` and read from any mix of commas and spaces, with or
  without `#` or padding; a part that is not a ticket number makes the file malformed. `id`,
  `title`, `type`, `status`, `filed` and `updated` must be present; `type` and `status` must be
  values the tool knows; `task` is an integer or `null`; a timestamp key that is absent reads as
  `null`, which is how tickets written before `delivered` existed still parse.
- **Every other line — an unknown key, a comment, a blank line — is kept in `extra` in order and
  written back.** Add `owner: Alex Example` to a ticket and it survives every transition. The order
  that is preserved is the order among those lines, not their position between the CLI's keys; see
  the rule below.
- The CLI writes every string through `JSON.stringify` and omits an optional key it does not have.
  Reading accepts both forms, so the unquoted style in `docs/plan.md`'s example parses too.
- **Known keys are rewritten at the top in the fixed order above; everything in `extra` follows in
  its original relative order.** A rewrite therefore moves hand-written lines below the CLI's block
  once, and never again. The CLI owns the order of its own keys; agents own the order of the rest.

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

## Why `TicketTransitions` takes its store operations as a parameter

`lib/progress/` is a sibling feature of this one, and the layering rule in the root `CLAUDE.md` is
that features never import sideways. `applyTicketTransition`, `ensureTaskForTicket` and
`seedTaskFromTicket` therefore take a `ProgressOperations` object, declared structurally in
`lib/tickets/TicketTransitions.ts`, and the command layer — which holds both features — passes the
real functions in. The four signatures it declares are:

```ts
addTask(progress, input: { name; owner?; note?; ticket?; status?; start?; end? }): Task
findTask(progress, taskId): Task | undefined
transitionTask(progress, taskId, status: TaskStatus, at: string): 'applied' | 'no-such-task'
appendLogEntry(progress, at, text): void
```

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

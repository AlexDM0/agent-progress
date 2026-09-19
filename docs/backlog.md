# Backlog: agreed, not started

**Nothing is in flight as of 2026-09-19.** No branch, no partial implementation, nothing half
written waiting for someone to come back to it. When that stops being true this line says so, with
the date and the branch.

This file is where a TODO would otherwise go — there are no TODOs in the code. An item here is
**agreed in principle and deliberately not done**, with the reason it is not done yet. An idea that
was considered and rejected belongs in `docs/decisions.md` instead, and neither file is a status
page.

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

`task pause <id>` records that a row is waiting, and there is deliberately no ticket status for it
(`docs/decisions.md`). The gap that leaves is a reader of the Tickets tab alone: a ticket sitting in
`in-progress` for two days looks like work in flight, and only the chart says it has been paused
since Tuesday.

Agreed in principle: surface the linked row's `paused` state on the ticket card, as a property of the
row rather than as a ticket status. Not started because it is a render change and the page's template
is designer-owned, so it wants a design answer before a code one.

import type { Task } from '../../lib/tracker-model/@types/Task.ts';

/** Only the prefix is read, and a bundle's first id is its parent: `Review 1 #13, #5 — …` reviews #13. */
const REVIEW_NAME_PATTERN = /^Review (\d+) #(\d+)/;

function ticketNumberOf(identifier: string | undefined): number | null {
  const value = Number(identifier);
  return identifier === undefined || identifier === '' || !Number.isSafeInteger(value) ? null : value;
}

/** Compared as a number, so a name's `#3`, a stored `003` and a ticket row's `003` all name one ticket. */
function reviewedTicketNumberOf(task: Task): number | null {
  if (task.reviewOf !== undefined) {
    return ticketNumberOf(task.reviewOf);
  }
  return ticketNumberOf(REVIEW_NAME_PATTERN.exec(task.name)?.[2]);
}

function reviewRoundNamedBy(task: Task): number {
  return ticketNumberOf(REVIEW_NAME_PATTERN.exec(task.name)?.[1]) ?? Number.MAX_SAFE_INTEGER;
}

export const TicketNumberUtil = { ticketNumberOf, reviewedTicketNumberOf, reviewRoundNamedBy } as const;

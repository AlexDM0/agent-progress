/**
 * A review bar filed before `reviewOf` and its round were stored gets both from its `Review <N> #<id>` name, and a stored `reviewOf` is
 * padded, once, at ingestion.
 */
import type { Task }              from '../../lib/tracker-model/@types/Task.ts';
import { FIRST_REVIEW_BAR_ROUND } from '../../lib/tracker-model/constants/ReviewRounds.ts';
import { TicketIdUtil }           from '../../lib/tracker-model/utils/TicketIdUtil.ts';

/** Only the prefix is read, and a bundle's first id is its parent: `Review 1 #13, #5 — …` reviews #13. */
const LEGACY_REVIEW_BAR_NAME_PATTERN = /^Review (\d+) #(\d+)/;

function roundNamedBy(roundText: string): number | null {
  const round = Number(roundText);
  return Number.isSafeInteger(round) && round >= FIRST_REVIEW_BAR_ROUND ? round : null;
}

/** The page reads a stored `reviewOf` as `Number(text)`, so `3`, `0003` and `+3` name ticket 003; anything else stays as written. */
function paddedReviewOf(reviewOf: string): string {
  const ticketNumber = Number(reviewOf);
  if (reviewOf.trim() === '' || !Number.isSafeInteger(ticketNumber) || ticketNumber < 1) return reviewOf;
  return TicketIdUtil.padTicketId(ticketNumber);
}

/** A ticket's own row is never a review bar, as the page reads it, so only a free-standing row is linked. */
function linkedReviewBarOf(task: Readonly<Task>): Task {
  if (task.ticket !== null) return task;
  const storedReviewOf           = task.reviewOf === undefined ? undefined : paddedReviewOf(task.reviewOf);
  const withPaddedReviewOf: Task = storedReviewOf === undefined || storedReviewOf === task.reviewOf ? task : { ...task, reviewOf: storedReviewOf };
  const nameMatch                = LEGACY_REVIEW_BAR_NAME_PATTERN.exec(withPaddedReviewOf.name);
  if (nameMatch === null) return withPaddedReviewOf;
  const [, roundText = '', ticketNumberText = ''] = nameMatch;

  const reviewOf = withPaddedReviewOf.reviewOf ?? TicketIdUtil.parseTicketReference(ticketNumberText);
  if (reviewOf === null) return withPaddedReviewOf;
  const reviewBarRound = withPaddedReviewOf.reviewBarRound ?? roundNamedBy(roundText);

  return {
    ...withPaddedReviewOf,
    ...(withPaddedReviewOf.reviewOf === undefined ? { reviewOf } : {}),
    ...(withPaddedReviewOf.reviewBarRound === undefined && reviewBarRound !== null ? { reviewBarRound } : {}),
  };
}

export const LegacyReviewBarUtil = { linkedReviewBarOf } as const;

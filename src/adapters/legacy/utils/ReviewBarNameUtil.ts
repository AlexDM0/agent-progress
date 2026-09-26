/**
 * Reads a free-standing row known only by its `Review <N> #<id>` name, and a stored `reviewOf` left unpadded, from before `reviewOf` and
 * `reviewBarRound` were stored. It can be deleted once every tracker has been rewritten by `agent-progress update`.
 */
import { FIRST_REVIEW_BAR_ROUND } from '../../../lib/tracker-model/constants/ReviewRounds.ts';
import { TicketIdUtil }           from '../../../lib/tracker-model/utils/TicketIdUtil.ts';

/** The fields a stored row and a model row share, which are all the linking reads and writes. */
interface ReviewBarFields {
  name:            string;
  ticket:          string | null;
  reviewOf?:       string;
  reviewBarRound?: number;
}

/** Only the prefix is read, and a bundle's first id is its parent: `Review 1 #13, #5 — …` reviews #13. */
const REVIEW_BAR_NAME_PATTERN = /^Review (\d+) #(\d+)/;

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
function linkedReviewBarOf<Row extends ReviewBarFields>(task: Readonly<Row>): Row {
  if (task.ticket !== null) return task;
  const storedReviewOf          = task.reviewOf === undefined ? undefined : paddedReviewOf(task.reviewOf);
  const withPaddedReviewOf: Row = storedReviewOf === undefined || storedReviewOf === task.reviewOf ? task : { ...task, reviewOf: storedReviewOf };
  const nameMatch                = REVIEW_BAR_NAME_PATTERN.exec(withPaddedReviewOf.name);
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

/** Defensive on a row not yet validated: one whose linking fields have the wrong type is left to validation to name. */
function reviewBarIsUnlinked(taskRecord: Record<string, unknown>): boolean {
  const {
    name, ticket, reviewOf, reviewBarRound 
  } = taskRecord;
  if (ticket !== null || typeof name !== 'string') return false;
  if (reviewOf !== undefined && typeof reviewOf !== 'string') return false;
  if (reviewBarRound !== undefined && typeof reviewBarRound !== 'number') return false;

  const row: ReviewBarFields = {
    name,
    ticket,
    ...(reviewOf === undefined ? {} : { reviewOf }),
    ...(reviewBarRound === undefined ? {} : { reviewBarRound }),
  };
  const linked = linkedReviewBarOf(row);
  return linked.reviewOf !== row.reviewOf || linked.reviewBarRound !== row.reviewBarRound;
}

export const ReviewBarNameUtil = { linkedReviewBarOf, reviewBarIsUnlinked } as const;

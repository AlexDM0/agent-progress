/**
 * Gives a review row filed or renamed to a `Review <N> #<id>` name alone, without `--review-of`, the link its name names, so the row is
 * stored linked by `task add` and `task update --name`. It can go once agents always pass `--review-of`, which the brief asks for.
 */
import type { TaskAddition } from '../../../src/lib/tracker-model/@types/BoardChanges';
import type { Task }         from '../../../src/lib/tracker-model/@types/Task';
import { ReviewBarNameUtil } from '../../../src/shared/legacy/utils/ReviewBarNameUtil';

type NamedReviewBarFields = Pick<Task, 'name' | 'ticket' | 'reviewOf' | 'reviewBarRound'>;

/** A name naming a ticket but no round, such as `Review 0 #7`, links nothing here and is left to the read-time linking. */
function reviewLinkNamedBy(name: string): TaskAddition['reviewOf'] {
  const freeStandingRow: NamedReviewBarFields = { name, ticket: null };
  const { reviewOf, reviewBarRound }          = ReviewBarNameUtil.linkedReviewBarOf(freeStandingRow);
  return reviewOf === undefined || reviewBarRound === undefined ? undefined : { ticketId: reviewOf, round: reviewBarRound };
}

export const ReviewBarNameFilingUtil = { reviewLinkNamedBy } as const;

/**
 * Gives a review row filed or renamed to a `Review <N> #<id>` name alone, without `--review-of`, the link its name names, so the row is
 * stored linked by `task add` and `task update --name`, and moves or drops that link when a rename changes the name it came from. It can go
 * once agents always pass `--review-of`, which the brief asks for, and takes with it the `reviewOf` and `relinkedReviewOf` of the Board's
 * `TaskCorrection`, which only it fills.
 */
import type { ReviewBarLink, TaskAddition } from '../../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { Task }                        from '../../../src/lib/tracker-model/@types/Task.ts';
import { ReviewBarNameUtil }                from '../../../src/shared/legacy/utils/ReviewBarNameUtil.ts';

type NamedReviewBarFields = Pick<Task, 'name' | 'ticket' | 'reviewOf' | 'reviewBarRound'>;

/** A name naming a ticket but no round, such as `Review 0 #7`, links nothing here and is left to the read-time linking. */
function reviewLinkNamedBy(name: string): TaskAddition['reviewOf'] {
  const freeStandingRow: NamedReviewBarFields = { name, ticket: null };
  const { reviewOf, reviewBarRound }          = ReviewBarNameUtil.linkedReviewBarOf(freeStandingRow);
  return reviewOf === undefined || reviewBarRound === undefined ? undefined : { ticketId: reviewOf, round: reviewBarRound };
}

/**
 * A link equal to what the row's previous name gave came from that name, so it follows the rename: relinked to the new name's ticket, or
 * dropped. `undefined` leaves the link untouched.
 */
function reviewLinkAfterRenaming(row: Readonly<NamedReviewBarFields>, newName: string): ReviewBarLink | null | undefined {
  const linkOfThePreviousName       = reviewLinkNamedBy(row.name);
  const linkCameFromThePreviousName = row.ticket === null && linkOfThePreviousName !== undefined
    && row.reviewOf === linkOfThePreviousName.ticketId && row.reviewBarRound === linkOfThePreviousName.round;
  if (!linkCameFromThePreviousName) return undefined;
  return reviewLinkNamedBy(newName) ?? null;
}

export const ReviewBarNameFilingUtil = { reviewLinkNamedBy, reviewLinkAfterRenaming } as const;

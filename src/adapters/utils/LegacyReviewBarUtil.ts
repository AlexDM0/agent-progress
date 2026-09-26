/** A review bar filed before `reviewOf` and its round were stored gets both from its `Review <N> #<id>` name, once, at ingestion. */
import type { Task }              from '../../lib/tracker-model/@types/Task.ts';
import { FIRST_REVIEW_BAR_ROUND } from '../../lib/tracker-model/constants/ReviewRounds.ts';
import { TicketIdUtil }           from '../../lib/tracker-model/utils/TicketIdUtil.ts';

/** Only the prefix is read, and a bundle's first id is its parent: `Review 1 #13, #5 — …` reviews #13. */
const LEGACY_REVIEW_BAR_NAME_PATTERN = /^Review (\d+) #(\d+)/;

function roundNamedBy(roundText: string): number | null {
  const round = Number(roundText);
  return Number.isSafeInteger(round) && round >= FIRST_REVIEW_BAR_ROUND ? round : null;
}

/** A ticket's own row is never a review bar, as the page and the hook read it, so only a free-standing row is linked. */
function linkedReviewBarOf(task: Readonly<Task>): Task {
  if (task.ticket !== null) return task;
  const nameMatch = LEGACY_REVIEW_BAR_NAME_PATTERN.exec(task.name);
  if (nameMatch === null) return task;
  const [, roundText = '', ticketNumberText = ''] = nameMatch;

  const reviewOf = task.reviewOf ?? TicketIdUtil.parseTicketReference(ticketNumberText);
  if (reviewOf === null) return task;
  const reviewBarRound = task.reviewBarRound ?? roundNamedBy(roundText);

  return {
    ...task,
    ...(task.reviewOf === undefined ? { reviewOf } : {}),
    ...(task.reviewBarRound === undefined && reviewBarRound !== null ? { reviewBarRound } : {}),
  };
}

export const LegacyReviewBarUtil = { linkedReviewBarOf } as const;

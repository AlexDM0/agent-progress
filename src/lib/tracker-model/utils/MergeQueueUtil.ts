/** The merge queue's order on one target and the group refresh's trigger, pure: the git predictions arrive as facts. */
import type { TicketPriority } from '../@types/Ticket.ts';

const PRIORITY_RANK: Readonly<Record<TicketPriority, number>> = { high: 0, normal: 1, low: 2 };

export type MergeForecast = 'clean' | 'conflicting' | 'prediction-failed';

export interface MergeQueueCandidate {
  ticketId:          string;
  priority:          TicketPriority;
  /** A failed prediction orders as conflicting. */
  againstTarget:     MergeForecast;
  /** Where its `merge-queued` record stands in the log: its readiness. */
  queuedLogPosition: number;
}

/** Two candidates' ticket ids whose branches are predicted to conflict with each other, in either order. */
export type PairwiseConflict = readonly [string, string];

export interface GroupRefreshFacts {
  /** `git rev-list --count group..main`; `null` when git could not count, which alone never makes a refresh due. */
  mainCommitsAheadOfGroup:        number | null;
  groupTipAgainstMain:            MergeForecast;
  releaseTicketIsQueuedOrSlotted: boolean;
}

export interface GroupRefreshLimits {
  GROUP_REFRESH_AFTER_MAIN_COMMITS: number;
}

function isClean(candidate: MergeQueueCandidate): boolean {
  return candidate.againstTarget === 'clean';
}

/** The other candidates, clean against the target now, whose merge this one's would conflict with. */
function conflictsCausedBy(candidate: MergeQueueCandidate, candidates: readonly MergeQueueCandidate[], pairwiseConflicts: readonly PairwiseConflict[]): number {
  const conflictingTicketIds = new Set(pairwiseConflicts.flatMap(([first, second]) => {
    if (first === candidate.ticketId) return [second];
    if (second === candidate.ticketId) return [first];
    return [];
  }));
  return candidates.filter((other) => other.ticketId !== candidate.ticketId && isClean(other) && conflictingTicketIds.has(other.ticketId)).length;
}

/** Priority rank, clean before conflicting, fewest conflicts caused, readiness, ticket id: a lower priority never orders before a higher. */
function orderOf<Candidate extends MergeQueueCandidate>(candidates: readonly Candidate[], pairwiseConflicts: readonly PairwiseConflict[]): Candidate[] {
  const causedConflicts = new Map(candidates.map((candidate) => [candidate.ticketId, conflictsCausedBy(candidate, candidates, pairwiseConflicts)]));
  const conflictsOf     = (candidate: Candidate): number => causedConflicts.get(candidate.ticketId) ?? 0;
  const cleanRankOf     = (candidate: Candidate): number => (isClean(candidate) ? 0 : 1);
  return [...candidates].sort((a, b) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || cleanRankOf(a) - cleanRankOf(b)
    || conflictsOf(a) - conflictsOf(b)
    || a.queuedLogPosition - b.queuedLogPosition
    || a.ticketId.localeCompare(b.ticketId, 'en', { numeric: true }));
}

/** Never once the release ticket is queued or slotted, so a refresh and a release never merge main at the same time. */
function groupRefreshIsDue(facts: GroupRefreshFacts, limits: GroupRefreshLimits): boolean {
  if (facts.releaseTicketIsQueuedOrSlotted) return false;
  const mainIsFarAhead = facts.mainCommitsAheadOfGroup !== null && facts.mainCommitsAheadOfGroup >= limits.GROUP_REFRESH_AFTER_MAIN_COMMITS;
  return mainIsFarAhead || facts.groupTipAgainstMain !== 'clean';
}

export const MergeQueueUtil = {
  orderOf,
  conflictsCausedBy,
  groupRefreshIsDue,
} as const;

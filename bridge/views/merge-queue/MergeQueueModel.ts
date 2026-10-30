/**
 * The Merge queue detail's model: per target, the Airlock holder and its phase, the waiting candidates in the five-key order the Overseer
 * computed, git's predicted conflicts, and why its landings wait (an open `target-moved` decision, the `dirty-main-checkout` notice). It
 * orders nothing itself: the order arrives as a fact.
 */
import type { MergeQueueDocument, MergeTargetDocument, NoticeDocument } from '../../@types/BoardStateDocument.ts';

export const FIVE_KEY_ORDER_TEXT = 'Ordered by priority, clean before conflicting, fewest conflicts caused, readiness, then ticket id.';

const PHASE_LABELS: Readonly<Record<string, string>> = {
  'merge-in':             'merging in',
  'resolving':            'resolving',
  'reviewing-resolution': 'reviewing the resolution',
  'gating':               'gating',
  'fixing':               'fixing the gate',
  'landing':              'landing',
};

export interface MergeQueueLine {
  readonly position:     number;
  readonly ticketId:     string;
  readonly priority:     string;
  readonly forecast:     MergeTargetDocument['order'][number]['againstTarget'];
  readonly forecastText: string;
  readonly causesText:   string | null;
}

export interface MergeQueueTarget {
  readonly target:         string;
  readonly holderText:     string;
  readonly phase:          string | null;
  readonly lines:          readonly MergeQueueLine[];
  readonly pairwiseTexts:  readonly string[];
  readonly waitingReasons: readonly string[];
}

function forecastTextOf(entry: MergeTargetDocument['order'][number]): string {
  if (entry.againstTarget === 'clean') return 'clean';
  if (entry.againstTarget === 'prediction-failed') return 'prediction failed';
  const files = entry.conflictedFiles ?? [];
  return files.length === 0 ? 'conflicting' : `conflicts in ${files.join(', ')}`;
}

function holderTextOf(holder: MergeTargetDocument['holder']): string {
  if (holder === null) return 'Airlock free';
  const tickets = holder.ticketIds.map((ticketId) => `#${ticketId}`).join(', ');
  return `${holder.jobId}${tickets === '' ? '' : ` for ${tickets}`} holds the Airlock: ${PHASE_LABELS[holder.phase] ?? holder.phase}`;
}

function dirtyCheckoutReasonOf(notice: NoticeDocument): string {
  const blockingFiles = Array.isArray(notice['blockingFiles']) ? notice['blockingFiles'].map(String) : [];
  const branch = typeof notice['branch'] === 'string' ? notice['branch'] : 'no branch';
  return blockingFiles.length === 0
    ? `landings wait: the main checkout is on ${branch}`
    : `landings wait: the main checkout's changes to ${blockingFiles.join(', ')} block the fast-forward`;
}

function dirtyCheckoutNoticesOf(notices: readonly NoticeDocument[]): NoticeDocument[] {
  return notices.filter((notice) => notice.kind === 'dirty-main-checkout' && typeof notice['target'] === 'string');
}

function targetOf(facts: MergeTargetDocument, notices: readonly NoticeDocument[]): MergeQueueTarget {
  return {
    target:     facts.target,
    holderText: holderTextOf(facts.holder),
    phase:      facts.holder?.phase ?? null,
    lines:      facts.order.map((entry, index) => ({
      position:     index + 1,
      ticketId:     entry.ticketId,
      priority:     entry.priority,
      forecast:     entry.againstTarget,
      forecastText: forecastTextOf(entry),
      causesText:   entry.conflictsCaused === 0 ? null : `would conflict with ${entry.conflictsCaused} clean ${entry.conflictsCaused === 1 ? 'candidate' : 'candidates'}`,
    })),
    pairwiseTexts:  facts.pairwiseConflicts.map(([first, second]) => `#${first} and #${second} conflict with each other`),
    waitingReasons: [
      ...facts.targetMovedDecisionIds.map((decisionId) => `landings wait on the target-moved decision ${decisionId}`),
      ...dirtyCheckoutNoticesOf(notices).filter((notice) => notice['target'] === facts.target).map(dirtyCheckoutReasonOf),
    ],
  };
}

/** Every target the Overseer reported, plus one a `dirty-main-checkout` notice names that has nothing queued. */
function mergeQueueModelOf(mergeQueue: MergeQueueDocument | undefined, notices: readonly NoticeDocument[]): MergeQueueTarget[] {
  const reported = mergeQueue?.targets ?? [];
  const noticeOnly = dirtyCheckoutNoticesOf(notices)
    .map((notice) => String(notice['target']))
    .filter((target, index, targets) => targets.indexOf(target) === index && !reported.some((facts) => facts.target === target))
    .map((target): MergeTargetDocument => ({
      target, holder: null, order: [], pairwiseConflicts: [], targetMovedDecisionIds: []
    }));
  return [...reported, ...noticeOnly].map((facts) => targetOf(facts, notices));
}

export const MergeQueueModel = Object.freeze({ mergeQueueModelOf, forecastTextOf });

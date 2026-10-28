/**
 * The words a recorded review pass is made of: its verdict, each claim's result, and each finding's class, severity, evidence and
 * outcome. `review record` refuses a findings file using any other, the stored log check reads the same lists, and the dispatcher's
 * reviewer reply schema takes the class and severity lists, so the reply and the record agree.
 */

export const REVIEW_VERDICTS = ['released', 'round-requested', 'does-not-hold', 'not-released', 'integrated'] as const;

/** `waiver-proposed`: the reviewer finds the item no longer required and only User can waive it. */
export const REVIEW_CLAIM_RESULTS = ['holds', 'does-not-hold', 'waived', 'waiver-proposed'] as const;

export const REVIEW_FINDING_CLASSES = [
  'correctness',
  'acceptance-gap',
  'test-gap',
  'handoff-claim-false',
  'convention',
  'docs',
  'rebase',
  'out-of-scope',
] as const;

export const REVIEW_FINDING_SEVERITIES = ['would-ship-a-bug', 'acceptance-fails', 'quality', 'nit'] as const;

export const REVIEW_FINDING_EVIDENCE_KINDS = ['watched-fail', 'probe', 'reading'] as const;

export const REVIEW_FINDING_OUTCOMES = ['fixed', 'filed'] as const;

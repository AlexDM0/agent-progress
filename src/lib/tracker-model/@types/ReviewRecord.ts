import type {
  REVIEW_CLAIM_RESULTS,
  REVIEW_FINDING_CLASSES,
  REVIEW_FINDING_EVIDENCE_KINDS,
  REVIEW_FINDING_SEVERITIES,
  REVIEW_VERDICTS
} from '../constants/ReviewRecordVocabulary.ts';

export type ReviewVerdict = typeof REVIEW_VERDICTS[number];

export type ReviewClaimResult = typeof REVIEW_CLAIM_RESULTS[number];

export type ReviewFindingClass = typeof REVIEW_FINDING_CLASSES[number];

export type ReviewFindingSeverity = typeof REVIEW_FINDING_SEVERITIES[number];

export type ReviewFindingEvidence = typeof REVIEW_FINDING_EVIDENCE_KINDS[number];

/** One Fails-review claim or Acceptance item; `handoffContradicted` is true when the reviewer's own measurement disagreed with the Handoff. */
export interface ReviewClaim {
  item:                string;
  result:              ReviewClaimResult;
  handoffContradicted: boolean;
}

interface ReviewFindingDescription {
  class:    ReviewFindingClass;
  severity: ReviewFindingSeverity;
  file:     string;
  summary:  string;
  evidence: ReviewFindingEvidence;
}

/** A finding the reviewer fixed names its commit; one it handed on names the ticket it filed. */
export type ReviewFinding =
  | ReviewFindingDescription & { outcome: 'fixed'; commit: string }
  | ReviewFindingDescription & { outcome: 'filed'; filedTicketId: string };

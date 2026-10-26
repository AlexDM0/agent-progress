/**
 * The check and the copy of a recorded review's verdict, claims and findings, shared by the stored log's validation and by `review record`
 * reading its findings file, so the file a reviewer writes is refused by exactly the rules a stored line is read back with.
 */
import { JsonRecordUtil }                  from '../../../lib/json-record/JsonRecordUtil.ts';
import type { ReviewClaim, ReviewFinding } from '../../../lib/tracker-model/@types/ReviewRecord.ts';
import {
  REVIEW_CLAIM_RESULTS,
  REVIEW_FINDING_CLASSES,
  REVIEW_FINDING_EVIDENCE_KINDS,
  REVIEW_FINDING_OUTCOMES,
  REVIEW_FINDING_SEVERITIES,
  REVIEW_VERDICTS
}                               from '../../../lib/tracker-model/constants/ReviewRecordVocabulary.ts';

type UnknownObject = Record<string, unknown>;

function wordProblem(value: unknown, path: string, words: readonly string[]): string | null {
  if (typeof value === 'string' && words.includes(value)) return null;
  return `${path} is ${JSON.stringify(value)}, which is not one of ${words.join(', ')}`;
}

function textProblem(value: unknown, path: string): string | null {
  return typeof value === 'string' && value.trim() !== '' ? null : `${path} is not a text that is not blank`;
}

function firstProblem(checks: readonly (() => string | null)[]): string | null {
  for (const check of checks) {
    const problem = check();
    if (problem !== null) return problem;
  }
  return null;
}

function listProblem(value: unknown, path: string, entryProblem: (entry: UnknownObject, entryPath: string) => string | null): string | null {
  if (!Array.isArray(value)) return `${path} is not a list`;
  for (const [index, entry] of (value as unknown[]).entries()) {
    const entryPath = `${path}[${index}]`;
    if (!JsonRecordUtil.valueIsAPlainObject(entry)) return `${entryPath} is not an object`;
    const problem = entryProblem(entry, entryPath);
    if (problem !== null) return problem;
  }
  return null;
}

function claimProblem(claim: UnknownObject, path: string): string | null {
  return firstProblem([
    () => textProblem(claim['item'], `${path}.item`),
    () => wordProblem(claim['result'], `${path}.result`, REVIEW_CLAIM_RESULTS),
    () => (typeof claim['handoffContradicted'] === 'boolean' ? null : `${path}.handoffContradicted is not true or false`),
  ]);
}

function findingOutcomeProblem(finding: UnknownObject, path: string): string | null {
  const outcomeProblem = wordProblem(finding['outcome'], `${path}.outcome`, REVIEW_FINDING_OUTCOMES);
  if (outcomeProblem !== null) return outcomeProblem;
  return finding['outcome'] === 'fixed' ? textProblem(finding['commit'], `${path}.commit`) : textProblem(finding['filedTicketId'], `${path}.filedTicketId`);
}

function findingProblem(finding: UnknownObject, path: string): string | null {
  return firstProblem([
    () => wordProblem(finding['class'], `${path}.class`, REVIEW_FINDING_CLASSES),
    () => wordProblem(finding['severity'], `${path}.severity`, REVIEW_FINDING_SEVERITIES),
    () => textProblem(finding['file'], `${path}.file`),
    () => textProblem(finding['summary'], `${path}.summary`),
    () => wordProblem(finding['evidence'], `${path}.evidence`, REVIEW_FINDING_EVIDENCE_KINDS),
    () => findingOutcomeProblem(finding, path),
  ]);
}

function verdictProblem(value: unknown, path: string): string | null {
  return wordProblem(value, path, REVIEW_VERDICTS);
}

function claimsProblem(value: unknown, path: string): string | null {
  return listProblem(value, path, claimProblem);
}

function findingsProblem(value: unknown, path: string): string | null {
  return listProblem(value, path, findingProblem);
}

/** `claims` is a value `claimsProblem` passed; only the known keys are kept, in stored order. */
function claimsCopyOf(claims: unknown): ReviewClaim[] {
  return (claims as readonly ReviewClaim[]).map((claim) => ({ item: claim.item, result: claim.result, handoffContradicted: claim.handoffContradicted }));
}

/** `findings` is a value `findingsProblem` passed; only the known keys are kept, in stored order. */
function findingsCopyOf(findings: unknown): ReviewFinding[] {
  return (findings as readonly ReviewFinding[]).map((finding) => {
    const description = {
      class:    finding.class,
      severity: finding.severity,
      file:     finding.file,
      summary:  finding.summary,
      evidence: finding.evidence,
    };
    return finding.outcome === 'fixed'
      ? { ...description, outcome: finding.outcome, commit: finding.commit }
      : { ...description, outcome: finding.outcome, filedTicketId: finding.filedTicketId };
  });
}

export const ReviewRecordFieldsUtil = {
  verdictProblem,
  claimsProblem,
  findingsProblem,
  claimsCopyOf,
  findingsCopyOf,
} as const;

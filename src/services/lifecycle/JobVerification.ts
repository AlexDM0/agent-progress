/**
 * Verification by code of what a session left (design section 5.1, V1 to V11): nothing it says is taken as true, so each check reads git,
 * the ticket body and the report itself, and answers a wordless verdict. A role runs only the checks its column of the table names.
 */
import { BUILDER_REPORT_SCHEMA, RESOLVER_REPORT_SCHEMA, REVIEWER_REPORT_SCHEMA } from '../../adapters/reports/ReportSchemas.ts';
import { reportVerdictOf, type JsonSchema }                                      from '../../adapters/reports/ReportValidation.ts';
import { TicketAcceptanceUtil }                                                  from '../../adapters/tickets/utils/TicketAcceptanceUtil.ts';
import { GitProcess }                                                            from '../../lib/git/GitProcess.ts';
import { TicketBodyHashUtil }                                                    from '../../lib/tracker-model/utils/TicketBodyHashUtil.ts';
import { PRODUCT_NAMES }                                                         from '../../shared/constants/ProductNames.ts';

/** A fixer is a builder one attempt on, and is verified as one. */
export type VerifiedRole = 'builder' | 'reviewer' | 'resolver' | 'merge-fix' | 'resolution-review';

export type VerificationCheck = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11';

export type VerificationRefusalReason =
  | 'report-invalid'
  | 'head-not-reported'
  | 'history-rewritten'
  | 'no-commit-since-start'
  | 'worktree-dirty'
  | 'data-folder-touched'
  | 'ticket-body-changed'
  | 'ai-attribution-in-range'
  | 'acceptance-without-evidence'
  | 'fixed-finding-outside-range'
  | 'merge-unresolved'
  | 'checks-definition-changed'
  | 'git-failed';

export interface MergeUnderVerification {
  branchTip:       string;
  targetTip:       string;
  conflictedFiles: readonly string[];
}

export interface JobVerificationSubject {
  role:             VerifiedRole;
  worktreePath:     string;
  /** The worktree's HEAD at launch, the branch tip with `MERGE_HEAD` at the target tip for a resolver, the merged commit after it. */
  startCommit:      string;
  /** The report as parsed from the session's structured output, unvalidated. */
  report:           unknown;
  ticketBody:       string;
  bodyHashAtLaunch: string;
  /** V10's merge, for a resolver, merge-fix or resolution-review job. */
  merge?:           MergeUnderVerification;
}

/** `facts` name what failed: paths, commits or labels, never words. */
export type CheckVerdict = { verdict: 'passed' } | { verdict: 'refused'; reason: VerificationRefusalReason; facts: readonly string[] };

export type JobVerificationVerdict = { verdict: 'verified' } | { verdict: 'refused'; check: VerificationCheck; reason: VerificationRefusalReason; facts: readonly string[] };

type VerificationCheckRun = (subject: JobVerificationSubject) => CheckVerdict;

const PASSED: CheckVerdict = { verdict: 'passed' };

// The files the checks line resolves through, so a branch changing one changes what its own gate means.
const CHECKS_DEFINITION_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)bun\.lockb?$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)eslint\.config\.[^/]+$/,
  /(^|\/)bunfig\.toml$/,
  /^\.githooks\//,
];

const AI_ATTRIBUTION_PATTERNS: readonly RegExp[] = [/^Co-Authored-By:\s*Claude/im, /Generated with/i];

const REPORT_SCHEMA_OF_ROLE: Readonly<Record<VerifiedRole, JsonSchema>> = {
  'builder':           BUILDER_REPORT_SCHEMA,
  'reviewer':          REVIEWER_REPORT_SCHEMA,
  'resolver':          RESOLVER_REPORT_SCHEMA,
  'merge-fix':         RESOLVER_REPORT_SCHEMA,
  'resolution-review': RESOLVER_REPORT_SCHEMA,
};

function refused(reason: VerificationRefusalReason, facts: readonly string[] = []): CheckVerdict {
  return { verdict: 'refused', reason, facts };
}

function gitLines(directory: string, gitArguments: readonly string[]): string[] | null {
  const run = GitProcess.run(directory, gitArguments);
  if (!GitProcess.succeeded(run)) return null;
  return run.standardOutput.split('\n').filter((line) => line !== '');
}

function rangeOf({ startCommit }: JobVerificationSubject): string {
  return `${startCommit}..HEAD`;
}

/** Each commit's own paths, so a change a later commit undoes still counts, and the range's net diff, which holds a merge's resolution. */
function pathsChangedInRange(subject: JobVerificationSubject): string[] | null {
  const pathsOfEachCommit = gitLines(subject.worktreePath, ['log', '--name-only', '--no-renames', '--format=', rangeOf(subject), '--']);
  const pathsOfTheRange   = gitLines(subject.worktreePath, ['diff', '--name-only', '--no-renames', subject.startCommit, 'HEAD', '--']);
  if (pathsOfEachCommit === null || pathsOfTheRange === null) return null;
  return [...new Set([...pathsOfEachCommit, ...pathsOfTheRange])];
}

function reportFieldOf(report: unknown, field: string): unknown {
  return typeof report === 'object' && report !== null && Object.hasOwn(report, field) ? (report as Record<string, unknown>)[field] : undefined;
}

function reportListOf(report: unknown, field: string): Record<string, unknown>[] {
  const value = reportFieldOf(report, field);
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
}

function reportIsValidWithItsHead(subject: JobVerificationSubject): CheckVerdict {
  const verdict = reportVerdictOf(REPORT_SCHEMA_OF_ROLE[subject.role], subject.report);
  if (verdict.verdict === 'invalid') return refused('report-invalid', verdict.problems);
  const headCommit = GitProcess.resolvedCommitOf(subject.worktreePath, 'HEAD');
  if (headCommit === null) return refused('git-failed', ['HEAD']);
  const reportedHead = String(reportFieldOf(subject.report, 'headCommit'));
  return reportedHead === headCommit ? PASSED : refused('head-not-reported', [reportedHead, headCommit]);
}

function headDescendsFromTheStart(subject: JobVerificationSubject): CheckVerdict {
  const run = GitProcess.run(subject.worktreePath, ['merge-base', '--is-ancestor', subject.startCommit, 'HEAD']);
  return GitProcess.succeeded(run) ? PASSED : refused('history-rewritten', [subject.startCommit]);
}

/** A builder owes a commit only when it reports `built`; a reviewer and a resolution reviewer never do. */
function aCommitSinceTheStart(subject: JobVerificationSubject): CheckVerdict {
  if (subject.role === 'builder' && reportFieldOf(subject.report, 'outcome') !== 'built') return PASSED;
  const commits = gitLines(subject.worktreePath, ['rev-list', rangeOf(subject)]);
  if (commits === null) return refused('git-failed', [rangeOf(subject)]);
  return commits.length > 0 ? PASSED : refused('no-commit-since-start', [subject.startCommit]);
}

function worktreeIsClean(subject: JobVerificationSubject): CheckVerdict {
  const run = GitProcess.run(subject.worktreePath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (!GitProcess.succeeded(run)) return refused('git-failed', ['status']);
  const paths = run.standardOutput.split('\n').filter((line) => line !== '');
  return paths.length === 0 ? PASSED : refused('worktree-dirty', paths);
}

function dataFolderUntouched(subject: JobVerificationSubject): CheckVerdict {
  const paths = pathsChangedInRange(subject);
  if (paths === null) return refused('git-failed', [rangeOf(subject)]);
  const touched = paths.filter((path) => path === PRODUCT_NAMES.DATA_FOLDER || path.startsWith(`${PRODUCT_NAMES.DATA_FOLDER}/`));
  return touched.length === 0 ? PASSED : refused('data-folder-touched', touched);
}

function ticketBodyUnchanged(subject: JobVerificationSubject): CheckVerdict {
  const bodyHash = TicketBodyHashUtil.bodyHashOf(subject.ticketBody);
  return bodyHash === subject.bodyHashAtLaunch ? PASSED : refused('ticket-body-changed', [subject.bodyHashAtLaunch, bodyHash]);
}

function noAiAttributionInRange(subject: JobVerificationSubject): CheckVerdict {
  const commits = gitLines(subject.worktreePath, ['rev-list', rangeOf(subject)]);
  if (commits === null) return refused('git-failed', [rangeOf(subject)]);
  const attributed = commits.filter((commit) => {
    const message = GitProcess.run(subject.worktreePath, ['log', '-1', '--format=%B', commit]);
    return GitProcess.succeeded(message) && AI_ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(message.standardOutput));
  });
  return attributed.length === 0 ? PASSED : refused('ai-attribution-in-range', attributed);
}

/** A builder accounts for each item with evidence or a waiver proposal; a reviewer with a claim. An item the Acceptance waives needs neither. */
function everyAcceptanceItemAccountedFor(subject: JobVerificationSubject): CheckVerdict {
  const labels  = TicketAcceptanceUtil.acceptanceItemsOf(subject.ticketBody).filter(({ waivedReason }) => waivedReason === null).map(({ label }) => label);
  const covered = subject.role === 'reviewer'
    ? reportListOf(subject.report, 'claims').map((claim) => String(claim['item']).trim())
    : reportListOf(subject.report, 'acceptance')
      .filter((entry) => entry['state'] === 'waiver-proposed' || String(entry['evidence'] ?? '').trim() !== '')
      .map((entry) => String(entry['item']).trim());
  const missing = labels.filter((label) => !covered.includes(label));
  return missing.length === 0 ? PASSED : refused('acceptance-without-evidence', missing);
}

function fixedFindingsNameCommitsInRange(subject: JobVerificationSubject): CheckVerdict {
  const commits = gitLines(subject.worktreePath, ['rev-list', rangeOf(subject)]);
  if (commits === null) return refused('git-failed', [rangeOf(subject)]);
  const outside = reportListOf(subject.report, 'findings')
    .filter((finding) => finding['outcome'] === 'fixed')
    .map((finding) => String(finding['commit']))
    .filter((commit) => !commits.includes(commit));
  return outside.length === 0 ? PASSED : refused('fixed-finding-outside-range', outside);
}

/** The merge commit is the first merge in range, or the start itself for a job that began from the merged commit. */
function mergeCommitOf(subject: JobVerificationSubject): string | null {
  const merges = gitLines(subject.worktreePath, ['rev-list', '--merges', '--reverse', rangeOf(subject)]);
  return merges?.[0] ?? subject.startCommit;
}

function mergeIsResolved(subject: JobVerificationSubject): CheckVerdict {
  const { merge, worktreePath } = subject;
  if (merge === undefined) return refused('merge-unresolved', ['no merge']);
  const unmerged = gitLines(worktreePath, ['ls-files', '-u']);
  if (unmerged === null || unmerged.length > 0) return refused('merge-unresolved', unmerged ?? ['ls-files']);
  const mergeCommit = mergeCommitOf(subject);
  if (merge.conflictedFiles.length > 0) {
    const whitespace = GitProcess.run(worktreePath, ['diff', '--check', merge.branchTip, 'HEAD', '--', ...merge.conflictedFiles]);
    if (!GitProcess.succeeded(whitespace)) return refused('merge-unresolved', [...merge.conflictedFiles]);
  }
  const parents = mergeCommit === null ? null : gitLines(worktreePath, ['rev-list', '--parents', '-n', '1', mergeCommit])?.[0]?.split(' ').slice(1);
  const expected = [merge.branchTip, merge.targetTip];
  return JSON.stringify(parents) === JSON.stringify(expected) ? PASSED : refused('merge-unresolved', parents ?? []);
}

function checksDefinitionUnchanged(subject: JobVerificationSubject): CheckVerdict {
  const paths = pathsChangedInRange(subject);
  if (paths === null) return refused('git-failed', [rangeOf(subject)]);
  const changed = paths.filter((path) => CHECKS_DEFINITION_FILE_PATTERNS.some((pattern) => pattern.test(path)) && !subject.ticketBody.includes(path));
  return changed.length === 0 ? PASSED : refused('checks-definition-changed', changed);
}

export const VERIFICATION_CHECKS: Readonly<Record<VerificationCheck, VerificationCheckRun>> = {
  V1:  reportIsValidWithItsHead,
  V2:  headDescendsFromTheStart,
  V3:  aCommitSinceTheStart,
  V4:  worktreeIsClean,
  V5:  dataFolderUntouched,
  V6:  ticketBodyUnchanged,
  V7:  noAiAttributionInRange,
  V8:  everyAcceptanceItemAccountedFor,
  V9:  fixedFindingsNameCommitsInRange,
  V10: mergeIsResolved,
  V11: checksDefinitionUnchanged,
};

/** The design's table, column by column, in check order. */
export const CHECKS_OF_ROLE: Readonly<Record<VerifiedRole, readonly VerificationCheck[]>> = {
  'builder':           ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V11'],
  'reviewer':          ['V1', 'V2', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V11'],
  'resolver':          ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V10', 'V11'],
  'merge-fix':         ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V10', 'V11'],
  'resolution-review': ['V1', 'V2', 'V4', 'V5', 'V6', 'V7', 'V10', 'V11'],
};

/** The first check of the role's column that refuses, so the runner acts on one reason. */
export function verifyJob(subject: JobVerificationSubject): JobVerificationVerdict {
  for (const check of CHECKS_OF_ROLE[subject.role]) {
    const verdict = VERIFICATION_CHECKS[check](subject);
    if (verdict.verdict === 'refused') return {
      verdict: 'refused', check, reason: verdict.reason, facts: verdict.facts
    };
  }
  return { verdict: 'verified' };
}

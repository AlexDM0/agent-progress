/**
 * Verification by code of what a session left (design section 5.1, V1 to V15): nothing it says is taken as true, so each check reads git,
 * the ticket body and the report itself, and answers a wordless verdict. A role runs only the checks its column of the table names.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs';
import {
  isAbsolute,
  join,
  relative,
  resolve
} from 'node:path';

import {
  BUILDER_REPORT_SCHEMA,
  ONBOARDER_REPORT_SCHEMA,
  RESOLVER_REPORT_SCHEMA,
  REVIEWER_REPORT_SCHEMA
} from '../../adapters/reports/ReportSchemas.ts';
import { reportVerdictOf, type JsonSchema } from '../../adapters/reports/ReportValidation.ts';
import { TicketAcceptanceUtil }             from '../../adapters/tickets/utils/TicketAcceptanceUtil.ts';
import { GitProcess }                       from '../../lib/git/GitProcess.ts';
import type { JobOutcome }                  from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }                   from '../../lib/tracker-model/@types/LogRecord.ts';
import type { PipelineGate }                from '../../lib/tracker-model/@types/Pipeline.ts';
import { TicketBodyHashUtil }               from '../../lib/tracker-model/utils/TicketBodyHashUtil.ts';
import { PRODUCT_NAMES }                    from '../../shared/constants/ProductNames.ts';

/** A fixer is a builder one attempt on, and is verified as one. */
export type VerifiedRole = 'builder' | 'reviewer' | 'resolver' | 'merge-fix' | 'resolution-review' | 'onboarder';

export type VerificationCheck = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12' | 'V13' | 'V14' | 'V15' | 'V16';

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
  | 'instruction-file-changed'
  | 'finding-not-filed-by-job'
  | 'branch-touches-agent-config'
  | 'foreign-ref-moved'
  | 'gate-unclaimed'
  | 'head-moved'
  | 'git-failed';

export interface MergeUnderVerification {
  branchTip:       string;
  targetTip:       string;
  conflictedFiles: readonly string[];
}

/** What V13 and V14 compare the job's end with, taken as its session is first launched. */
export interface LaunchSnapshot {
  /** Every ref's commit, and each detached worktree's HEAD keyed `HEAD:<path>`. */
  refs:              Readonly<Record<string, string>>;
  /** The hooks folder's names and contents as one digest; `null` when the folder is missing. */
  hooksFolderDigest: string | null;
}

/** V14's exemptions: refs only the runner or another job moves. */
export interface RefMovesAllowed {
  ownBranch:            string;
  /** The branches of the other jobs on the board, each moved by its own session. */
  otherJobBranches:     readonly string[];
  /** The ticket branches of every job the log launched, which their sessions and merges moved before ending: exempt only while they exist. */
  loggedJobBranches:    readonly string[];
  /** Each landing the runner recorded, as the ref it moved and the commit it moved it to. */
  recordedLandings:     readonly { ref: string; commit: string }[];
  /** The branches the Overseer deletes after a landing, a released group's and each landed ticket's: exempt only once gone. */
  removedAfterLandings: readonly string[];
  /** The Airlock's refresh worktrees' detached HEADs, keyed `HEAD:<path>`: added, merged into and removed by the Overseer alone. */
  refreshWorktreeHeads: readonly string[];
}

/** How the Overseer names the refs around its landings, which the log records only by ticket and target. */
export interface OverseerRefNaming {
  ownBranch:             string;
  otherJobBranches:      readonly string[];
  ticketBranchOf:        (ticketId: string) => string;
  /** The group branch landing this ticket on the main line releases and deletes; `null` for a ticket releasing no group. */
  releasedGroupBranchOf: (ticketId: string) => string | null;
  refreshWorktreeOf:     (groupBranch: string) => string;
}

/** The job endings that move a target's ref: the landings V14 lets pass. */
const LANDING_OUTCOMES: readonly JobOutcome[] = ['landed', 'integrated', 'refreshed'];

export interface JobVerificationSubject {
  role:              VerifiedRole;
  worktreePath:      string;
  /** The worktree's HEAD at launch, the branch tip with `MERGE_HEAD` at the target tip for a resolver, the merged commit after it. */
  startCommit:       string;
  /** The report as parsed from the session's structured output, unvalidated. */
  report:            unknown;
  ticketBody:        string;
  bodyHashAtLaunch:  string;
  /** V10's merge, for a resolver, merge-fix or resolution-review job. */
  merge?:            MergeUnderVerification;
  /** V11 reads each gate's `definedBy`, V15 the gates an agent runs; absent or empty, both pass. */
  gates?:            readonly Readonly<PipelineGate>[];
  /** V11 also: the tracked instruction files the pipeline's arrays name, which a branch changes only where its ticket names them. */
  instructionFiles?: readonly string[];
  /** V12: the job being verified, and the log as stored plus this hold's records. */
  jobId?:            string;
  logRecords?:       readonly LogRecord[];
  /** V13 and V14: what was snapshotted at launch; without it V14 refuses, since nothing proves no ref moved. */
  launchSnapshot?:   LaunchSnapshot;
  refMovesAllowed?:  RefMovesAllowed;
}

/** `facts` name what failed: paths, commits or labels, never words. */
export type CheckVerdict = { verdict: 'passed' } | { verdict: 'refused'; reason: VerificationRefusalReason; facts: readonly string[] };

export type JobVerificationVerdict = { verdict: 'verified' } | { verdict: 'refused'; check: VerificationCheck; reason: VerificationRefusalReason; facts: readonly string[] };

type VerificationCheckRun = (subject: JobVerificationSubject) => CheckVerdict;

const PASSED: CheckVerdict = { verdict: 'passed' };

const AI_ATTRIBUTION_PATTERNS: readonly RegExp[] = [/^Co-Authored-By:\s*Claude/im, /Generated with/i];

const REPORT_SCHEMA_OF_ROLE: Readonly<Record<VerifiedRole, JsonSchema>> = {
  'builder':           BUILDER_REPORT_SCHEMA,
  'reviewer':          REVIEWER_REPORT_SCHEMA,
  'resolver':          RESOLVER_REPORT_SCHEMA,
  'merge-fix':         RESOLVER_REPORT_SCHEMA,
  'resolution-review': RESOLVER_REPORT_SCHEMA,
  'onboarder':         ONBOARDER_REPORT_SCHEMA,
};

function refused(reason: VerificationRefusalReason, facts: readonly string[] = []): CheckVerdict {
  return { verdict: 'refused', reason, facts };
}

function gitLines(directory: string, gitArguments: readonly string[]): string[] | null {
  const run = GitProcess.run(directory, gitArguments);
  if (!GitProcess.succeeded(run)) return null;
  return run.standardOutput.split('\n').filter((line) => line !== '');
}

type RangeSubject = Pick<JobVerificationSubject, 'worktreePath' | 'startCommit' | 'merge'>;

/** A merge job's own commits leave out every commit the target tip holds, so the target's history is never judged as the job's. */
function rangeArgumentsOf({ startCommit, merge }: RangeSubject): string[] {
  return merge === undefined ? [`${startCommit}..HEAD`] : [`${startCommit}..HEAD`, `^${merge.targetTip}`];
}

function rangeOf(subject: RangeSubject): string {
  return rangeArgumentsOf(subject).join(' ');
}

/** `git merge-tree --write-tree` exits 1 when the tree it wrote holds conflicts, which is still the automatic merge. */
const MERGE_TREE_CONFLICTED_EXIT_CODE = 1;

/** What the net diff is read from: git's automatic merge of branch and target when the job made that merge itself, so only its resolution counts. */
function netDiffBaseOf(subject: RangeSubject): string | null {
  const { worktreePath, startCommit, merge } = subject;
  if (merge === undefined) return startCommit;
  const mergesInRange = gitLines(worktreePath, ['rev-list', '--merges', ...rangeArgumentsOf(subject)]);
  if (mergesInRange === null) return null;
  if (mergesInRange.length === 0) return startCommit;
  const automaticMerge = GitProcess.run(worktreePath, ['merge-tree', '--write-tree', '--no-messages', merge.branchTip, merge.targetTip]);
  if (!GitProcess.succeeded(automaticMerge) && automaticMerge?.exitCode !== MERGE_TREE_CONFLICTED_EXIT_CODE) return null;
  const automaticTree = automaticMerge?.standardOutput.split('\n')[0]?.trim() ?? '';
  return automaticTree === '' ? null : automaticTree;
}

/** Each commit's own paths, so a change a later commit undoes still counts, and the range's net diff, which holds a merge's resolution. */
function pathsChangedInRange(subject: RangeSubject): string[] | null {
  const netDiffBase       = netDiffBaseOf(subject);
  const pathsOfEachCommit = gitLines(subject.worktreePath, ['log', '--name-only', '--no-renames', '--format=', ...rangeArgumentsOf(subject), '--']);
  const pathsOfTheRange   = netDiffBase === null ? null : gitLines(subject.worktreePath, ['diff', '--name-only', '--no-renames', netDiffBase, 'HEAD', '--']);
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
  const commits = gitLines(subject.worktreePath, ['rev-list', ...rangeArgumentsOf(subject)]);
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
  const commits = gitLines(subject.worktreePath, ['rev-list', ...rangeArgumentsOf(subject)]);
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
  const commits = gitLines(subject.worktreePath, ['rev-list', ...rangeArgumentsOf(subject)]);
  if (commits === null) return refused('git-failed', [rangeOf(subject)]);
  const outside = reportListOf(subject.report, 'findings')
    .filter((finding) => finding['outcome'] === 'fixed')
    .map((finding) => String(finding['commit']))
    .filter((commit) => !commits.includes(commit));
  return outside.length === 0 ? PASSED : refused('fixed-finding-outside-range', outside);
}

/** The merge commit is the first merge in range, or the start itself for a job that began from the merged commit. */
function mergeCommitOf(subject: JobVerificationSubject): string | null {
  const merges = gitLines(subject.worktreePath, ['rev-list', '--merges', '--reverse', ...rangeArgumentsOf(subject)]);
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

/**
 * A board's pattern as git reads a pathspec glob: `*` and `?` stay inside one folder, `**` crosses any number of them, none included, a trailing
 * `/` takes a folder's whole content, and a pattern without an inner `/` matches its name at any depth.
 */
export function definitionFilePatternExpressionOf(pattern: string): RegExp {
  const namesAFolder = pattern.endsWith('/');
  const body         = pattern.replace(/\/+$/, '');
  const anchored     = body.includes('/');
  const translated   = body.replace(/^\//, '').replace(/\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\]/g, (token) => {
    if (token === '**/') return '(?:.*/)?';
    if (token === '**') return '.*';
    if (token === '*') return '[^/]*';
    if (token === '?') return '[^/]';
    return `\\${token}`;
  });
  return new RegExp(`${anchored ? '^' : '(^|/)'}${translated}${namesAFolder ? '/' : '$'}`);
}

/** With no gate naming a `definedBy` the board names no definition files, so nothing refuses. */
function checksDefinitionUnchanged(subject: JobVerificationSubject): CheckVerdict {
  const patterns = (subject.gates ?? []).flatMap((gate) => gate.definedBy ?? []).map(definitionFilePatternExpressionOf);
  const instructionFiles = subject.instructionFiles ?? [];
  if (patterns.length === 0 && instructionFiles.length === 0) return PASSED;
  const paths = pathsChangedInRange(subject);
  if (paths === null) return refused('git-failed', [rangeOf(subject)]);
  const unnamed = paths.filter((path) => !subject.ticketBody.includes(path));
  const changedDefinitions = unnamed.filter((path) => patterns.some((pattern) => pattern.test(path)));
  if (changedDefinitions.length > 0) return refused('checks-definition-changed', changedDefinitions);
  const changedInstructions = unnamed.filter((path) => instructionFiles.includes(path));
  return changedInstructions.length === 0 ? PASSED : refused('instruction-file-changed', changedInstructions);
}

/** Every gate but an `overseerOnly` one must be claimed on HEAD itself; a claim on any other commit is stale, and an unknown name is ignored. */
function everyAgentGateClaimedOnHead(subject: JobVerificationSubject): CheckVerdict {
  const headCommit = GitProcess.resolvedCommitOf(subject.worktreePath, 'HEAD');
  if (headCommit === null) return refused('git-failed', ['HEAD']);
  const claimedOnHead = reportListOf(subject.report, 'gates').filter((claim) => claim['commit'] === headCommit).map((claim) => String(claim['name']));
  const unclaimed = (subject.gates ?? []).filter((gate) => gate.overseerOnly !== true && !claimedOnHead.includes(gate.name)).map((gate) => gate.name);
  return unclaimed.length === 0 ? PASSED : refused('gate-unclaimed', unclaimed);
}

function ticketNumberOf(ticketReference: string): number {
  return Number(ticketReference.replace(/^#/, ''));
}

/** The ticket a relayed request filed: the nearest `ticket-filed` this job logged before the request's `relay-applied`, in the same application. */
export function ticketIdFiledByRequest(records: readonly LogRecord[], jobId: string, requestId: string): string | null {
  const appliedIndex = records.findIndex((record) => record.kind === 'relay-applied' && record.jobId === jobId && record.fields.requestId === requestId);
  for (let i = appliedIndex - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (record === undefined || record.kind === 'relay-applied') return null;
    if (record.kind === 'ticket-filed' && record.fields.filedByJob === jobId) return record.ticketId;
  }
  return null;
}

/** V12 reads the filing record, never the ticket now: the orchestrator or User may have readied or triaged it since. */
function filingIsThisJobsLowFinding(records: readonly LogRecord[], jobId: string, ticketId: string): boolean {
  return records.some((record) => record.kind === 'ticket-filed'
    && ticketNumberOf(record.ticketId) === ticketNumberOf(ticketId)
    && record.fields.filedByJob === jobId
    && record.fields.status === 'draft'
    && record.fields.priority === 'low'
    && (record.fields.findingRoute === 'orchestrator' || record.fields.findingRoute === 'user'));
}

/** A reviewer's filed findings and an onboarder's optimisations, each a draft low ticket this job filed through its Hatch. */
function filedFindingsWereFiledByThisJob(subject: JobVerificationSubject): CheckVerdict {
  const records = subject.logRecords ?? [];
  const jobId = subject.jobId ?? '';
  const filed = [...reportListOf(subject.report, 'findings').filter((finding) => finding['outcome'] === 'filed'), ...reportListOf(subject.report, 'optimisations')];
  const unproven = filed.flatMap((finding) => {
    const namedTicketId = typeof finding['filedTicketId'] === 'string' ? finding['filedTicketId'] : null;
    const requestId = typeof finding['relayRequestId'] === 'string' ? finding['relayRequestId'] : null;
    const ticketId = namedTicketId ?? (requestId === null ? null : ticketIdFiledByRequest(records, jobId, requestId));
    if (ticketId !== null && filingIsThisJobsLowFinding(records, jobId, ticketId)) return [];
    return [namedTicketId ?? requestId ?? 'unnamed'];
  });
  return unproven.length === 0 ? PASSED : refused('finding-not-filed-by-job', unproven);
}

const AGENT_CONFIG_PATTERNS: readonly RegExp[] = [/^\.claude\//, /^\.mcp\.json$/];

const DEFAULT_HOOKS_FOLDER = 'hooks';

/** `core.hooksPath` read from git, relative paths against the worktree's root; `.git/hooks` of the common folder otherwise. */
function hooksFolderOf(worktreePath: string): string | null {
  // Read with the repository's own setting in force: the hooks-off override would answer `/dev/null`, and reading config runs no hook.
  const configured = GitProcess.run(worktreePath, ['config', '--get', 'core.hooksPath'], 'repository-hooks');
  if (GitProcess.succeeded(configured) && configured.standardOutput.trim() !== '') return resolve(worktreePath, configured.standardOutput.trim());
  const commonFolder = GitProcess.run(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return GitProcess.succeeded(commonFolder) ? join(commonFolder.standardOutput.trim(), DEFAULT_HOOKS_FOLDER) : null;
}

/** The hooks folder as seen from inside the worktree, `null` when it lies outside it, where only the launch digest can tell a change. */
function hooksFolderInsideWorktree(worktreePath: string): string | null {
  const hooksFolder = hooksFolderOf(worktreePath);
  if (hooksFolder === null) return null;
  const relativePath = relative(worktreePath, hooksFolder);
  return relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath) ? null : relativePath;
}

function hooksFolderDigestOf(worktreePath: string): string | null {
  const hooksFolder = hooksFolderOf(worktreePath);
  // `core.hooksPath=/dev/null` turns hooks off: a path that is no folder holds no hook.
  if (hooksFolder === null || !existsSync(hooksFolder) || !statSync(hooksFolder).isDirectory()) return null;
  const digest = createHash('sha256');
  for (const entry of readdirSync(hooksFolder, { recursive: true, withFileTypes: true }).filter((each) => each.isFile())) {
    const filePath = join(entry.parentPath, entry.name);
    digest.update(`${relative(hooksFolder, filePath)}\0`).update(readFileSync(filePath)).update('\0');
  }
  return digest.digest('hex');
}

function isAgentConfigPath(path: string, hooksFolderPath: string | null): boolean {
  if (AGENT_CONFIG_PATTERNS.some((pattern) => pattern.test(path))) return true;
  return hooksFolderPath !== null && (path === hooksFolderPath || path.startsWith(`${hooksFolderPath}/`));
}

/** Every path a commit since `sinceCommit` or the worktree itself changes under `.claude/`, `.mcp.json` or an in-tree hooks folder. */
function agentConfigPathsTouched(worktreePath: string, sinceCommit: string, merge?: MergeUnderVerification): string[] | null {
  const paths = pathsChangedInRange({ worktreePath, startCommit: sinceCommit, ...(merge === undefined ? {} : { merge }) });
  const status = GitProcess.run(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all', '--no-renames']);
  if (paths === null || !GitProcess.succeeded(status)) return null;
  const worktreePaths = status.standardOutput.split('\n').filter((line) => line !== '').map((line) => line.slice('XY '.length));
  const hooksFolderPath = hooksFolderInsideWorktree(worktreePath);
  return [...new Set([...paths, ...worktreePaths])].filter((path) => isAgentConfigPath(path, hooksFolderPath)).sort();
}

function agentConfigUntouched(subject: JobVerificationSubject): CheckVerdict {
  const touched = agentConfigPathsTouched(subject.worktreePath, subject.startCommit, subject.merge);
  if (touched === null) return refused('git-failed', [rangeOf(subject)]);
  const hooksFolderChanged = subject.launchSnapshot !== undefined
    && hooksFolderInsideWorktree(subject.worktreePath) === null
    && hooksFolderDigestOf(subject.worktreePath) !== subject.launchSnapshot.hooksFolderDigest;
  const facts = [...touched, ...(hooksFolderChanged ? [hooksFolderOf(subject.worktreePath) ?? DEFAULT_HOOKS_FOLDER] : [])];
  return facts.length === 0 ? PASSED : refused('branch-touches-agent-config', facts);
}

/** Each ref's commit and each detached worktree's HEAD, read from the repository the worktree belongs to. */
export function launchSnapshotOf(worktreePath: string): LaunchSnapshot | null {
  const refLines = gitLines(worktreePath, ['for-each-ref', '--format=%(refname) %(objectname)']);
  const worktreeLines = gitLines(worktreePath, ['worktree', 'list', '--porcelain']);
  if (refLines === null || worktreeLines === null) return null;
  const refs: Record<string, string> = {};
  for (const line of refLines) {
    const [refName, commit] = line.split(' ');
    if (refName !== undefined && commit !== undefined) refs[refName] = commit;
  }
  let worktree = '';
  let head = '';
  for (const line of worktreeLines) {
    if (line.startsWith('worktree ')) worktree = line.slice('worktree '.length);
    if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length);
    if (line === 'detached') refs[`HEAD:${worktree}`] = head;
  }
  return { refs, hooksFolderDigest: hooksFolderDigestOf(worktreePath) };
}

function onlyOwnRefsMoved(subject: JobVerificationSubject): CheckVerdict {
  const { launchSnapshot, refMovesAllowed } = subject;
  if (launchSnapshot === undefined || refMovesAllowed === undefined) return refused('foreign-ref-moved', ['no launch snapshot']);
  const now = launchSnapshotOf(subject.worktreePath);
  if (now === null) return refused('git-failed', ['for-each-ref']);
  const exempt = new Set([refMovesAllowed.ownBranch, ...refMovesAllowed.otherJobBranches].map((branch) => `refs/heads/${branch}`));
  exempt.add(`HEAD:${subject.worktreePath}`);
  for (const refreshHead of refMovesAllowed.refreshWorktreeHeads) exempt.add(refreshHead);
  const removedAfterLandings = new Set(refMovesAllowed.removedAfterLandings);
  const loggedJobRefs = new Set(refMovesAllowed.loggedJobBranches.map((branch) => `refs/heads/${branch}`));
  const moved = [...new Set([...Object.keys(launchSnapshot.refs), ...Object.keys(now.refs)])].filter((ref) => {
    if (exempt.has(ref)) return false;
    const after = now.refs[ref];
    if (launchSnapshot.refs[ref] === after) return false;
    if (after === undefined && removedAfterLandings.has(ref)) return false;
    if (after !== undefined && loggedJobRefs.has(ref)) return false;
    return !refMovesAllowed.recordedLandings.some((landing) => landing.ref === ref && landing.commit === after);
  });
  return moved.length === 0 ? PASSED : refused('foreign-ref-moved', moved.sort());
}

/** V14's exemptions from the log: each landing on its job's target at its commit, what a main-line landing deletes, and every refresh's worktree. */
export function refMovesAllowedOf(logRecords: readonly LogRecord[], naming: OverseerRefNaming): RefMovesAllowed {
  const launchById = new Map<string, { target: string | null; ticketIds: readonly string[] }>();
  const recordedLandings: { ref: string; commit: string }[] = [];
  const removedAfterLandings: string[] = [];
  const refreshWorktreeHeads: string[] = [];
  const loggedJobBranches = new Set<string>();
  for (const record of logRecords) {
    if (record.kind === 'job-launched') {
      launchById.set(record.jobId, { target: record.fields.target, ticketIds: record.fields.ticketIds });
      for (const ticketId of record.fields.ticketIds) loggedJobBranches.add(naming.ticketBranchOf(ticketId));
      if (record.fields.kind === 'refresh' && record.fields.target !== null) refreshWorktreeHeads.push(`HEAD:${naming.refreshWorktreeOf(record.fields.target)}`);
    }
    if (record.kind !== 'job-ended' || !LANDING_OUTCOMES.includes(record.fields.outcome) || record.fields.commit === undefined) continue;
    const launch = launchById.get(record.jobId);
    if (launch === undefined || launch.target === null) continue;
    recordedLandings.push({ ref: `refs/heads/${launch.target}`, commit: record.fields.commit });
    if (record.fields.outcome !== 'landed') continue;
    for (const ticketId of launch.ticketIds) {
      removedAfterLandings.push(`refs/heads/${naming.ticketBranchOf(ticketId)}`);
      const groupBranch = naming.releasedGroupBranchOf(ticketId);
      if (groupBranch !== null) removedAfterLandings.push(`refs/heads/${groupBranch}`);
    }
  }
  return {
    ownBranch:         naming.ownBranch,
    otherJobBranches:  naming.otherJobBranches,
    loggedJobBranches: [...loggedJobBranches],
    recordedLandings,
    removedAfterLandings,
    refreshWorktreeHeads,
  };
}

/** The onboarder reads a snapshot and changes nothing in it: a commit, even one on top of the start, moved its HEAD. */
function headUnmoved(subject: JobVerificationSubject): CheckVerdict {
  const headCommit = GitProcess.resolvedCommitOf(subject.worktreePath, 'HEAD');
  if (headCommit === null) return refused('git-failed', ['HEAD']);
  return headCommit === subject.startCommit ? PASSED : refused('head-moved', [subject.startCommit, headCommit]);
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
  V12: filedFindingsWereFiledByThisJob,
  V13: agentConfigUntouched,
  V14: onlyOwnRefsMoved,
  V15: everyAgentGateClaimedOnHead,
  V16: headUnmoved,
};

/** The design's table, column by column, in check order. */
export const CHECKS_OF_ROLE: Readonly<Record<VerifiedRole, readonly VerificationCheck[]>> = {
  'builder':           ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V11', 'V13', 'V14', 'V15'],
  'reviewer':          ['V1', 'V2', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V11', 'V12', 'V13', 'V14'],
  'resolver':          ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V10', 'V11', 'V13', 'V14'],
  'merge-fix':         ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V10', 'V11', 'V13', 'V14'],
  'resolution-review': ['V1', 'V2', 'V4', 'V5', 'V6', 'V7', 'V10', 'V11', 'V13', 'V14'],
  'onboarder':         ['V1', 'V16', 'V4', 'V5', 'V12', 'V13', 'V14'],
};

/** V13 before a launch on the branch, resumes included: the branch's own commits past its target, and the worktree as it stands. */
export function agentConfigTouchedBeforeLaunch(worktreePath: string, target: string): CheckVerdict {
  const base = GitProcess.run(worktreePath, ['merge-base', target, 'HEAD']);
  if (!GitProcess.succeeded(base)) return refused('git-failed', [target]);
  const touched = agentConfigPathsTouched(worktreePath, base.standardOutput.trim());
  if (touched === null) return refused('git-failed', [target]);
  return touched.length === 0 ? PASSED : refused('branch-touches-agent-config', touched);
}

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

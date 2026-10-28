/**
 * Verification by code, V1 to V11, on a scratch repository: each check refuses its planted case and passes a clean one, and `verifyJob`
 * runs only the checks of the role's column, stopping at the first refusal. The planted cases are what a session could leave behind and
 * claim otherwise; V5 plants the data folder under the name `PRODUCT_NAMES` gives it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                    from 'bun:test';
import { TicketBodyHashUtil }         from '../../lib/tracker-model/utils/TicketBodyHashUtil.ts';
import { PRODUCT_NAMES }              from '../../shared/constants/ProductNames.ts';
import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory,
  SCRATCH_COMMIT_IDENTITY_ARGUMENTS
}                                    from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import {
  CHECKS_OF_ROLE,
  VERIFICATION_CHECKS,
  verifyJob,
  type JobVerificationSubject,
  type VerificationCheck
} from './JobVerification.ts';

const TICKET_BODY = '## Report\nExample report.\n\n## Acceptance\nA1. The example page loads.\n';

let repositoryDirectory = '';

let startCommit = '';

function headCommit(): string {
  return gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
}

function commitWithMessage(fileName: string, message: string): string {
  writeFileSync(join(repositoryDirectory, fileName), `${message}\n`);
  gitOutputIn(repositoryDirectory, ['add', '--', fileName]);
  gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', message]);
  return headCommit();
}

function builderReport(): Record<string, unknown> {
  return {
    role:              'builder',
    outcome:           'built',
    headCommit:        headCommit(),
    acceptance:        [{ item: 'A1', state: 'met', evidence: 'ExamplePage.spec.ts' }],
    alsoFixed:         [],
    handoff:           'Example handoff.',
    blockedReason:     null,
    cannotBuildReason: null,
  };
}

function reviewerReport(fixedCommit: string): Record<string, unknown> {
  return {
    role:       'reviewer',
    headCommit: headCommit(),
    claims:     [{
      item: 'A1', result: 'holds', handoffContradicted: false, note: ''
    }],
    findings: [{
      class: 'correctness', severity: 'quality', file: 'example.ts', summary: 'Example', evidence: 'watched-fail', outcome: 'fixed', commit: fixedCommit,
    }],
    reviewText: 'Example review.',
  };
}

function builderSubject(overrides: Partial<JobVerificationSubject> = {}): JobVerificationSubject {
  return {
    role:             'builder',
    worktreePath:     repositoryDirectory,
    startCommit,
    report:           builderReport(),
    ticketBody:       TICKET_BODY,
    bodyHashAtLaunch: TicketBodyHashUtil.bodyHashOf(TICKET_BODY),
    ...overrides,
  };
}

function refusalOf(check: VerificationCheck, subject: JobVerificationSubject): string | null {
  const verdict = VERIFICATION_CHECKS[check](subject);
  return verdict.verdict === 'refused' ? verdict.reason : null;
}

/** A target branch with a commit of its own merged into the branch, as a resolver leaves it: the merge's parents are [branch, target]. */
function mergedTarget(): { branchTip: string; targetTip: string } {
  const branchTip = headCommit();
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'example-target', startCommit]);
  const targetTip = commitFile(repositoryDirectory, 'target.ts', 'export const target = true;\n');
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-']);
  gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'merge', '-q', '--no-edit', '--no-ff', 'example-target']);
  return { branchTip, targetTip };
}

function resolverSubject(merge: { branchTip: string; targetTip: string }): JobVerificationSubject {
  return builderSubject({
    role:        'resolver',
    startCommit: merge.branchTip,
    report:      {
      role: 'resolver', outcome: 'resolved', headCommit: headCommit(), resolvedFiles: [], semanticChanges: [], notes: '', reportKind: null,
    },
    merge: { ...merge, conflictedFiles: [] },
  });
}

beforeEach(() => {
  repositoryDirectory = createScratchGitRepository('job-verification');
  startCommit         = commitFile(repositoryDirectory, 'base.ts', 'export const base = true;\n');
  commitFile(repositoryDirectory, 'feature.ts', 'export const feature = true;\n');
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('verification by code', () => {
  test('a clean builder pass passes every check of its column', () => {
    for (const check of CHECKS_OF_ROLE.builder) expect([check, refusalOf(check, builderSubject())]).toEqual([check, null]);
    expect(verifyJob(builderSubject())).toEqual({ verdict: 'verified' });
  });

  test('V1 refuses a report its schema rejects, and one whose headCommit is not HEAD', () => {
    expect(refusalOf('V1', builderSubject({ report: { role: 'builder' } }))).toBe('report-invalid');
    expect(refusalOf('V1', builderSubject({ report: { ...builderReport(), headCommit: startCommit } }))).toBe('head-not-reported');
  });

  test('V2 refuses a HEAD that no longer descends from the start: history was rewritten', () => {
    const rewrittenFrom = headCommit();
    gitOutputIn(repositoryDirectory, ['reset', '-q', '--hard', 'HEAD~1']);

    expect(refusalOf('V2', builderSubject({ startCommit: rewrittenFrom, report: builderReport() }))).toBe('history-rewritten');
  });

  test('V3 refuses a built pass with no commit since the start, and asks nothing of a reviewer', () => {
    expect(refusalOf('V3', builderSubject({ startCommit: headCommit() }))).toBe('no-commit-since-start');
    expect(CHECKS_OF_ROLE.reviewer).not.toContain('V3');
  });

  test('V4 refuses a worktree holding an untracked file', () => {
    writeFileSync(join(repositoryDirectory, 'left-behind.txt'), 'scratch\n');

    expect(refusalOf('V4', builderSubject())).toBe('worktree-dirty');
  });

  test('V5 refuses a commit in range touching the data folder, named from PRODUCT_NAMES', () => {
    mkdirSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER));
    commitFile(repositoryDirectory, `${PRODUCT_NAMES.DATA_FOLDER}/progress.json`, '{}\n');

    const verdict = VERIFICATION_CHECKS.V5(builderSubject({ report: builderReport() }));

    expect(verdict).toEqual({ verdict: 'refused', reason: 'data-folder-touched', facts: [`${PRODUCT_NAMES.DATA_FOLDER}/progress.json`] });
  });

  test('V6 refuses a ticket body edited since launch', () => {
    expect(refusalOf('V6', builderSubject({ ticketBody: `${TICKET_BODY}\nA2. Added mid-job.\n` }))).toBe('ticket-body-changed');
  });

  test('V7 refuses an AI attribution trailer or a "Generated with" line in range', () => {
    commitWithMessage('trailer.ts', 'Add the trailer file\n\nCo-Authored-By: Claude <noreply@example.com>');

    expect(refusalOf('V7', builderSubject({ report: builderReport() }))).toBe('ai-attribution-in-range');
  });

  test('V8 refuses an Acceptance item the builder gave no evidence or waiver proposal for, or the reviewer no claim', () => {
    expect(refusalOf('V8', builderSubject({ report: { ...builderReport(), acceptance: [] } }))).toBe('acceptance-without-evidence');
    expect(refusalOf('V8', builderSubject({ report: { ...builderReport(), acceptance: [{ item: 'A1', state: 'waiver-proposed', evidence: '' }] } }))).toBeNull();
    expect(refusalOf('V8', builderSubject({ role: 'reviewer', report: { ...reviewerReport(headCommit()), claims: [] } }))).toBe('acceptance-without-evidence');
  });

  test('V9 refuses a fixed finding naming a commit outside the range, and passes one inside it', () => {
    const fixCommit = headCommit();

    expect(refusalOf('V9', builderSubject({ role: 'reviewer', report: reviewerReport(startCommit) }))).toBe('fixed-finding-outside-range');
    expect(refusalOf('V9', builderSubject({ role: 'reviewer', report: reviewerReport(fixCommit) }))).toBeNull();
    expect(verifyJob(builderSubject({ role: 'reviewer', report: reviewerReport(fixCommit) }))).toEqual({ verdict: 'verified' });
  });

  test('V10 passes a merge whose parents are [branchTip, targetTip], and refuses one made against another target tip', () => {
    const merge = mergedTarget();

    expect(verifyJob(resolverSubject(merge))).toEqual({ verdict: 'verified' });
    expect(refusalOf('V10', resolverSubject({ ...merge, targetTip: startCommit }))).toBe('merge-unresolved');
  });

  test('V11 refuses a change to a file the checks line resolves through, unless the ticket body names it', () => {
    commitFile(repositoryDirectory, 'package.json', '{ "scripts": { "verify": "true" } }\n');

    expect(refusalOf('V11', builderSubject({ report: builderReport() }))).toBe('checks-definition-changed');
    expect(refusalOf('V11', builderSubject({ report: builderReport(), ticketBody: `${TICKET_BODY}\nScope: package.json\n` }))).toBeNull();
  });

  test('verifyJob stops at the first refusing check of the column and names it', () => {
    writeFileSync(join(repositoryDirectory, 'left-behind.txt'), 'scratch\n');

    expect(verifyJob(builderSubject({ ticketBody: 'changed' }))).toMatchObject({ verdict: 'refused', check: 'V4', reason: 'worktree-dirty' });
  });
});

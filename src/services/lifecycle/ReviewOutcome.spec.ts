/**
 * A verified and gated review pass settled by code on a scratch repository and a Board in memory. What matters: the rework is counted
 * from the review's start, the `## Review <round>` and the record are code's, a pass that changed nothing is committed by code, and each
 * outcome makes its one move: a failed claim back to a fixer, a granted round to a fresh reviewer the policy launches, a refused round to
 * the merge queue with its notice, and a waiver proposal to User, whose grant writes the waived item and whose refusal is a failed pass.
 */

import {
  afterEach,
  beforeEach,
  expect,
  test
} from 'bun:test';
import type { DecisionDraft, DecisionWording } from '../../lib/tracker-model/@types/LifecycleStep.ts';
import type { LogRecord }                      from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }                         from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }                from '../../lib/tracker-model/@types/TrackerProgress.ts';
import { Board }                               from '../../lib/tracker-model/Board.ts';
import { createLogger }                        from '../../lib/tracker-model/Logger.ts';
import { LIFECYCLE_LIMITS }                    from '../../shared/constants/LifecycleLimits.ts';
import {
  commitFile,
  createScratchDirectory,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }              from '../../testing/ToolGuard.ts';
import { ReviewOutcome, type ReviewPassRequest } from './ReviewOutcome.ts';

const AT = '2026-10-28T10:00:00+01:00';
const TICKET_BODY = '## Report\nExample report.\n\n## Acceptance\nA1. The example page loads.\nA2. The example export\n   names every role.\n\n## Brief\nExample brief.\n';
const OVER_THRESHOLD_LINES = LIFECYCLE_LIMITS.REWORK_ROUND_THRESHOLD_LINES + 50;

const WORDING: DecisionWording = {
  questions: [{
    question: 'Waive the proposed items?', header: 'waiver', multiSelect: false, options: []
  }],
  context: '',
};

let repositoryDirectory = '';
let jobFolder = '';
let target = '';
let reviewStartCommit = '';
let logRecords: LogRecord[] = [];
let board: Board;

function headCommit(): string {
  return gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
}

function newBoard(storedLogRecords: readonly LogRecord[] = []): Board {
  const progress: TrackerProgress = {
    trackerId:        'example-review',
    project:          'Example Agency',
    startedAt:        AT,
    view:             { kind: 'auto' },
    nextTaskId:       1,
    concurrencyLimit: 2,
    dispatcherState:  'running',
    tasks:            [],
  };
  const ticket: Ticket = {
    frontmatter: {
      id:          '001',
      title:       'Example review ticket',
      type:        'ticket',
      status:      'in-review',
      filed:       AT,
      updated:     AT,
      started:     AT,
      finished:    AT,
      delivered:   null,
      abandonedAt: null,
      task:        null,
      extra:       [],
    },
    body:     TICKET_BODY,
    filePath: '/example-agency/.agent-progress/tickets/001-example.md',
  };
  return new Board({
    progress,
    tickets:  [ticket],
    epics:    [],
    logger:   createLogger((record) => logRecords.push(record)),
    storedLogRecords,
    pipeline: { prepare: [], gates: [{ name: 'verify', run: 'bun run verify' }], review: { name: 'Review' } },
  });
}

/** A review job of the round, standing in `gating` with its review bar, as the runner leaves it once the gate passed. */
function reviewJobAtRound(round: number): string {
  const launched = board.launchJob({
    kind: 'review', role: 'reviewer', ticketIds: ['001'], parentJobId: null, attempt: round, target
  }, AT);
  const jobId = launched.job.id;
  board.startReviewBar('001', { round, owner: jobId }, AT);
  for (const state of ['preparing', 'running', 'verifying', 'gating'] as const) board.moveJob(jobId, state, AT);
  return jobId;
}

function claim(item: string, result: string, note = ''): Record<string, unknown> {
  return {
    item, result, handoffContradicted: false, note
  };
}

function report(claims: readonly Record<string, unknown>[], findings: readonly Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    role: 'reviewer', headCommit: headCommit(), claims, findings, reviewText: 'Example review by Alex Example.'
  };
}

function settle(jobId: string, reviewerReport: Record<string, unknown>) {
  const job = board.jobById(jobId);
  if (job === undefined) throw new Error(`job ${jobId} is not on the board`);
  const request: ReviewPassRequest = {
    board,
    at:                AT,
    job,
    report:            reviewerReport,
    worktreePath:      repositoryDirectory,
    reviewStartCommit,
    jobFolder,
    limits:            LIFECYCLE_LIMITS,
    decisionWordingOf: (_draft: DecisionDraft) => WORDING,
  };
  return ReviewOutcome.settleReviewPass(request);
}

function commitManyCodeLines(fileName: string): string {
  const lines = Array.from({ length: OVER_THRESHOLD_LINES }, (_unused, i) => `export const exampleValue${i} = ${i};`);
  return commitFile(repositoryDirectory, fileName, `${lines.join('\n')}\n`);
}

function ticketBody(): string {
  return board.tickets()[0]?.body ?? '';
}

function recordsOfKind<Kind extends LogRecord['kind']>(kind: Kind): Extract<LogRecord, { kind: Kind }>[] {
  return logRecords.filter((record): record is Extract<LogRecord, { kind: Kind }> => record.kind === kind);
}

beforeEach(() => {
  repositoryDirectory = createScratchGitRepository('review-outcome');
  jobFolder = createScratchDirectory('review-job');
  commitFile(repositoryDirectory, 'base.ts', 'export const base = true;\n');
  target = currentBranchOf(repositoryDirectory);
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'ticket-001']);
  commitFile(repositoryDirectory, 'feature.ts', 'export const feature = true;\n');
  reviewStartCommit = headCommit();
  logRecords = [];
  board = newBoard();
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
  removeScratchDirectory(jobFolder);
});

describeWhenGitIsPresent('a review pass settled by code', () => {
  test('a pass that changed nothing is committed by code, written as its Review, recorded, and queued to merge on its target', () => {
    const jobId = reviewJobAtRound(1);
    const outcome = settle(jobId, report([claim('A1', 'holds'), claim('A2', 'holds')]));

    expect(outcome.move).toBe('merge-queued');
    expect(gitOutputIn(repositoryDirectory, ['log', '-1', '--format=%s'])).toBe('Review round 1 of #001: no changes');
    expect(outcome.headCommit).toBe(headCommit());
    expect(outcome.reworkedLines).toBe(0);
    expect(ticketBody()).toContain('## Review 1\n\nExample review by Alex Example.\n\n- A1 holds\n- A2 holds\n');
    expect(recordsOfKind('review-recorded').map((record) => record.fields.verdict)).toEqual(['released']);
    expect(board.ticketIsMergeQueued('001')).toBe(true);
    expect(recordsOfKind('merge-queued').map((record) => [record.ticketId, record.fields.target])).toEqual([['001', target]]);
    expect(recordsOfKind('job-ended').map((record) => record.fields.outcome)).toEqual(['reviewed']);
    expect(board.jobs()).toEqual([]);
  });

  test('rework is counted from the review start with code lines only, and a fixed finding and a filed one are recorded as stored', () => {
    const fixCommit = commitFile(repositoryDirectory, 'fix.ts', '// An example comment.\nexport const fixed = true;\n');
    board = newBoard([
      {
        at:       AT,
        kind:     'ticket-filed',
        ticketId: '014',
        fields:   {
          title: 'Example finding', status: 'draft', priority: 'low', filedByJob: 'J1', findingRoute: 'user'
        }
      },
      {
        at: AT, kind: 'relay-applied', jobId: 'J1', fields: { requestId: 'R3', commandKind: 'ticket-add', outcome: 'applied' }
      },
    ]);
    const jobId = reviewJobAtRound(1);
    const finding = {
      class: 'correctness', severity: 'quality', file: 'fix.ts', summary: 'Example', evidence: 'watched-fail'
    };
    const outcome = settle(jobId, report([claim('A1', 'holds'), claim('A2', 'holds')], [
      { ...finding, outcome: 'fixed', commit: fixCommit },
      {
        ...finding, class: 'out-of-scope', outcome: 'filed', filedTicketId: null, relayRequestId: 'R3'
      },
    ]));

    expect(outcome.reworkedLines).toBe(1);
    expect(recordsOfKind('review-recorded')[0]?.fields.findings.map((recorded) => recorded.outcome === 'fixed' ? recorded.commit : recorded.filedTicketId))
      .toEqual([fixCommit, '014']);
    expect(recordsOfKind('review-recorded')[0]?.fields).toMatchObject({ reviewStartCommit, totalReworkedCodeLines: 1, rebaseReworkedCodeLines: 0 });
  });

  test('a claim that does not hold is a failed pass back to a fixer: the job ends does-not-hold and the ticket goes back in progress', () => {
    const jobId = reviewJobAtRound(1);
    expect(settle(jobId, report([claim('A1', 'holds'), claim('A2', 'does-not-hold')])).move).toBe('fixer');
    expect(recordsOfKind('job-ended').map((record) => record.fields.outcome)).toEqual(['does-not-hold']);
    expect(board.tickets()[0]?.frontmatter.status).toBe('in-progress');
    expect(board.ticketIsMergeQueued('001')).toBe(false);
  });

  test('over-threshold rework with a granted round ends round-granted, and the policy launches a fresh reviewer one round on', () => {
    commitManyCodeLines('rework.ts');
    const jobId = reviewJobAtRound(1);
    const outcome = settle(jobId, report([claim('A1', 'holds'), claim('A2', 'holds')]));

    expect(outcome).toMatchObject({ move: 'fresh-reviewer', reworkedLines: OVER_THRESHOLD_LINES });
    expect(recordsOfKind('job-ended').map((record) => record.fields.outcome)).toEqual(['round-granted']);
    const advanced = board.advanceLifecycle({ ...LIFECYCLE_LIMITS, now: AT, usageResetsAt: null }, {
      mainLine:                     target,
      groupTargetPrefix:            'group-',
      installVersionChanged:        false,
      targetsHoldingManagedBlock:   [],
      ticketIdsTouchingAgentConfig: [],
      closedDeliveryTurns:          [],
      budgetSpentDeliveryTurns:     [],
      orchestratorHasAnswered:      false,
      orchestratorBootRetryDue:     false,
    }, () => WORDING);
    expect(advanced.steps.filter((step) => step.kind === 'launch-review')).toEqual([{
      kind: 'launch-review', ticketId: '001', round: 2, target
    }]);
    expect(board.jobs().find((job) => job.kind === 'review')?.id).not.toBe(jobId);
  });

  test('over-threshold rework refused another round for non-convergence passes on to the merge queue and shows rounds-not-converging', () => {
    const findingInANewFile = {
      class: 'correctness', severity: 'quality', file: 'example-new.ts', summary: 'Example', evidence: 'reading', outcome: 'fixed'
    };
    const firstFix = commitFile(repositoryDirectory, 'example-old.ts', 'export const old = true;\n');
    settle(reviewJobAtRound(1), report([claim('A1', 'holds'), claim('A2', 'holds')], [{ ...findingInANewFile, file: 'example-old.ts', commit: firstFix }]));
    board.setTicketMergeQueued('001', false, AT);
    reviewStartCommit = headCommit();
    const secondFix = commitManyCodeLines('example-new.ts');
    const outcome = settle(reviewJobAtRound(2), report([claim('A1', 'holds'), claim('A2', 'holds')], [{ ...findingInANewFile, commit: secondFix }]));

    expect(outcome.move).toBe('merge-queued');
    expect(ReviewOutcome.nonConvergingTicketIdsOf(logRecords, LIFECYCLE_LIMITS)).toEqual(['001']);
  });

  test('a failed pass over the threshold takes no round verdict, so it shows no rounds-not-converging', () => {
    commitManyCodeLines('rework.ts');
    const outcome = settle(reviewJobAtRound(1), report([claim('A1', 'holds'), claim('A2', 'does-not-hold')]));

    expect(outcome).toMatchObject({ move: 'fixer', reworkedLines: OVER_THRESHOLD_LINES });
    expect(ReviewOutcome.nonConvergingTicketIdsOf(logRecords, LIFECYCLE_LIMITS)).toEqual([]);
  });

  test('a waiver proposal opens a waiver decision, keeps the ticket out of the merge queue and holds every launch on it', () => {
    board.setTicketMergeQueued('001', true, AT);
    const jobId = reviewJobAtRound(1);
    expect(settle(jobId, report([claim('A1', 'holds'), claim('A2', 'waiver-proposed', 'The export was retired')])).move).toBe('waiver');

    expect(board.decisions().map((decision) => [decision.kind, decision.ticketIds, decision.jobId])).toEqual([['waiver', ['001'], jobId]]);
    expect(board.ticketIsMergeQueued('001')).toBe(false);
    expect(board.jobById(jobId)?.state).toBe('awaiting-answer');
    board.endJob(jobId, { outcome: 'stopped' }, AT);
    const advanced = board.advanceLifecycle({ ...LIFECYCLE_LIMITS, now: AT, usageResetsAt: null }, {
      mainLine:                     target,
      groupTargetPrefix:            'group-',
      installVersionChanged:        false,
      targetsHoldingManagedBlock:   [],
      ticketIdsTouchingAgentConfig: [],
      closedDeliveryTurns:          [],
      budgetSpentDeliveryTurns:     [],
      orchestratorHasAnswered:      false,
      orchestratorBootRetryDue:     false,
    }, () => WORDING);
    expect(advanced.steps.filter((step) => step.kind === 'launch-review')).toEqual([]);
  });

  test('granting the waiver writes the item waived in the answering hold and queues the ticket to merge', () => {
    const jobId = reviewJobAtRound(1);
    settle(jobId, report([claim('A1', 'holds'), claim('A2', 'waiver-proposed', 'The export was retired')]));
    const [decision] = board.decisions();
    ReviewOutcome.answerWaiver(board, decision?.id ?? '', ['Grant'], jobFolder, AT);

    expect(ticketBody()).toContain('## Acceptance\nA1. The example page loads.\nA2. Waived: The export was retired\n\n## Brief\n');
    expect(board.decisions()).toEqual([]);
    expect(board.ticketIsMergeQueued('001')).toBe(true);
    expect(recordsOfKind('job-ended').map((record) => record.fields.outcome)).toEqual(['reviewed']);
  });

  test('refusing the waiver is a failed pass back to a fixer', () => {
    const jobId = reviewJobAtRound(1);
    settle(jobId, report([claim('A1', 'holds'), claim('A2', 'waiver-proposed', 'The export was retired')]));
    const [decision] = board.decisions();
    ReviewOutcome.answerWaiver(board, decision?.id ?? '', ['Refuse: the export stays'], jobFolder, AT);

    expect(ticketBody()).not.toContain('Waived:');
    expect(recordsOfKind('job-ended').map((record) => [record.fields.outcome, record.fields.cause])).toEqual([['does-not-hold', 'waiver-refused']]);
    expect(board.tickets()[0]?.frontmatter.status).toBe('in-progress');
    expect(board.ticketIsMergeQueued('001')).toBe(false);
  });
});

test('the waived line replaces the item and its continuation lines, leaving the other items as written', () => {
  expect(ReviewOutcome.bodyWithWaivedItems(TICKET_BODY, [{ item: 'A2', reason: 'Example reason' }]))
    .toBe('## Report\nExample report.\n\n## Acceptance\nA1. The example page loads.\nA2. Waived: Example reason\n\n## Brief\nExample brief.\n');
});

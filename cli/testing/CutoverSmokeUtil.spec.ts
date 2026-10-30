/**
 * The cutover smoke's judgement, which the owner reads as pass lines before unholding the release. What matters: the smoke refuses the
 * released program's names and runs only on the opt-in; its log lands in the main checkout's evidence folder; and each item's verdict
 * passes on a log that shows the item and fails, naming what is missing, on one that does not, so a pass line is never vacuous.
 */
import { describe, expect, test } from 'bun:test';

import { ORIGINAL_PRODUCT_NAMES, SIDE_BY_SIDE_PRODUCT_NAMES } from '../../src/shared/constants/ProductNames.ts';
import {
  CutoverSmokeUtil,
  type RegroupingObservation,
  type SmokeLogRecord,
  type SmokeStreamedEvent
} from './CutoverSmokeUtil.ts';

const at = (second: number): string => `2026-10-30T10:00:${String(second).padStart(2, '0')}+01:00`;

function record(second: number, kind: string, subject: Partial<SmokeLogRecord>, fields: Record<string, unknown> = {}): SmokeLogRecord {
  return {
    at: at(second), kind, ...subject, fields
  };
}

const DELIVERED_BOARD: SmokeLogRecord[] = [
  record(1, 'ticket-readied', { ticketId: '001' }),
  record(1, 'ticket-readied', { ticketId: '002' }),
  record(2, 'job-launched', { jobId: 'J2' }, {
    kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null
  }),
  record(2, 'job-launched', { jobId: 'J3' }, {
    kind: 'build', role: 'builder', ticketIds: ['002'], parentJobId: null
  }),
  record(3, 'decision-opened', { decisionId: 'D1' }, { kind: 'agent-question', ticketIds: ['001'] }),
  record(4, 'incident-opened', { incidentId: 'I1' }, { kind: 'malformed-ticket', ticketIds: ['002'] }),
  record(5, 'decision-answered', { decisionId: 'D1' }, { answer: {} }),
  record(6, 'incident-answered', { incidentId: 'I1' }, { answer: {} }),
  record(7, 'ticket-finished', { ticketId: '001' }),
  record(7, 'ticket-finished', { ticketId: '002' }),
  record(8, 'job-launched', { jobId: 'J4' }, {
    kind: 'review', role: 'reviewer', ticketIds: ['001'], parentJobId: null
  }),
  record(8, 'job-launched', { jobId: 'J5' }, {
    kind: 'review', role: 'reviewer', ticketIds: ['002'], parentJobId: null
  }),
  record(9, 'gate-ran', {}, { tree: 'a', outcome: 'passed', cached: false }),
  record(9, 'gate-ran', {}, { tree: 'b', outcome: 'passed', cached: false }),
  record(10, 'merge-started', { jobId: 'J6' }, { target: 'main', predictedConflictFiles: [] }),
  record(11, 'merge-landed', { jobId: 'J6' }, { target: 'main', kind: 'landed' }),
  record(11, 'job-ended', { jobId: 'J6' }, { outcome: 'landed' }),
  record(11, 'ticket-delivered', { ticketId: '001' }),
  record(12, 'merge-started', { jobId: 'J7' }, { target: 'main', predictedConflictFiles: ['palette.txt'] }),
  record(13, 'job-launched', { jobId: 'J8' }, {
    kind: 'merge-agent', role: 'resolver', ticketIds: ['002'], parentJobId: 'J7'
  }),
  record(14, 'job-ended', { jobId: 'J8' }, { outcome: 'resolved' }),
  record(15, 'gate-ran', {}, { tree: 'c', outcome: 'passed', cached: false }),
  record(16, 'merge-landed', { jobId: 'J7' }, { target: 'main', kind: 'landed' }),
  record(16, 'job-ended', { jobId: 'J7' }, { outcome: 'landed' }),
  record(16, 'ticket-delivered', { ticketId: '002' }),
];

const PLANTS = { agentQuestionTicketId: '001', malformedTicketTicketId: '002' };

describe('whether the smoke may run', () => {
  test('the released program\'s names are refused, whatever the opt-in', () => {
    expect(CutoverSmokeUtil.refusalOf(ORIGINAL_PRODUCT_NAMES, true)).toContain('PROGRAM is agent-progress');
  });

  test('a side-by-side PROGRAM sharing the released monitor folder is refused', () => {
    expect(CutoverSmokeUtil.refusalOf({ ...SIDE_BY_SIDE_PRODUCT_NAMES, MONITOR_FOLDER: ORIGINAL_PRODUCT_NAMES.MONITOR_FOLDER }, true)).toContain('monitor or data folder');
  });

  test('the side-by-side names run only with the real-claude opt-in', () => {
    expect(CutoverSmokeUtil.refusalOf(SIDE_BY_SIDE_PRODUCT_NAMES, false)).toContain('--with-real-claude');
    expect(CutoverSmokeUtil.refusalOf(SIDE_BY_SIDE_PRODUCT_NAMES, true)).toBeNull();
  });

  test('the log goes under the main checkout\'s .claude/.evidence/cutover-smoke/', () => {
    expect(CutoverSmokeUtil.evidenceFolderOf('/example/checkout')).toBe('/example/checkout/.claude/.evidence/cutover-smoke');
  });
});

describe('item 1: delivery', () => {
  test('passes when both tickets were built, reviewed, landed in order and gated three times', () => {
    expect(CutoverSmokeUtil.deliveryVerdictOf(DELIVERED_BOARD, ['001', '002']).passed).toBe(true);
  });

  test('fails naming an undelivered ticket and a second merge holding the target before the first ended', () => {
    const overlapping = DELIVERED_BOARD.filter((entry) => !(entry.kind === 'ticket-delivered' && entry.ticketId === '002')
      && !(entry.kind === 'job-ended' && entry.jobId === 'J6'));
    const verdict = CutoverSmokeUtil.deliveryVerdictOf(overlapping, ['001', '002']);
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain('#002 was not delivered');
    expect(verdict.detail).toContain('two merges held one target at once');
  });

  test('fails on fewer than three passed gate runs', () => {
    const verdict = CutoverSmokeUtil.deliveryVerdictOf(DELIVERED_BOARD.filter((entry) => entry.kind !== 'gate-ran'), ['001', '002']);
    expect(verdict.detail).toContain('0 passed gate runs');
  });
});

describe('item 2: regrouping', () => {
  const kept: RegroupingObservation = {
    jobId:                              'J2',
    watcherInstanceBeforeKill:          1,
    watcherInstanceAfterRegrouping:     1,
    watcherInstanceAfterRestart:        1,
    watcherProcessAliveAfterRegrouping: true,
    watcherProcessAliveAfterRestart:    true,
    restartExitCode:                    0,
    buildJobsOnTheTicketAfterKill:      0,
  };

  test('passes when the Watcher lived through the kill and the Baton pass on one instance', () => {
    expect(CutoverSmokeUtil.regroupingVerdictOf(kept).passed).toBe(true);
  });

  test('fails on a second Watcher instance or a second build job', () => {
    const verdict = CutoverSmokeUtil.regroupingVerdictOf({ ...kept, watcherInstanceAfterRegrouping: 2, buildJobsOnTheTicketAfterKill: 1 });
    expect(verdict.passed).toBe(false);
    expect(verdict.detail).toContain('watcher instance 2');
    expect(verdict.detail).toContain('1 more build jobs');
  });
});

describe('item 3: the planted conflict', () => {
  test('passes when a resolver resolved a merge that then landed', () => {
    expect(CutoverSmokeUtil.conflictVerdictOf(DELIVERED_BOARD).detail).toBe('resolver J8 resolved merge J7, which landed');
  });

  test('fails when the resolved merge never landed', () => {
    expect(CutoverSmokeUtil.conflictVerdictOf(DELIVERED_BOARD.filter((entry) => !(entry.kind === 'merge-landed' && entry.jobId === 'J7'))).passed).toBe(false);
  });
});

describe('item 4: the planted questions', () => {
  test('passes on an answered decision whose ticket finished after it and an answered malformed-ticket incident', () => {
    expect(CutoverSmokeUtil.questionVerdictOf(DELIVERED_BOARD, PLANTS).passed).toBe(true);
  });

  test('an escalation counts as the Assistant handling the incident', () => {
    const escalated = DELIVERED_BOARD.map((entry) => (entry.kind === 'incident-answered' ? { ...entry, kind: 'incident-escalated' } : entry));
    expect(CutoverSmokeUtil.questionVerdictOf(escalated, PLANTS).detail).toContain('escalated by the Assistant');
  });

  test('fails naming an unanswered decision and an incident nobody handled', () => {
    const unanswered = DELIVERED_BOARD.filter((entry) => entry.kind !== 'decision-answered' && entry.kind !== 'incident-answered');
    const verdict = CutoverSmokeUtil.questionVerdictOf(unanswered, PLANTS);
    expect(verdict.detail).toContain('decision D1 was never answered');
    expect(verdict.detail).toContain('incident I1 was neither answered nor escalated');
  });
});

describe('item 5: the event stream', () => {
  const boardEvent = (tickets: { id: string; status: string }[]): SmokeStreamedEvent => ({ kind: 'board', receivedAt: at(1), data: { tickets } });
  const jobEvent = (id: string, state: string): SmokeStreamedEvent => ({ kind: 'job', receivedAt: at(1), data: { id, state } });
  const everyMove = [
    boardEvent([{ id: '001', status: 'pending' }, { id: '002', status: 'pending' }]),
    boardEvent([{ id: '001', status: 'in-review' }, { id: '002', status: 'in-review' }]),
    boardEvent([{ id: '001', status: 'delivered' }, { id: '002', status: 'delivered' }]),
    ...['J2', 'J3', 'J4', 'J5', 'J8'].map((jobId) => jobEvent(jobId, 'running')),
  ];

  test('passes when every move logged since the stream opened showed in a board event and every launched job in a job event', () => {
    expect(CutoverSmokeUtil.eventVerdictOf(DELIVERED_BOARD, everyMove, at(0)).passed).toBe(true);
  });

  test('fails naming the unseen move and the unpublished job', () => {
    const verdict = CutoverSmokeUtil.eventVerdictOf(DELIVERED_BOARD, everyMove.filter((event) => event.data['id'] !== 'J8').slice(1), at(0));
    expect(verdict.detail).toContain('#001 pending');
    expect(verdict.detail).toContain('no job event for J8');
  });

  test('a move overtaken in its own stamp, and a record logged while no Overseer served the stream, are not asked of it', () => {
    const approvedThenDelivered = [...DELIVERED_BOARD, record(11, 'ticket-approved', { ticketId: '001' }), record(11, 'ticket-delivered', { ticketId: '001' })];
    expect(CutoverSmokeUtil.eventVerdictOf(approvedThenDelivered, everyMove, at(0)).passed).toBe(true);
    const withoutJ8 = everyMove.filter((event) => event.data['id'] !== 'J8');
    expect(CutoverSmokeUtil.eventVerdictOf(DELIVERED_BOARD, withoutJ8, at(0)).passed).toBe(false);
    expect(CutoverSmokeUtil.eventVerdictOf(DELIVERED_BOARD, withoutJ8, at(0), [{ from: at(13), to: at(13) }]).passed).toBe(true);
  });

  test('a move logged before the stream opened is not asked of it', () => {
    expect(CutoverSmokeUtil.eventVerdictOf(DELIVERED_BOARD, everyMove.slice(1), at(5)).passed).toBe(true);
  });
});

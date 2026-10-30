/**
 * The Airlock moves and the repair moves applied through the control service to a Board as a hold carries it (design sections 6.3 and
 * 8.3). What matters: `merge land` is legal only under `resolution-over-threshold` and only with a passing `gate-ran` record for the tree
 * the incident names (`merge-gate-not-passed` otherwise), never under `merge-gate-failed`; `merge fixer` sets the slot fixing and `merge
 * abort` parks the ticket under the incident's kind; a move naming no incident takes its subject's one open incident that allows it, a
 * `merge-*` move with none is refused `no-open-incident` while `gate retry` and `worktree repair` apply as plain controls; and `recreate`
 * and `unlock` are refused while a job is on the ticket.
 */
import { describe, expect, test } from 'bun:test';

import type { IncidentKind }                            from '../../lib/tracker-model/@types/Incident.ts';
import type { AirlockPhase }                            from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                                   from '../../lib/tracker-model/Board.ts';
import type { ControlCommand }                          from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }                             from '../../shared/OperationRefusal.ts';
import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { TrackerChange }                           from '../tracker/TrackerPipeline.ts';
import { ControlService }                               from './ControlService.ts';

const AT = '2026-10-28T10:00:00+01:00';

const MERGED_TREE = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function changeOf(board: Board): TrackerChange {
  // The Airlock appliers read only the Board and the stamp of the hold; no repair here reaches git.
  return { board, at: AT, workspace: { rootDirectory: '/example-agency/storefront', trackerDirectory: '/example-agency/storefront/.agent-progress' } } as unknown as TrackerChange;
}

function apply(board: Board, command: ControlCommand): { logged: { kind: string; fields?: unknown }[] } {
  return ControlService.apply(command, changeOf(board)).result as unknown as { logged: { kind: string }[] };
}

function mergeBoard(phase: AirlockPhase, incidentKind: IncidentKind | null): Board {
  const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-review' })] });
  const { job } = board.launchJob({
    kind: 'merge', role: null, ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main'
  }, AT);
  board.setJobSlot(job.id, {
    target: 'main', targetTip: 'f'.repeat(40), branchTip: 'e'.repeat(40), phase
  });
  if (incidentKind !== null) {
    board.openIncident({
      kind: incidentKind, ticketIds: ['001'], jobId: job.id, facts: { tree: MERGED_TREE }, defaultMove: incidentKind === 'merge-gate-failed' ? 'merge-abort' : 'merge-review'
    }, AT);
  }
  return board;
}

function roleRefusalOf(run: () => unknown): unknown {
  try {
    run();
  } catch (refusal) {
    if (refusal instanceof OperationRefusal) return refusal.detail;
    throw refusal;
  }
  throw new Error('The move was not refused.');
}

describe('merge land', () => {
  test('lands a resolution over the threshold once a gate-ran record passed its merged tree: the slot moves to landing', () => {
    const board = mergeBoard('reviewing-resolution', 'resolution-over-threshold');
    board.recordGateRan({ tree: MERGED_TREE, outcome: 'passed', cached: false }, AT);
    const result = apply(board, { kind: 'merge-land', jobId: 'J1', incidentId: 'I1' });

    expect(result.logged.map((record) => record.kind)).toEqual(['incident-handled']);
    expect(board.jobById('J1')?.airlock?.phase).toBe('landing');
    expect(board.incidents()).toEqual([]);
  });

  test('is refused merge-gate-not-passed while no gate passed the merged tree, a failed one included', () => {
    const board = mergeBoard('reviewing-resolution', 'resolution-over-threshold');
    board.recordGateRan({ tree: MERGED_TREE, outcome: 'failed', cached: false }, AT);

    expect(refusalDetailOf(() => apply(board, { kind: 'merge-land', jobId: 'J1', incidentId: 'I1' }))).toMatchObject({ reason: 'merge-gate-not-passed', tree: MERGED_TREE });
    expect(board.jobById('J1')?.airlock?.phase).toBe('reviewing-resolution');
  });

  test('is never legal under merge-gate-failed, even with a passing stamp: landing a failed tree would be a waiver', () => {
    const board = mergeBoard('gating', 'merge-gate-failed');
    board.recordGateRan({ tree: MERGED_TREE, outcome: 'passed', cached: false }, AT);

    expect(roleRefusalOf(() => apply(board, { kind: 'merge-land', jobId: 'J1', incidentId: 'I1' }))).toMatchObject({ reason: 'incident-move-not-allowed' });
  });
});

describe('merge fixer, review and abort', () => {
  test('fixer sets the slot fixing and handles the merge-gate-failed incident, so the Airlock launches its fixer', () => {
    const board = mergeBoard('gating', 'merge-gate-failed');
    apply(board, { kind: 'merge-fixer', jobId: 'J1', incidentId: 'I1' });

    expect(board.jobById('J1')?.airlock?.phase).toBe('fixing');
    expect(board.incidents()).toEqual([]);
  });

  test('review handles the incident and leaves the slot reviewing the resolution', () => {
    const board = mergeBoard('reviewing-resolution', 'resolution-over-threshold');
    const result = apply(board, { kind: 'merge-review', jobId: 'J1', incidentId: 'I1' });

    expect(result.logged).toMatchObject([{ kind: 'incident-handled', fields: { move: 'merge-review' } }]);
    expect(board.jobById('J1')?.airlock?.phase).toBe('reviewing-resolution');
  });

  test('abort parks the ticket parked:<kind> with a parked decision, so the Airlock aborts the merge of a parked ticket', () => {
    const board = mergeBoard('gating', 'merge-gate-failed');
    const result = apply(board, { kind: 'merge-abort', jobId: 'J1', incidentId: 'I1' });

    expect(result.logged[0]).toMatchObject({ kind: 'incident-handled', fields: { move: 'merge-abort' } });
    expect(board.tickets()[0]?.frontmatter.hold).toBe('parked:merge-gate-failed');
    expect(board.decisions().map((decision) => decision.kind)).toEqual(['parked']);
  });
});

describe('a move naming no incident', () => {
  test('a merge move takes the job\'s one open incident that allows it', () => {
    const board = mergeBoard('gating', 'merge-gate-failed');
    apply(board, { kind: 'merge-fixer', jobId: 'J1' });

    expect(board.jobById('J1')?.airlock?.phase).toBe('fixing');
    expect(board.incidents()).toEqual([]);
  });

  test('a merge move with none is refused no-open-incident, and so is one whose incident does not allow it', () => {
    expect(refusalDetailOf(() => apply(mergeBoard('gating', null), { kind: 'merge-abort', jobId: 'J1' }))).toMatchObject({ reason: 'no-open-incident', subject: 'J1' });
    expect(refusalDetailOf(() => apply(mergeBoard('gating', 'merge-gate-failed'), { kind: 'merge-review', jobId: 'J1' }))).toMatchObject({ reason: 'no-open-incident' });
  });

  test('gate retry with none applies as a plain control with nothing to do; with one it handles the gate-cannot-run incident', () => {
    expect(ControlService.apply({ kind: 'gate-retry', jobId: 'J1' }, changeOf(mergeBoard('gating', null))).outcome).toBe('nothing-to-do');
    const board = mergeBoard('gating', 'gate-cannot-run');
    expect(apply(board, { kind: 'gate-retry', jobId: 'J1' }).logged).toMatchObject([{ kind: 'incident-handled', fields: { move: 'gate-retry' } }]);
  });

  test('worktree repair with none applies as a plain control and logs worktree-repaired', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress' })] });
    expect(apply(board, { kind: 'worktree-repair', ticketReference: '1', step: 'reinstall' }).logged).toMatchObject([
      { kind: 'worktree-repaired', fields: { step: 'reinstall', patchPath: null } },
    ]);
  });

  test('a named incident of another job is refused incident-move-not-allowed', () => {
    const board = mergeBoard('gating', 'merge-gate-failed');
    board.launchJob({
      kind: 'merge', role: null, ticketIds: ['001'], parentJobId: null, attempt: 2, target: 'main'
    }, AT);
    expect(roleRefusalOf(() => apply(board, { kind: 'merge-fixer', jobId: 'J2', incidentId: 'I1' }))).toMatchObject({ reason: 'incident-move-not-allowed' });
  });
});

describe('worktree repair while a job is on the ticket', () => {
  test.each(['recreate', 'unlock'] as const)('%s is refused worktree-in-use, naming the job', (step) => {
    const board = mergeBoard('gating', null);
    expect(refusalDetailOf(() => apply(board, { kind: 'worktree-repair', ticketReference: '1', step }))).toMatchObject({ reason: 'worktree-in-use', jobIds: ['J1'] });
  });
});

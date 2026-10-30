/**
 * The Airlock agents an incident's move or default lets a slot launch (design section 6.3): one merge-gate fixer after `merge fixer`, and a
 * resolution reviewer after `merge review` or its default. What matters: each launches once, as a `merge-agent` of its own role under the
 * merge job, its incident's facts kept for its prompt; a fixer whose tree stays red is resumed in its own session twice, and the next red aborts and parks
 * `merge-gate-failed` with no new incident; a reviewer whose claims do not hold aborts and parks `merge-resolution-rejected`; a resolved
 * report gates the merged tree again and lands; and each agent at its own call budget refuses the merge.
 */
import { afterEach, expect, test } from 'bun:test';

import { commitFile }               from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import {
  createAirlocksHarness,
  finishMergeAgent,
  HARNESS_AT,
  type AirlocksHarness,
  resolveAs
}                                   from './testing/AirlocksHarness.ts';

let harness: AirlocksHarness | null = null;

afterEach(() => {
  harness?.remove();
  harness = null;
});

function settleIncidentBy(current: AirlocksHarness, move: 'merge-fixer' | 'merge-review'): void {
  const [incident] = current.board.incidents();
  const mergeJob = current.mergeJob();
  if (incident === undefined || mergeJob?.slot === undefined) throw new Error('No Airlock incident is open.');
  if (move === 'merge-fixer') current.board.setJobSlot(mergeJob.id, { ...mergeJob.slot, phase: 'fixing' });
  current.board.handleIncident(incident.id, move, HARNESS_AT);
}

async function failedMergedGate(): Promise<AirlocksHarness> {
  const current = createAirlocksHarness([{ id: '001', change: ['checkout.ts', 'export const checkout = 1;\n'] }]);
  current.settings.gateOutcome = 'failed';
  await current.slots.sweep();
  settleIncidentBy(current, 'merge-fixer');
  await current.slots.sweep();
  return current;
}

async function resolutionOverThreshold(): Promise<AirlocksHarness> {
  const current = createAirlocksHarness([{ id: '001', change: ['base.ts', 'export const base = 2;\n'] }], { RESOLUTION_REVIEW_THRESHOLD_LINES: 6 });
  commitFile(current.repository, 'base.ts', 'export const base = 3;\n');
  await current.slots.sweep();
  resolveAs(current, '001', 'base.ts', 'export const base = 4;\nexport const extra = 5;\n');
  await current.slots.sweep();
  settleIncidentBy(current, 'merge-review');
  await current.slots.sweep();
  return current;
}

describeWhenGitIsPresent('the merge-gate fixer', () => {
  test('launches once under the merge job after merge fixer, with the failed gate\'s tail kept for its prompt', async () => {
    harness = await failedMergedGate();

    expect(harness.mergeAgent()).toMatchObject({ role: 'merge-fix', parentJobId: harness.mergeJob()?.id, attempt: 1 });
    expect(harness.keptAirlockFacts.get(harness.mergeJob()?.id ?? '')?.['gateTail']).toContain('expected 2, received 3');
    expect(harness.mergeJob()?.slot?.phase).toBe('fixing');
  });

  test('a fix whose merged tree stays red resumes the same fixer twice, handed the failure, opening no incident', async () => {
    harness = await failedMergedGate();
    const fixerId = harness.mergeAgent()?.id;
    for (let resume = 1; resume <= 2; resume += 1) {
      commitFile(harness.worktreeOf('001'), 'checkout.ts', `export const checkout = ${resume + 1};\n`);
      finishMergeAgent(harness, {
        outcome: 'resolved', resolvedFiles: ['checkout.ts'], notes: '', reportKind: null
      });
      await harness.slots.sweep();

      expect(harness.mergeAgent()).toMatchObject({ id: fixerId, state: 'interrupted', interruption: 'handoff-red' });
      expect(harness.mergeJob()?.slot?.phase).toBe('fixing');
      expect(harness.board.incidents()).toEqual([]);
    }
  });

  test('a third red merged tree after two fixer resumes aborts the merge and parks merge-gate-failed, opening no new incident', async () => {
    harness = await failedMergedGate();
    const mainTip = harness.tipOf('main');
    for (let pass = 1; pass <= 3; pass += 1) {
      commitFile(harness.worktreeOf('001'), 'checkout.ts', `export const checkout = ${pass + 1};\n`);
      finishMergeAgent(harness, {
        outcome: 'resolved', resolvedFiles: ['checkout.ts'], notes: '', reportKind: null
      });
      await harness.slots.sweep();
    }

    expect(harness.mergeAgent()).toBeUndefined();
    expect(harness.gatedTrees).toHaveLength(4);
    expect(harness.board.incidents()).toEqual([]);
    expect(harness.board.tickets()[0]?.frontmatter.hold).toBe('parked:merge-gate-failed');
    expect(harness.board.airlockHolderOf('main')).toBeUndefined();
    expect(harness.tipOf('main')).toBe(mainTip);
  });

  test('a fix whose merged tree then passes is gated again and lands', async () => {
    harness = await failedMergedGate();
    commitFile(harness.worktreeOf('001'), 'checkout.ts', 'export const checkout = 2;\n');
    harness.settings.gateOutcome = 'passed';
    finishMergeAgent(harness, {
      outcome: 'resolved', resolvedFiles: ['checkout.ts'], notes: '', reportKind: null
    });
    await harness.slots.sweep();

    expect(harness.board.tickets()[0]?.frontmatter.status).toBe('delivered');
  });

  test('at MERGE_FIXER_API_CALL_BUDGET it is stopped and the merge refused', async () => {
    harness = await failedMergedGate();
    const agent = harness.mergeAgent();
    if (agent === undefined) throw new Error('No fixer was launched.');
    harness.board.moveJob(agent.id, 'running', HARNESS_AT);
    harness.settings.reading = { calls: 75, report: undefined };
    await harness.slots.sweep();

    expect(harness.stopped).toEqual([agent.id]);
    expect(harness.board.decisions().map((decision) => decision.kind)).toEqual(['merge-refused']);
    expect(harness.board.airlockHolderOf('main')).toBeUndefined();
  });
});

describeWhenGitIsPresent('the resolution reviewer', () => {
  test('launches once under the merge job after merge review, the merge commit kept for its prompt', async () => {
    harness = await resolutionOverThreshold();

    expect(harness.mergeAgent()).toMatchObject({ role: 'resolution-review', parentJobId: harness.mergeJob()?.id });
    expect(harness.keptAirlockFacts.get(harness.mergeJob()?.id ?? '')?.['mergeCommit']).toMatch(/^[0-9a-f]{40}$/);
  });

  test('claims that do not hold abort the merge and park merge-resolution-rejected', async () => {
    harness = await resolutionOverThreshold();
    const mainTip = harness.tipOf('main');
    finishMergeAgent(harness, { outcome: 'cannot-resolve', notes: 'Example: the extra export drops the base value.', reportKind: null });
    await harness.slots.sweep();

    expect(harness.board.tickets()[0]?.frontmatter.hold).toBe('parked:merge-resolution-rejected');
    expect(harness.board.decisions().map((decision) => [decision.kind, decision.context])).toEqual([['parked', 'Example: the extra export drops the base value.']]);
    expect(harness.board.airlockHolderOf('main')).toBeUndefined();
    expect(harness.tipOf('main')).toBe(mainTip);
  });

  test('a reportKind refuses the merge and opens its incident instead of rejecting the resolution', async () => {
    harness = await resolutionOverThreshold();
    finishMergeAgent(harness, { outcome: 'cannot-resolve', notes: 'Example: the Brief contradicts itself.', reportKind: 'malformed-ticket' });
    await harness.slots.sweep();

    expect(harness.board.decisions().map((decision) => decision.kind)).toEqual(['merge-refused']);
    expect(harness.board.incidents().map((incident) => [incident.kind, incident.jobId])).toEqual([['malformed-ticket', null]]);
    expect(harness.board.tickets()[0]?.frontmatter.hold).toBeUndefined();
  });

  test('claims that hold gate the merged tree and land it', async () => {
    harness = await resolutionOverThreshold();
    finishMergeAgent(harness, { outcome: 'resolved', notes: '', reportKind: null });
    await harness.slots.sweep();

    expect(harness.board.tickets()[0]?.frontmatter.status).toBe('delivered');
  });
});

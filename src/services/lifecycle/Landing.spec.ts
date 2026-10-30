/**
 * Landing on a scratch repository. What matters: the target's tip is compared with the one the merge was made against before anything
 * moves, so a moved target never lands; main lands by a fast-forward in the main checkout and a group branch by `merge --ff-only` in its
 * worktree; a crash's half-landed commit reads as already landed; and every refusal maps to a typed outcome.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                    from 'bun:test';
import { ticketFixture }   from '../../testing/BoardFixtures.ts';
import {
  addWorktree,
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
}                                    from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                                 from '../../testing/ToolGuard.ts';
import { Landing, LANDING_OUTCOME_OF_REFUSAL, type LandingRequest } from './Landing.ts';

let repositoryDirectory = '';

let mainTip = '';

let mergedCommit = '';

function tipOf(branch: string): string {
  return gitOutputIn(repositoryDirectory, ['rev-parse', `refs/heads/${branch}`]);
}

function mainLanding(overrides: Partial<LandingRequest> = {}): LandingRequest {
  return {
    target:            { branch: 'main', directory: repositoryDirectory },
    mergedCommit,
    expectedTargetTip: mainTip,
    recordedLandings:  [],
    hookPolicy:        'hooks-off',
    ...overrides,
  };
}

beforeEach(() => {
  repositoryDirectory = createScratchGitRepository('landing');
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-B', 'main']);
  mainTip      = commitFile(repositoryDirectory, 'base.ts', 'export const base = true;\n');
  mergedCommit = commitFile(addWorktree(repositoryDirectory, 'feature'), 'feature.ts', 'export const feature = true;\n');
});

afterEach(() => {
  removeScratchDirectory(`${repositoryDirectory}-worktrees`);
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('landing a gated commit', () => {
  test('main at the expected tip is fast-forwarded to exactly the merged commit, the previous tip recorded', () => {
    expect(Landing.landOnTarget(mainLanding())).toEqual({ verdict: 'landed', commit: mergedCommit, previousTip: mainTip });
    expect(tipOf('main')).toBe(mergedCommit);
  });

  test('a group branch lands by merge --ff-only in the worktree it is checked out in', () => {
    const groupWorktree = join(`${repositoryDirectory}-worktrees`, 'group-example');
    gitOutputIn(repositoryDirectory, ['worktree', 'add', '-q', '-b', 'group-example', groupWorktree, 'main']);

    const landing = Landing.landOnTarget(mainLanding({ target: { branch: 'group-example', directory: groupWorktree } }));

    expect(landing).toEqual({ verdict: 'landed', commit: mergedCommit, previousTip: mainTip });
    expect(gitOutputIn(groupWorktree, ['rev-parse', 'HEAD'])).toBe(mergedCommit);
    expect(tipOf('main')).toBe(mainTip);
  });

  test('a target moved by nobody the runner recorded is refused target-moved, and nothing moves', () => {
    const movedTip = commitFile(repositoryDirectory, 'elsewhere.ts', 'export const elsewhere = true;\n');

    expect(Landing.landOnTarget(mainLanding())).toEqual({ verdict: 'refused', reason: 'target-moved', facts: { targetTip: movedTip } });
    expect(tipOf('main')).toBe(movedTip);
  });

  test('a target moved by a recorded landing is refused so the slot requeues from the branch tip', () => {
    const movedTip = commitFile(repositoryDirectory, 'elsewhere.ts', 'export const elsewhere = true;\n');

    const landing = Landing.landOnTarget(mainLanding({ recordedLandings: [movedTip] }));

    expect(landing).toMatchObject({ verdict: 'refused', reason: 'target-moved-by-a-recorded-landing' });
    expect(LANDING_OUTCOME_OF_REFUSAL['target-moved-by-a-recorded-landing']).toBe('requeue-from-branch-tip');
  });

  test('a merged commit the target already holds reads as already landed: the board side is what is left to finish', () => {
    gitOutputIn(repositoryDirectory, ['merge', '-q', '--ff-only', mergedCommit]);

    expect(Landing.landOnTarget(mainLanding())).toEqual({ verdict: 'already-landed', commit: mergedCommit, targetTip: mergedCommit });
  });

  test('a checkout on another branch is refused not-on-target-branch, a target-level hold', () => {
    gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'elsewhere']);

    expect(Landing.landOnTarget(mainLanding())).toMatchObject({ verdict: 'refused', reason: 'not-on-target-branch' });
    expect(LANDING_OUTCOME_OF_REFUSAL['not-on-target-branch']).toBe('hold-target');
  });

  test('a dirty main checkout blocking the fast-forward is refused dirty-checkout, naming the files, and main stays', () => {
    writeFileSync(join(repositoryDirectory, 'feature.ts'), 'export const localEdit = true;\n');

    const landing = Landing.landOnTarget(mainLanding());

    expect(landing).toMatchObject({ verdict: 'refused', reason: 'dirty-checkout', facts: { blockingFiles: ['feature.ts'] } });
    expect(LANDING_OUTCOME_OF_REFUSAL['dirty-checkout']).toBe('hold-target');
    expect(tipOf('main')).toBe(mainTip);
  });

  test('the ticket-level refusals hold the ticket: an Acceptance not accounted for', () => {
    const unnumbered = ticketFixture({ id: '001' });
    const accounted  = { ...ticketFixture({ id: '002' }), body: '## Acceptance\nA1. Example.\n\n## Review\nA1 holds — probe.\n' };

    expect(Landing.ticketRefusalOf([accounted])).toBeNull();
    expect(Landing.ticketRefusalOf([accounted, unnumbered])).toEqual({ verdict: 'refused', reason: 'acceptance-unnumbered', facts: { ticketId: '001' } });
    for (const reason of ['acceptance-unnumbered', 'acceptance-unaccounted', 'acceptance-waived'] as const) {
      expect(LANDING_OUTCOME_OF_REFUSAL[reason]).toBe('hold-ticket');
    }
  });
});

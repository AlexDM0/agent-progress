/**
 * A spec's lane, stepper and stage spans. The lane table covers every rule row and the edges where the order of the rows decides: a filled
 * `tasks.md` over whatever `plan.md` holds, `tasks` above `converge` and `implement`, and a template copy counting as absent. The spans are
 * checked for which artefact opens and closes each one, since the page draws the Progress tab from them.
 */
import { describe, expect, test } from 'bun:test';

import type { FeatureDescription } from '../../../testing/SpecSnapshotSourceFixtures.ts';
import { phase, sourceFeature }    from '../../../testing/SpecSnapshotSourceFixtures.ts';
import { SpecStageUtil }           from './SpecStageUtil.ts';

const LANE_CASES: readonly (readonly [string, FeatureDescription, string])[] = [
  ['every task line ticked reads done', { plan: 'filled', tasks: 'filled', phases: [phase('setup', 2, 2), phase('user-story', 3, 3, 1)] }, 'done'],
  ['nothing ticked reads tasks', { plan: 'filled', tasks: 'filled', phases: [phase('setup', 0, 2), phase('user-story', 0, 3, 1)] }, 'tasks'],
  ['every task outside Convergence ticked and a Convergence task not reads converge',
    { plan: 'filled', tasks: 'filled', phases: [phase('setup', 2, 2), phase('convergence', 0, 2)] },
    'converge'],
  ['some ticked and some outside Convergence not reads implement',
    { plan: 'filled', tasks: 'filled', phases: [phase('setup', 2, 2), phase('user-story', 1, 3, 1)] },
    'implement'],
  ['a filled plan.md without tasks.md reads plan', { plan: 'filled' }, 'plan'],
  ['only spec.md reads specify', {}, 'specify'],
  ['no plan.md with an unticked filled tasks.md reads tasks', { tasks: 'filled', phases: [phase('setup', 0, 2)] }, 'tasks'],
  ['a template copy of tasks.md with a filled plan.md reads plan', { plan: 'filled', tasks: 'template', phases: [phase('setup', 0, 2)] }, 'plan'],
  ['a template copy of tasks.md without a filled plan.md reads specify', { plan: 'template', tasks: 'template', phases: [phase('setup', 0, 2)] }, 'specify'],
  ['a template copy of plan.md without tasks.md reads specify', { plan: 'template' }, 'specify'],
  ['a tasks.md without task lines reads tasks', { plan: 'filled', tasks: 'filled', phases: [phase('setup', 0, 0)] }, 'tasks'],
  ['a tasks.md of no phases reads tasks', { plan: 'filled', tasks: 'filled', phases: [] }, 'tasks'],
  ['a tasks.md of only unticked Convergence phases reads tasks, not converge',
    { plan: 'filled', tasks: 'filled', phases: [phase('convergence', 0, 2), phase('convergence', 0, 1)] },
    'tasks'],
  ['an unfinished Convergence after a finished one reads converge',
    { plan: 'filled', tasks: 'filled', phases: [phase('setup', 1, 1), phase('convergence', 2, 2), phase('convergence', 0, 1)] },
    'converge'],
  ['a filled tasks.md decides the lane whatever plan.md holds',
    { plan: 'template', tasks: 'filled', phases: [phase('setup', 1, 2)] },
    'implement'],
];

describe('the lane of a spec', () => {
  for (const [claim, description, lane] of LANE_CASES) {
    test(claim, () => {
      expect(SpecStageUtil.laneOf(sourceFeature(description))).toBe(lane as ReturnType<typeof SpecStageUtil.laneOf>);
    });
  }
});

describe('the stepper of a lane', () => {
  test('marks every lane before it done and it current', () => {
    expect(SpecStageUtil.stepperOf('tasks')).toEqual({ doneLanes: ['specify', 'plan'], currentLane: 'tasks' });
  });

  test('a done spec has every stage done and none current', () => {
    expect(SpecStageUtil.stepperOf('done')).toEqual({ doneLanes: ['specify', 'plan', 'tasks', 'implement', 'converge'], currentLane: null });
  });
});

describe('the stage spans of a spec', () => {
  const stagesOf = (description: FeatureDescription): readonly string[] => SpecStageUtil.stageSpansOf(sourceFeature(description))
    .map((span) => `${span.stage} ${span.start.artefact}→${span.end?.artefact ?? 'open'}`);

  test('a template plan.md without tasks.md has no Plan span and Specify open', () => {
    expect(stagesOf({ plan: 'template' })).toEqual(['specify spec→open']);
  });

  test('Specify ends at a filled plan.md, Plan at tasks.md, and Implement stays open while a task is unticked', () => {
    expect(stagesOf({ plan: 'filled', tasks: 'filled', phases: [phase('setup', 1, 2)] })).toEqual([
      'specify spec→plan',
      'plan plan→tasks',
      'implement tasks→open',
    ]);
  });

  test('without a filled plan.md Specify ends at tasks.md, and Implement ends at its modification once every task is ticked', () => {
    const spans = SpecStageUtil.stageSpansOf(sourceFeature({ tasks: 'filled', phases: [phase('setup', 2, 2)] }));
    expect(spans.map((span) => `${span.stage} ${span.start.artefact}→${span.end?.artefact ?? 'open'}`)).toEqual(['specify spec→tasks', 'implement tasks→tasks']);
    expect(spans[1]?.end?.date?.source).toBe('modification-time');
    expect(spans[1]?.start.date?.source).toBe('birth-time');
  });

  test('a template tasks.md opens no Implement span', () => {
    expect(stagesOf({ plan: 'filled', tasks: 'template', phases: [phase('setup', 2, 2)] })).toEqual(['specify spec→plan', 'plan plan→open']);
  });
});

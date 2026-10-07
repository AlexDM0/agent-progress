/**
 * The work items of a spec, one per `tasks.md` phase: their ids, states and the dependency rules, each shown on a fixture of Setup,
 * Foundational, three stories, Polish and two Convergence phases, and on one with an `other` phase and no Foundational or Polish, where the
 * fallbacks decide. A template copy of `tasks.md` counts as absent, so it yields none.
 */
import { describe, expect, test } from 'bun:test';

import { phase, sourceFeature } from '../../../testing/SpecSnapshotSourceFixtures.ts';
import { SpecWorkItemUtil }     from './SpecWorkItemUtil.ts';

const FULL_FEATURE = sourceFeature({
  folderName: '004-example-full',
  plan:       'filled',
  tasks:      'filled',
  phases:     [
    phase('setup', 2, 2),
    phase('foundational', 3, 3),
    phase('user-story', 4, 4, 1),
    phase('user-story', 1, 3, 2),
    phase('user-story', 0, 2, 3),
    phase('polish', 0, 2),
    phase('convergence', 0, 1),
    phase('convergence', 0, 1),
  ],
});

const OTHER_FEATURE = sourceFeature({
  folderName: '005-example-other',
  plan:       'filled',
  tasks:      'filled',
  phases:     [phase('setup', 1, 1), phase('user-story', 1, 1, 1), phase('user-story', 0, 1, 2), phase('other', 0, 1), phase('convergence', 0, 1)],
});

function dependenciesOf(feature: ReturnType<typeof sourceFeature>): Record<string, readonly string[]> {
  return Object.fromEntries(SpecWorkItemUtil.workItemsOf(feature).map((item) => [item.id, item.dependsOn]));
}

describe('the dependencies of work items', () => {
  test('Foundational waits on Setup, every story on Foundational, Polish on every story, the first Convergence on Polish and the next on it', () => {
    expect(dependenciesOf(FULL_FEATURE)).toEqual({
      '004-example-full-p01': [],
      '004-example-full-p02': ['004-example-full-p01'],
      '004-example-full-p03': ['004-example-full-p02'],
      '004-example-full-p04': ['004-example-full-p02'],
      '004-example-full-p05': ['004-example-full-p02'],
      '004-example-full-p06': ['004-example-full-p03', '004-example-full-p04', '004-example-full-p05'],
      '004-example-full-p07': ['004-example-full-p06'],
      '004-example-full-p08': ['004-example-full-p07'],
    });
  });

  test('without Foundational a story waits on Setup, an other phase on the phase before it, and without Polish Convergence on the last story', () => {
    expect(dependenciesOf(OTHER_FEATURE)).toEqual({
      '005-example-other-p01': [],
      '005-example-other-p02': ['005-example-other-p01'],
      '005-example-other-p03': ['005-example-other-p01'],
      '005-example-other-p04': ['005-example-other-p03'],
      '005-example-other-p05': ['005-example-other-p03'],
    });
  });

  test('waitingOn keeps only the dependencies not done', () => {
    const polish = SpecWorkItemUtil.workItemsOf(FULL_FEATURE).find((item) => item.kind === 'polish');
    expect(polish?.waitingOn).toEqual(['004-example-full-p04', '004-example-full-p05']);
  });
});

describe('the work items of a spec', () => {
  test('a phase is done when every task is ticked, to-do when none is or it has none, in-progress otherwise', () => {
    const feature = sourceFeature({ tasks: 'filled', phases: [phase('setup', 2, 2), phase('foundational', 0, 2), phase('user-story', 1, 2, 1), phase('polish', 0, 0)] });
    expect(SpecWorkItemUtil.workItemsOf(feature).map((item) => `${item.state} ${item.tickedCount}/${item.taskCount}`)).toEqual([
      'done 2/2',
      'to-do 0/2',
      'in-progress 1/2',
      'to-do 0/0',
    ]);
  });

  test('a story phase carries its tag text, priority and MVP mark, and its task lines in file order', () => {
    const story = SpecWorkItemUtil.workItemsOf(FULL_FEATURE)[3];
    expect(story).toMatchObject({
      tagText: 'US2 · P2', priority: 2, storyNumber: 2, isMinimumViableProduct: false, kind: 'user-story'
    });
    expect(story?.tasks.map((task) => `${task.id} ${task.isDone}`)).toEqual(['T40 true', 'T41 false', 'T42 false']);
    expect(SpecWorkItemUtil.workItemsOf(FULL_FEATURE)[0]?.tagText).toBeNull();
  });

  test('a template copy of tasks.md yields no work items', () => {
    expect(SpecWorkItemUtil.workItemsOf(sourceFeature({ plan: 'filled', tasks: 'template', phases: [phase('setup', 0, 2)] }))).toEqual([]);
  });

  test('the tick count of tasks counts the done ones of all of them', () => {
    expect(SpecWorkItemUtil.tickCountOf(FULL_FEATURE.tasks?.document.phases.flatMap((taskPhase) => taskPhase.tasks) ?? [])).toEqual({ ticked: 10, total: 18 });
  });
});

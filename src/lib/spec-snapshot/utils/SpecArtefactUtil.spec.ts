/**
 * Which artefacts count and which are listed: a template copy of `plan.md` or `tasks.md` counts as absent for the lane, work items and
 * spans, yet is still listed among the artefacts with its state, so the page can show it was copied.
 */
import { describe, expect, test } from 'bun:test';

import { sourceFeature }    from '../../../testing/SpecSnapshotSourceFixtures.ts';
import { SpecArtefactUtil } from './SpecArtefactUtil.ts';

describe('counted artefacts', () => {
  test('a template copy of plan.md or tasks.md counts as absent', () => {
    const feature = sourceFeature({ plan: 'template', tasks: 'template' });
    expect(SpecArtefactUtil.countedPlanOf(feature)).toBeNull();
    expect(SpecArtefactUtil.countedTasksOf(feature)).toBeNull();
  });

  test('a filled one counts', () => {
    const feature = sourceFeature({ plan: 'filled', tasks: 'filled' });
    expect(SpecArtefactUtil.countedPlanOf(feature)).toBe(feature.plan);
    expect(SpecArtefactUtil.countedTasksOf(feature)).toBe(feature.tasks);
  });
});

describe('listed artefacts', () => {
  test('lists every present artefact with its state, template copies included', () => {
    expect(SpecArtefactUtil.artefactsOf(sourceFeature({ plan: 'template', tasks: 'filled' })).map((artefact) => `${artefact.kind} ${artefact.state}`))
      .toEqual(['spec filled', 'plan template', 'tasks filled']);
  });
});

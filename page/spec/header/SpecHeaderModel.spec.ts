/**
 * The spec page's header model. The cases that matter: the four statistics come in order with their labels, implementing is the `implement`
 * lane's count, tasks read ticked of total, open clarifications count every open marker, and only implementing opens a lane, the Specs band's.
 */

import { describe, expect, test } from 'bun:test';
import { headerStatisticsMarkup } from '../../header/HeaderMarkup.ts';
import type { SpecHeaderSource }  from './SpecHeaderModel.ts';
import { specHeaderModelOf }      from './SpecHeaderModel.ts';

const EXAMPLE_SOURCE = {
  project:    'Example Storefront',
  specs:      [{}, {}, {}],
  laneCounts: {
    specify: 1, plan: 0, tasks: 0, implement: 2, converge: 0, done: 0
  },
  tasks:       { ticked: 69, total: 122 },
  openMarkers: [{
    folderName: '008-example', relativePath: 'specs/008-example/spec.md', text: 'Which?', line: 4
  }],
} as unknown as SpecHeaderSource;

describe('specHeaderModelOf', () => {
  test('lists specs, implementing, tasks and open clarifications, in that order, under the project title', () => {
    const model = specHeaderModelOf(EXAMPLE_SOURCE);

    expect(model.projectTitle).toBe('Example Storefront');
    expect(model.statistics.map((statistic) => [statistic.figure, statistic.label])).toEqual([
      ['3', 'specs'],
      ['2', 'implementing'],
      ['69 / 122', 'tasks'],
      ['1', 'open clarifications'],
    ]);
  });

  test('implementing opens the Specs band’s implement lane, and the other statistics print as plain text', () => {
    const markup = headerStatisticsMarkup(specHeaderModelOf(EXAMPLE_SOURCE).statistics);

    expect(specHeaderModelOf(EXAMPLE_SOURCE).statistics.map((statistic) => statistic.opensLane)).toEqual([null, 'implement', null, null]);
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('data-kanban-lane="implement" aria-label="Show 2 implementing on Kanban"');
    expect(markup).toContain('<span class="ap-stat"><span class="ap-stat-n">69 / 122</span><span class="ap-stat-label">tasks</span></span>');
  });
});

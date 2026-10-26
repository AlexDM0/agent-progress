/**
 * The shared waves graph read through options a page other than the tracker's would pass. The cases that matter: without slots no head has
 * a slot meter and the legend no slot line; nodes carry only the options' open attribute; the id label and title are escaped exactly once,
 * in the node and its accessible name; the Done count is the options' text; chips sit only on open nodes while the extra chip sits on
 * every node; and the empty text is the options' own. The tracker's own reading is held by `DependencyMarkup.spec.ts` and its frozen table.
 */

import { describe, expect, test } from 'bun:test';

import { DependencyGraphUtil }                              from '../utils/DependencyGraphUtil.ts';
import type { DependencyGraphOptions, DependencyNodeModel } from './WaveGraphMarkup.ts';
import { waveGraphMarkup }                                  from './WaveGraphMarkup.ts';

interface ExampleItem {
  id:        string;
  dependsOn: readonly string[];
  isDone:    boolean;
}

const ITEMS: readonly ExampleItem[] = [
  { id: 'example-p01', dependsOn: [], isDone: true },
  { id: 'example-p02', dependsOn: ['example-p01'], isDone: false },
  { id: 'example-p03', dependsOn: ['example-p02'], isDone: false },
];

const READERS = { settlesDependents: (item: ExampleItem) => item.isDone, primaryGroupKeyOf: () => 'example' };

function exampleNode(item: ExampleItem): DependencyNodeModel {
  return {
    id:         item.id,
    idLabel:    `US<${item.id.slice(-1)}> & P1`,
    title:      `Phase "${item.id}"`,
    dependsOn:  item.dependsOn,
    tone:       item.isDone ? 'delivered' : 'pending',
    isInReview: false,
    isLive:     false,
    chips:      [{ kind: 'state', displayState: 'pending' }],
  };
}

const OPTIONS: DependencyGraphOptions = {
  showsSlots:        false,
  doneCountTextOf:   (doneNodeIds) => `${doneNodeIds.length} done`,
  openAttribute:     'data-open-work-item',
  emptyText:         'Nothing <open> waits.',
  extraChipMarkupOf: (nodeId) => `<i data-extra="${nodeId}"></i>`,
};

const GRAPH    = DependencyGraphUtil.dependencyGraphOf(ITEMS, 0, READERS);
const NODE_BY_ID = new Map(ITEMS.map((item) => [item.id, exampleNode(item)]));
const MARKUP   = waveGraphMarkup(GRAPH, NODE_BY_ID, OPTIONS);

describe('waveGraphMarkup without slots', () => {
  test('no head has a slot meter and the legend has no slot line', () => {
    expect(MARKUP).toContain('ap-dependency-legend');
    expect(MARKUP).not.toContain('ap-dependency-slots');
    expect(MARKUP).not.toContain('ap-dependency-slot');
    expect(MARKUP).not.toContain('slot in use');
  });

  test('every node opens through the options attribute and none through data-open-ticket', () => {
    expect([...MARKUP.matchAll(/data-open-work-item="([^"]+)"/g)].map((match) => match[1])).toEqual(['example-p01', 'example-p02', 'example-p03']);
    expect(MARKUP).not.toContain('data-open-ticket');
  });

  test('the id label and the title are escaped exactly once, in the node and its accessible name', () => {
    expect(MARKUP).toContain('<span class="ap-ticket-id">US&lt;2&gt; &amp; P1</span>');
    expect(MARKUP).toContain('aria-label="US&lt;2&gt; &amp; P1 Phase &quot;example-p02&quot;"');
    expect(MARKUP).not.toContain('&amp;lt;');
    expect(MARKUP).not.toContain('&amp;amp;');
  });

  test('the Done column counts in the options words', () => {
    expect(MARKUP).toContain('<span class="ap-dependency-head-count">1 done</span>');
  });

  test('chips sit on open nodes only, the extra chip on every node', () => {
    expect(MARKUP.match(/data-state="pending">To do<\/span>/g)?.length).toBe(2);
    expect(MARKUP.match(/<i data-extra=/g)?.length).toBe(3);
  });

  test('a graph with nothing open shows the options empty text, escaped', () => {
    const settledOnly = [{ id: 'example-p01', dependsOn: [], isDone: true }];
    const graph       = DependencyGraphUtil.dependencyGraphOf(settledOnly, 0, READERS);

    expect(waveGraphMarkup(graph, new Map(), OPTIONS)).toBe('<p class="ap-dependency-empty">Nothing &lt;open&gt; waits.</p>');
  });
});

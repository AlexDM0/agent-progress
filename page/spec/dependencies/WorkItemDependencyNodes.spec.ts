/**
 * The spec page's Dependencies graph over the shared example repository. The cases that matter: a done work item settles its dependents,
 * so `002`'s US2 and US3 come a wave before its Polish and `003`'s Convergence follows its done Polish; the graph shows no slot meter;
 * nodes open the work item and never a ticket; the phase tag leads each node, escaped exactly once; the Done column reads "N done"; and
 * each node wears its spec's chip, a mark rather than a nested button.
 */

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import type { WorkItem }                                  from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { deriveSpecSnapshot }                             from '../../../src/lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { scannedExampleSpecKitRepository }                from '../../../src/testing/ScannedExampleSpecKitRepository.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { waveGraphMarkup }                                from '../../dependencies/WaveGraphMarkup.ts';
import { DependencyGraphUtil }                            from '../../utils/DependencyGraphUtil.ts';
import { WorkItemDependencyNodes }                        from './WorkItemDependencyNodes.ts';

const scratchDirectory = createScratchDirectory('spec-dependencies');
const EXAMPLE_SNAPSHOT = deriveSpecSnapshot(scannedExampleSpecKitRepository(scratchDirectory), new Date('2026-10-06T12:00:00+02:00'));
const GRAPH            = DependencyGraphUtil.dependencyGraphOf(
  WorkItemDependencyNodes.graphItemsOf(EXAMPLE_SNAPSHOT),
  0,
  WorkItemDependencyNodes.WORK_ITEM_GRAPH_READERS,
);
const MARKUP = waveGraphMarkup(GRAPH, WorkItemDependencyNodes.nodeByIdOf(EXAMPLE_SNAPSHOT), WorkItemDependencyNodes.graphOptionsOf(EXAMPLE_SNAPSHOT));

afterAll(() => removeScratchDirectory(scratchDirectory));

function waveOf(workItemId: string): number {
  return GRAPH.waveOfNode.get(workItemId) ?? Number.NaN;
}

describe('the spec Dependencies graph', () => {
  test('002 US2 and US3 sit a wave before its Polish, and 003 Convergence is open after its done Polish', () => {
    expect(waveOf('002-product-search-p04')).toBe(0);
    expect(waveOf('002-product-search-p05')).toBe(0);
    expect(waveOf('002-product-search-p06')).toBe(1);
    expect(GRAPH.settledNodeIds).toContain('003-wishlist-p05');
    expect(waveOf('003-wishlist-p06')).toBe(0);
  });

  test('the graph has no slot meter and no slot line in its legend', () => {
    expect(MARKUP).toContain('ap-dependency-canvas');
    expect(MARKUP).not.toContain('ap-dependency-slot');
  });

  test('nodes carry data-open-work-item and never data-open-ticket', () => {
    expect(MARKUP).toContain('data-open-work-item="002-product-search-p06"');
    expect(MARKUP).not.toContain('data-open-ticket');
  });

  test('the Done column reads N done, counting the done work open work was built on', () => {
    expect(MARKUP).toContain('<span class="ap-dependency-head-name">Done</span><span class="ap-dependency-head-count">3 done</span>');
  });

  test('each node wears its spec chip as a mark, never a nested button', () => {
    expect(MARKUP).toContain('<span class="ap-spec-dependency-chip" title="Spec: 002 ');
    expect(MARKUP.match(/<button/g)?.length).toBe(MARKUP.match(/class="ap-dependency-node"/g)?.length);
  });

  test('only an in-progress work item wears a state chip, its tone the state display translation', () => {
    const workItem = EXAMPLE_SNAPSHOT.specs[1]?.workItems[3] as WorkItem;

    expect(WorkItemDependencyNodes.dependencyNodeOf(workItem).chips).toEqual([]);
    const inProgressNode = WorkItemDependencyNodes.dependencyNodeOf({ ...workItem, state: 'in-progress' });

    expect(inProgressNode.tone).toBe('in-progress');
    expect(inProgressNode.chips).toEqual([{ kind: 'state', displayState: 'in-progress' }]);
    expect(inProgressNode.isInReview).toBe(false);
  });

  test('the phase tag leads its node, escaped exactly once', () => {
    const workItem: WorkItem = {
      ...EXAMPLE_SNAPSHOT.specs[1]?.workItems[3] as WorkItem,
      tagText: 'US2 <P2> & MVP',
    };
    const node = WorkItemDependencyNodes.dependencyNodeOf(workItem);

    expect(node.idLabel).toBe('US2 <P2> & MVP');
    expect(MARKUP).toContain('<span class="ap-ticket-id">US2 · P2</span>');
    const markup = waveGraphMarkup(GRAPH, new Map([[workItem.id, node]]), WorkItemDependencyNodes.graphOptionsOf(EXAMPLE_SNAPSHOT));
    expect(markup).toContain('<span class="ap-ticket-id">US2 &lt;P2&gt; &amp; MVP</span>');
    expect(markup).not.toContain('&amp;lt;');
  });
});

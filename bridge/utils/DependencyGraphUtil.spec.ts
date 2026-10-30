/**
 * The dependency model against the design's Shared model definitions. The cases that matter: a chain and a diamond (a ticket two paths
 * reach is held once), two parallel chains (waves span chains, the pace path follows the deeper one), the pace-path tie-break and its
 * place first in its wave, settled and abandoned dependencies, Unlocks counting upstream dependencies as no obstacle, cross-epic links by
 * primary epic, a pending low-priority ticket entering the waves like any other pending ticket, and the inputs that must
 * not throw: a cycle, an unknown id and an empty board. The slot count is whatever limit is passed.
 */

import { describe, expect, test }     from 'bun:test';
import type { DependencyGraphTicket } from '../@types/DependencyGraph.ts';
import { DependencyGraphUtil }        from './DependencyGraphUtil.ts';

const BOARD_SLOTS = 5;

function exampleTicket(id: string, changes: Partial<DependencyGraphTicket> = {}): DependencyGraphTicket {
  return {
    id, status: 'pending', memberOfEpics: [], ...changes
  };
}

function graphOf(tickets: readonly DependencyGraphTicket[]) {
  return DependencyGraphUtil.dependencyGraphOf(tickets, BOARD_SLOTS);
}

function heldCounts(graph: ReturnType<typeof graphOf>): Record<string, number> {
  return Object.fromEntries([...graph.heldOfNode].map(([nodeId, held]) => [nodeId, held.size]));
}

function waveTicketIds(graph: ReturnType<typeof graphOf>): (readonly string[])[] {
  return graph.waves.map((wave) => wave.nodeIds);
}

describe('waves', () => {
  test('a chain puts one ticket in each wave, every wave narrow, labelled Now then Wave 2 on', () => {
    const graph = graphOf([exampleTicket('1'), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['2'] })]);
    expect(waveTicketIds(graph)).toEqual([['1'], ['2'], ['3']]);
    expect(graph.waves.map((wave) => wave.label)).toEqual(['Now', 'Wave 2', 'Wave 3']);
    expect(graph.waves.every((wave) => wave.isNarrow)).toBe(true);
    expect(heldCounts(graph)).toEqual({ 1: 2, 2: 1, 3: 0 });
    expect(graph.pacePathNodeIds).toEqual(['1', '2', '3']);
  });

  test('a diamond holds its bottom ticket once and paces through the lower id of the tied middle', () => {
    const graph = graphOf([exampleTicket('1'), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['1'] }), exampleTicket('4', { dependsOn: ['2', '3'] })]);
    expect(waveTicketIds(graph)).toEqual([['1'], ['2', '3'], ['4']]);
    expect(graph.waves.map((wave) => wave.isNarrow)).toEqual([true, false, true]);
    expect(heldCounts(graph)).toEqual({
      1: 3, 2: 1, 3: 1, 4: 0
    });
    expect(graph.pacePathNodeIds).toEqual(['1', '2', '4']);
    expect([...graph.upstreamOfNode.get('4') ?? []].sort()).toEqual(['1', '2', '3']);
  });

  test('two parallel chains share waves by depth and the pace path follows the deeper chain', () => {
    const graph = graphOf([
      exampleTicket('1'),
      exampleTicket('2', { dependsOn: ['1'] }),
      exampleTicket('3', { dependsOn: ['2'] }),
      exampleTicket('4'),
      exampleTicket('5', { dependsOn: ['4'] }),
    ]);
    expect(waveTicketIds(graph)).toEqual([['1', '4'], ['2', '5'], ['3']]);
    expect(graph.waves.map((wave) => wave.isNarrow)).toEqual([false, false, true]);
    expect(heldCounts(graph)).toEqual({
      1: 2, 2: 1, 3: 0, 4: 1, 5: 0
    });
    expect(graph.pacePathNodeIds).toEqual(['1', '2', '3']);
  });

  test('a last-wave tie goes to the lowest id, and the pace-path ticket leads its wave over one holding more', () => {
    const graph = graphOf([
      exampleTicket('1'),
      exampleTicket('2'),
      exampleTicket('3', { dependsOn: ['1'] }),
      exampleTicket('4', { dependsOn: ['2'] }),
      exampleTicket('5', { dependsOn: ['2'] }),
    ]);
    expect(graph.pacePathNodeIds).toEqual(['1', '3']);
    expect(waveTicketIds(graph)).toEqual([['1', '2'], ['3', '4', '5']]);
  });

  test('within a wave, off the pace path, the ticket holding more comes first', () => {
    const graph = graphOf([
      exampleTicket('1'),
      exampleTicket('2'),
      exampleTicket('3'),
      exampleTicket('4', { dependsOn: ['1'] }),
      exampleTicket('5', { dependsOn: ['3'] }),
      exampleTicket('6', { dependsOn: ['3'] }),
    ]);
    expect(graph.pacePathNodeIds).toEqual(['1', '4']);
    expect(waveTicketIds(graph)[0]).toEqual(['1', '3', '2']);
  });

  test('settled dependencies open no wave and abandoned tickets leave the graph', () => {
    const graph = graphOf([
      exampleTicket('1', { status: 'delivered' }),
      exampleTicket('2', { status: 'reviewed' }),
      exampleTicket('3', { status: 'abandoned' }),
      exampleTicket('4', { dependsOn: ['1', '2', '3'] }),
      exampleTicket('5', { status: 'in-progress' }),
      exampleTicket('6', { status: 'in-review' }),
    ]);
    expect(graph.settledNodeIds).toEqual(['1', '2']);
    expect(graph.openNodeIds).toEqual(['4', '5', '6']);
    expect(graph.waveOfNode.get('4')).toBe(0);
    expect(graph.waveOfNode.has('1')).toBe(false);
    expect(graph.heldOfNode.get('1')).toEqual(new Set(['4']));
    expect(graph.heldOfNode.has('3')).toBe(false);
    expect([...graph.upstreamOfNode.get('4') ?? []].sort()).toEqual(['1', '2']);
  });
});

describe('low-priority tickets', () => {
  test('a pending low ticket with nothing open in front of it is in Now like any other pending ticket', () => {
    const graph = graphOf([exampleTicket('1', { priority: 'low' }), exampleTicket('2'), exampleTicket('3')]);
    expect(graph.openNodeIds).toEqual(['1', '2', '3']);
    expect(graph.waveOfNode.get('1')).toBe(0);
    expect(waveTicketIds(graph)).toEqual([['1', '2', '3']]);
  });

  test('an abandoned low ticket still leaves the graph', () => {
    const graph = graphOf([exampleTicket('1', { priority: 'low', status: 'abandoned' }), exampleTicket('2')]);
    expect(graph.openNodeIds).toEqual(['2']);
    expect(graph.settledNodeIds).toEqual([]);
    expect(graph.heldOfNode.has('1')).toBe(false);
  });

  test('a low ticket once started is in its wave as before, and once reviewed is settled as before', () => {
    for (const status of ['pending', 'in-progress', 'in-review'] as const) {
      const graph = graphOf([exampleTicket('1', { priority: 'low', status }), exampleTicket('2')]);
      expect(graph.openNodeIds).toEqual(['1', '2']);
      expect(waveTicketIds(graph)).toEqual([['1', '2']]);
    }
    const reviewed = graphOf([exampleTicket('1', { priority: 'low', status: 'reviewed' }), exampleTicket('2', { dependsOn: ['1'] })]);
    expect(reviewed.settledNodeIds).toEqual(['1']);
    expect(waveTicketIds(reviewed)).toEqual([['2']]);
  });

  test('a ticket waiting on a pending low ticket sits in the wave after it, which holds and paces through the low ticket', () => {
    const graph = graphOf([
      exampleTicket('1', { priority: 'low' }),
      exampleTicket('2', { dependsOn: ['1'] }),
      exampleTicket('3'),
      exampleTicket('4', { dependsOn: ['3'] }),
      exampleTicket('5', { dependsOn: ['1', '3'] }),
    ]);
    expect(graph.openNodeIds).toEqual(['1', '2', '3', '4', '5']);
    expect(graph.waveOfNode.get('1')).toBe(0);
    expect(graph.waveOfNode.get('2')).toBe(1);
    expect(heldCounts(graph)['1']).toBe(2);
    expect(graph.unlocksOfNode.get('1')).toEqual(['2']);
  });

  test('a ticket waiting only on a pending low ticket follows it out of Now', () => {
    const graph = graphOf([exampleTicket('1', { priority: 'low' }), exampleTicket('2', { dependsOn: ['1'] })]);
    expect(waveTicketIds(graph)).toEqual([['1'], ['2']]);
    expect(graph.pacePathNodeIds).toEqual(['1', '2']);
  });
});

describe('unlocks', () => {
  test('a dependent is unlocked only when its other open dependencies are upstream of the finishing ticket', () => {
    const graph = graphOf([exampleTicket('1'), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['1', '2'] })]);
    expect(graph.unlocksOfNode.get('1')).toEqual(['2']);
    expect(graph.unlocksOfNode.get('2')).toEqual(['3']);
  });

  test('neither side of a diamond unlocks the bottom, since each leaves the other open; a settled other dependency is no obstacle', () => {
    const diamond = graphOf([
      exampleTicket('1'), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['1'] }), exampleTicket('4', { dependsOn: ['2', '3'] }),
    ]);
    expect(diamond.unlocksOfNode.get('1')).toEqual(['2', '3']);
    expect(diamond.unlocksOfNode.get('2')).toEqual([]);
    const settledSide = graphOf([exampleTicket('2'), exampleTicket('3', { status: 'delivered' }), exampleTicket('4', { dependsOn: ['2', '3'] })]);
    expect(settledSide.unlocksOfNode.get('2')).toEqual(['4']);
  });
});

describe('cross-epic links', () => {
  test('an edge is a link only when both ends have a primary epic and the two differ', () => {
    const graph = graphOf([
      exampleTicket('1', { memberOfEpics: [{ key: 'checkout' }] }),
      exampleTicket('2', { dependsOn: ['1'], memberOfEpics: [{ key: 'emails' }, { key: 'checkout' }] }),
      exampleTicket('3', { dependsOn: ['1'], memberOfEpics: [{ key: 'checkout' }, { key: 'emails' }] }),
      exampleTicket('4', { dependsOn: ['1'] }),
    ]);
    expect(graph.crossGroupLinks).toEqual([{
      dependentNodeId: '2', dependentGroupKey: 'emails', dependencyNodeId: '1', dependencyGroupKey: 'checkout'
    }]);
  });
});

describe('inputs that must not throw', () => {
  test('a cycle is cut: every ticket in it gets a wave and none holds itself', () => {
    const graph = graphOf([exampleTicket('1', { dependsOn: ['2'] }), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['1'] })]);
    expect([...graph.waveOfNode.keys()].sort()).toEqual(['1', '2', '3']);
    expect(graph.heldOfNode.get('1')?.has('1')).toBe(false);
    expect(graph.upstreamOfNode.get('1')?.has('1')).toBe(false);
    expect(graph.pacePathNodeIds.length).toBeGreaterThan(0);
  });

  test('a ticket depending on itself sits in wave 0, holds nothing and does not unlock itself', () => {
    const graph = graphOf([exampleTicket('1', { dependsOn: ['1'] })]);
    expect(graph.waveOfNode.get('1')).toBe(0);
    expect(graph.heldOfNode.get('1')).toEqual(new Set());
    expect(graph.unlocksOfNode.get('1')).toEqual([]);
  });

  test('an unknown dependency id opens no wave and is nobody upstream', () => {
    const graph = graphOf([exampleTicket('1', { dependsOn: ['999'] })]);
    expect(graph.waveOfNode.get('1')).toBe(0);
    expect(graph.upstreamOfNode.get('1')).toEqual(new Set());
  });

  test('an empty board has no waves and no pace path, and keeps the slot count it was given', () => {
    const graph = DependencyGraphUtil.dependencyGraphOf([], 3);
    expect(graph.waves).toEqual([]);
    expect(graph.pacePathNodeIds).toEqual([]);
    expect(graph.boardSlots).toBe(3);
  });
});

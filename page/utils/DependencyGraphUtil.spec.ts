/**
 * The dependency model against the design's Shared model definitions. The cases that matter: a chain and a diamond (a ticket two paths
 * reach is held once), two parallel chains (waves span chains, the pace path follows the deeper one), the pace-path tie-break and its
 * place first in its wave, settled and abandoned dependencies, Unlocks counting upstream dependencies as no obstacle, cross-epic links by
 * primary epic, and the inputs that must not throw: a cycle, an unknown id and an empty board. The slot count is whatever limit is passed.
 */

import { describe, expect, test }     from 'bun:test';
import type { PageTicket }            from '../../src/shared/@types/PagePayload.ts';
import type { DependencyGraphTicket } from '../@types/DependencyGraph.ts';
import { pageBoardFixture }           from '../testing/PageBoardFixture.ts';
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
  return Object.fromEntries([...graph.heldOfTicket].map(([ticketId, held]) => [ticketId, held.size]));
}

function waveTicketIds(graph: ReturnType<typeof graphOf>): (readonly string[])[] {
  return graph.waves.map((wave) => wave.ticketIds);
}

function examplePageTicket(id: string, dependsOn: string[]): PageTicket {
  return {
    id,
    title:       `Example ${id}`,
    type:        'change',
    status:      'pending',
    filed:       '2026-09-18T20:00:00+02:00',
    updated:     '2026-09-18T20:00:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}-example.md`,
    bodyHtml:    '',
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  };
}

describe('waves', () => {
  test('a chain puts one ticket in each wave, every wave narrow, labelled Now then Wave 2 on', () => {
    const graph = graphOf([exampleTicket('1'), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['2'] })]);
    expect(waveTicketIds(graph)).toEqual([['1'], ['2'], ['3']]);
    expect(graph.waves.map((wave) => wave.label)).toEqual(['Now', 'Wave 2', 'Wave 3']);
    expect(graph.waves.every((wave) => wave.isNarrow)).toBe(true);
    expect(heldCounts(graph)).toEqual({ 1: 2, 2: 1, 3: 0 });
    expect(graph.pacePathTicketIds).toEqual(['1', '2', '3']);
  });

  test('a diamond read from the page board holds its bottom ticket once and paces through the lower id of the tied middle', () => {
    const { tickets } = pageBoardFixture({
      tasks:   [],
      tickets: [examplePageTicket('1', []), examplePageTicket('2', ['1']), examplePageTicket('3', ['1']), examplePageTicket('4', ['2', '3'])],
    });
    const graph = graphOf(tickets);
    expect(waveTicketIds(graph)).toEqual([['1'], ['2', '3'], ['4']]);
    expect(graph.waves.map((wave) => wave.isNarrow)).toEqual([true, false, true]);
    expect(heldCounts(graph)).toEqual({
      1: 3, 2: 1, 3: 1, 4: 0
    });
    expect(graph.pacePathTicketIds).toEqual(['1', '2', '4']);
    expect([...graph.upstreamOfTicket.get('4') ?? []].sort()).toEqual(['1', '2', '3']);
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
    expect(graph.pacePathTicketIds).toEqual(['1', '2', '3']);
  });

  test('a last-wave tie goes to the lowest id, and the pace-path ticket leads its wave over one holding more', () => {
    const graph = graphOf([
      exampleTicket('1'),
      exampleTicket('2'),
      exampleTicket('3', { dependsOn: ['1'] }),
      exampleTicket('4', { dependsOn: ['2'] }),
      exampleTicket('5', { dependsOn: ['2'] }),
    ]);
    expect(graph.pacePathTicketIds).toEqual(['1', '3']);
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
    expect(graph.pacePathTicketIds).toEqual(['1', '4']);
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
    expect(graph.settledTicketIds).toEqual(['1', '2']);
    expect(graph.openTicketIds).toEqual(['4', '5', '6']);
    expect(graph.waveOfTicket.get('4')).toBe(0);
    expect(graph.waveOfTicket.has('1')).toBe(false);
    expect(graph.heldOfTicket.get('1')).toEqual(new Set(['4']));
    expect(graph.heldOfTicket.has('3')).toBe(false);
    expect([...graph.upstreamOfTicket.get('4') ?? []].sort()).toEqual(['1', '2']);
  });
});

describe('unlocks', () => {
  test('a dependent is unlocked only when its other open dependencies are upstream of the finishing ticket', () => {
    const graph = graphOf([exampleTicket('1'), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['1', '2'] })]);
    expect(graph.unlocksOfTicket.get('1')).toEqual(['2']);
    expect(graph.unlocksOfTicket.get('2')).toEqual(['3']);
  });

  test('neither side of a diamond unlocks the bottom, since each leaves the other open; a settled other dependency is no obstacle', () => {
    const diamond = graphOf([
      exampleTicket('1'), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['1'] }), exampleTicket('4', { dependsOn: ['2', '3'] }),
    ]);
    expect(diamond.unlocksOfTicket.get('1')).toEqual(['2', '3']);
    expect(diamond.unlocksOfTicket.get('2')).toEqual([]);
    const settledSide = graphOf([exampleTicket('2'), exampleTicket('3', { status: 'delivered' }), exampleTicket('4', { dependsOn: ['2', '3'] })]);
    expect(settledSide.unlocksOfTicket.get('2')).toEqual(['4']);
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
    expect(graph.crossEpicLinks).toEqual([{
      dependentTicketId: '2', dependentEpicKey: 'emails', dependencyTicketId: '1', dependencyEpicKey: 'checkout'
    }]);
  });
});

describe('inputs that must not throw', () => {
  test('a cycle is cut: every ticket in it gets a wave and none holds itself', () => {
    const graph = graphOf([exampleTicket('1', { dependsOn: ['2'] }), exampleTicket('2', { dependsOn: ['1'] }), exampleTicket('3', { dependsOn: ['1'] })]);
    expect([...graph.waveOfTicket.keys()].sort()).toEqual(['1', '2', '3']);
    expect(graph.heldOfTicket.get('1')?.has('1')).toBe(false);
    expect(graph.upstreamOfTicket.get('1')?.has('1')).toBe(false);
    expect(graph.pacePathTicketIds.length).toBeGreaterThan(0);
  });

  test('a ticket depending on itself sits in wave 0, holds nothing and does not unlock itself', () => {
    const graph = graphOf([exampleTicket('1', { dependsOn: ['1'] })]);
    expect(graph.waveOfTicket.get('1')).toBe(0);
    expect(graph.heldOfTicket.get('1')).toEqual(new Set());
    expect(graph.unlocksOfTicket.get('1')).toEqual([]);
  });

  test('an unknown dependency id opens no wave and is nobody upstream', () => {
    const graph = graphOf([exampleTicket('1', { dependsOn: ['999'] })]);
    expect(graph.waveOfTicket.get('1')).toBe(0);
    expect(graph.upstreamOfTicket.get('1')).toEqual(new Set());
  });

  test('an empty board has no waves and no pace path, and keeps the slot count it was given', () => {
    const graph = DependencyGraphUtil.dependencyGraphOf([], 3);
    expect(graph.waves).toEqual([]);
    expect(graph.pacePathTicketIds).toEqual([]);
    expect(graph.boardSlots).toBe(3);
  });
});

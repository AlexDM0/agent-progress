/**
 * The Waves tab's forecast line. The cases that matter: with a forecast request, as while the dispatcher runs, every wave head, Now
 * included, carries "ETA <p50>–<p80>" worded by `TimeUtil.formatDuration` and the Done column none; a wave holding a held ticket carries
 * none; without a request, as while the dispatcher is stopped, no head carries one and the heads keep their usual height.
 */
import { describe, expect, test } from 'bun:test';

import type { Task, TaskPhase, TaskStatus } from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }                  from '../../src/shared/@types/PagePayload.ts';
import { pageBoardFixture }                 from '../testing/PageBoardFixture.ts';
import { DependencyGraphUtil }              from '../utils/DependencyGraphUtil.ts';
import { DependencyMarkup }                 from './DependencyMarkup.ts';

const NOW   = Date.parse('2026-09-18T22:00:00+02:00');
const UNITS = { hourMinutes: 60, dayMinutes: 1440 };
const BOARD_SLOTS = 3;

function exampleTicket(changes: Partial<PageTicket>): PageTicket {
  return {
    id:          '001',
    title:       'Example ticket',
    type:        'ticket',
    status:      'pending',
    filed:       '2026-09-18T20:00:00+02:00',
    updated:     '2026-09-18T20:00:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    '/example/.agent-progress/tickets/001-example.md',
    bodyHtml:    '',
    ...changes,
  };
}

function exampleRow(id: number, ticket: string, status: TaskStatus, history: TaskPhase[]): Task {
  return {
    id, name: `Ticket #${ticket}`, status, start: history[0]?.at ?? null, end: null, owner: '', note: '', ticket, tokens: null, history,
  };
}

/** One delivered ticket built in 40 minutes; 002 waits on it and 003 on 002, so Now holds 002 and Wave 2 holds 003. */
function headsOf(changesOfSecondTicket: Partial<PageTicket>, forecasts: boolean): string[] {
  const board = pageBoardFixture({
    tasks: [
      exampleRow(1, '001', 'delivered', [{ status: 'in-progress', at: '2026-09-18T10:00:00+02:00' }, { status: 'delivered', at: '2026-09-18T10:40:00+02:00' }]),
      exampleRow(2, '002', 'pending', []),
      exampleRow(3, '003', 'pending', []),
    ],
    tickets: [
      exampleTicket({
        id: '001', status: 'delivered', delivered: '2026-09-18T10:40:00+02:00', task: 1
      }),
      exampleTicket({
        id: '002', dependsOn: ['001'], task: 2, ...changesOfSecondTicket
      }),
      exampleTicket({ id: '003', dependsOn: ['002'], task: 3 }),
    ],
  });
  const graph  = DependencyGraphUtil.dependencyGraphOf(board.tickets, BOARD_SLOTS);
  const markup = DependencyMarkup.dependencyGraphMarkup(
    graph,
    new Map(board.tickets.map((ticket) => [ticket.id, ticket])),
    board.readyTicketIds,
    forecasts ? { nowEpochMilliseconds: NOW, units: UNITS } : null,
  );
  return markup.match(/<div class="ap-dependency-head".*?<\/div>/g) ?? [];
}

describe('the wave forecast line', () => {
  test('every wave head carries its range and the Done column none', () => {
    const [doneHead, nowHead, secondWaveHead] = headsOf({}, true);
    expect(doneHead).not.toContain('ETA');
    expect(nowHead).toContain('<span class="ap-dependency-head-count">ETA 40m–40m</span>');
    expect(secondWaveHead).toContain('<span class="ap-dependency-head-count">ETA 1h 20m–1h 20m</span>');
  });

  test('a wave holding a held ticket carries none, and neither does a wave waiting on it', () => {
    const heads = headsOf({ hold: 'waiting on Example Agency' }, true);
    expect(heads.some((head) => head.includes('ETA'))).toBe(false);
  });

  test('without a forecast request no head carries one', () => {
    expect(headsOf({}, false).some((head) => head.includes('ETA'))).toBe(false);
  });
});

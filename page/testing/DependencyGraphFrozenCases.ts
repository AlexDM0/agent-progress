/**
 * The Waves tab's whole graph markup over the two boards `page/dependencies/DependencyMarkup.spec.ts` builds as `MARKUP` and
 * `HELD_AND_LOW_MARKUP`, rebuilt here because a spec cannot be imported. `page/dependencies/DependencyMarkup.frozen.spec.ts` compares it
 * against `page/testing/FrozenDependencyGraphs.json`. Test-only: nothing that ships may import `page/testing/`.
 */
import type { Task, TaskPhase, TaskStatus } from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }                  from '../../src/shared/@types/PagePayload.ts';
import { DependencyMarkup }                 from '../dependencies/DependencyMarkup.ts';
import { DependencyGraphUtil }              from '../utils/DependencyGraphUtil.ts';
import { pageBoardFixture }                 from './PageBoardFixture.ts';

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

const FORECAST_NOW_EPOCH_MILLISECONDS = Date.parse('2026-09-18T22:00:00+02:00');
const FORECAST_UNITS                  = { hourMinutes: 60, dayMinutes: 1440 };

function exampleRow(id: number, ticket: string, status: TaskStatus, history: TaskPhase[]): Task {
  return {
    id, name: `Ticket #${ticket}`, status, start: history[0]?.at ?? null, end: null, owner: '', note: '', ticket, tokens: null, history,
  };
}

function graphMarkupOf(tickets: readonly PageTicket[], tasks: readonly Task[] = [], forecasts = false): string {
  const board = pageBoardFixture({ tasks: [...tasks], tickets: [...tickets] });
  const graph = DependencyGraphUtil.dependencyGraphOf(board.tickets, BOARD_SLOTS);
  const forecastRequest = forecasts ? { nowEpochMilliseconds: FORECAST_NOW_EPOCH_MILLISECONDS, units: FORECAST_UNITS } : null;
  return DependencyMarkup.dependencyGraphMarkup(graph, new Map(board.tickets.map((ticket) => [ticket.id, ticket])), board.readyTicketIds, forecastRequest);
}

/** Two delivered tickets built in 30 and 60 minutes, one build running for 10, and a pending chain after the first. */
function forecastWavesMarkup(): string {
  const deliveredAt = '2026-09-18T12:00:00+02:00';
  return graphMarkupOf([
    exampleTicket({
      id: '050', title: 'Delivered quickly', status: 'delivered', delivered: deliveredAt, task: 1
    }),
    exampleTicket({
      id: '051', title: 'Delivered slowly', status: 'delivered', delivered: deliveredAt, task: 2
    }),
    exampleTicket({
      id: '052', title: 'Next step', dependsOn: ['050'], task: 3
    }),
    exampleTicket({
      id: '053', title: 'Running build', status: 'in-progress', started: '2026-09-18T21:50:00+02:00', task: 4
    }),
    exampleTicket({
      id: '054', title: 'After the next step', dependsOn: ['052'], task: 5
    }),
  ], [
    exampleRow(1, '050', 'delivered', [
      { status: 'in-progress', at: '2026-09-18T10:00:00+02:00' }, { status: 'in-review', at: '2026-09-18T10:30:00+02:00' }, { status: 'delivered', at: deliveredAt },
    ]),
    exampleRow(2, '051', 'delivered', [
      { status: 'in-progress', at: '2026-09-18T10:00:00+02:00' }, { status: 'in-review', at: '2026-09-18T11:00:00+02:00' }, { status: 'delivered', at: deliveredAt },
    ]),
    exampleRow(3, '052', 'pending', []),
    exampleRow(4, '053', 'in-progress', [{ status: 'in-progress', at: '2026-09-18T21:50:00+02:00' }]),
    exampleRow(5, '054', 'pending', []),
  ], true);
}

export function dependencyGraphFrozenCases(): Record<string, string> {
  return {
    twoChainsOnADeliveredBase: graphMarkupOf([
      exampleTicket({
        id: '010', title: 'Delivered base', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00'
      }),
      exampleTicket({ id: '011', title: 'Schema <first>', dependsOn: ['010'] }),
      exampleTicket({
        id: '012', title: 'Side chain start', status: 'in-progress', started: '2026-09-18T20:30:00+02:00'
      }),
      exampleTicket({ id: '013', title: 'Second step', dependsOn: ['011'] }),
      exampleTicket({ id: '014', title: 'Narrow step', dependsOn: ['013', '012'] }),
      exampleTicket({ id: '015', title: 'Side chain end', dependsOn: ['012'] }),
      exampleTicket({ id: '016', title: 'Last step', dependsOn: ['014'] }),
      exampleTicket({
        id: '017', title: 'Settled, built on by nothing', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00'
      }),
    ]),
    heldAndLow: graphMarkupOf([
      exampleTicket({
        id: '020', title: 'Delivered base', status: 'delivered', delivered: '2026-09-18T21:00:00+02:00'
      }),
      exampleTicket({
        id: '021', title: 'Held step', dependsOn: ['020'], hold: 'not before 2026-10-05'
      }),
      exampleTicket({ id: '022', title: 'Low step', priority: 'low' }),
      exampleTicket({ id: '023', title: 'Normal step' }),
    ]),
    reviewedAndInReview: graphMarkupOf([
      exampleTicket({
        id: '030', title: 'Reviewed base', status: 'reviewed', finished: '2026-09-18T21:00:00+02:00'
      }),
      exampleTicket({
        id: '031', title: 'In review', status: 'in-review', dependsOn: ['030'], started: '2026-09-18T20:30:00+02:00'
      }),
      exampleTicket({ id: '032', title: 'After review', dependsOn: ['031'] }),
    ]),
    empty:         graphMarkupOf([exampleTicket({ id: '040', title: 'Alone' })]),
    forecastWaves: forecastWavesMarkup(),
  };
}

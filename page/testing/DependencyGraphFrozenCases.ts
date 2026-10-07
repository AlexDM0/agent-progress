/**
 * The Dependencies tab's whole graph markup over the two boards `page/dependencies/DependencyMarkup.spec.ts` builds as `MARKUP` and
 * `HELD_AND_LOW_MARKUP`, rebuilt here because a spec cannot be imported. `page/dependencies/DependencyMarkup.frozen.spec.ts` compares it
 * against `page/testing/FrozenDependencyGraphs.json`. Test-only: nothing that ships may import `page/testing/`.
 */
import type { PageTicket }     from '../../src/shared/@types/PagePayload.ts';
import { DependencyMarkup }    from '../dependencies/DependencyMarkup.ts';
import { DependencyGraphUtil } from '../utils/DependencyGraphUtil.ts';
import { pageBoardFixture }    from './PageBoardFixture.ts';

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

function graphMarkupOf(tickets: readonly PageTicket[]): string {
  const board = pageBoardFixture({ tasks: [], tickets: [...tickets] });
  const graph = DependencyGraphUtil.dependencyGraphOf(board.tickets, BOARD_SLOTS);
  return DependencyMarkup.dependencyGraphMarkup(graph, new Map(board.tickets.map((ticket) => [ticket.id, ticket])), board.readyTicketIds);
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
    empty: graphMarkupOf([exampleTicket({ id: '040', title: 'Alone' })]),
  };
}

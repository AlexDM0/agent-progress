/**
 * What every caller of the Board relies on, whichever method it calls: building a Board does no work, so a command that refuses before
 * changing anything leaves the records as read; and the tickets it reports as changed are exactly the ones the writer must write, so
 * a method that changes no ticket must mark none, or an untouched ticket file is rewritten. One row per method.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture }                        from '../../testing/BoardFixtures';
import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures';
import type { Board }                               from './Board';

const CHANGED_AT = '2026-09-18T20:40:00+02:00';

function populatedBoardFixture(): BoardFixture {
  return boardFixture({
    tasks: [
      taskFixture({
        id:     1,
        name:   '#001 Example checkout page',
        status: 'in-progress',
        ticket: '001',
        agent:  '001',
      }),
      taskFixture({ id: 2, name: 'Example free-standing task' }),
    ],
    tickets: [
      ticketFixture({ id: '001', status: 'in-progress', task: 1 }),
      ticketFixture({ id: '002', title: 'Example basket badge', hold: '' }),
    ],
    concurrencyLimit: 3,
  });
}

test('building a Board leaves the records as they were read, logs nothing and marks no ticket changed', () => {
  const fixture        = populatedBoardFixture();
  const progressAsRead = structuredClone(fixture.progress);
  const ticketsAsRead  = structuredClone(fixture.tickets);
  const {
    board,
    progress,
    tickets,
    records,
  } = fixture;

  expect(progress).toEqual(progressAsRead);
  expect(tickets).toEqual(ticketsAsRead);
  expect(records).toEqual([]);
  expect(board.changedTickets()).toEqual([]);
});

const CALLS_THAT_CHANGE_NO_TICKET: readonly (readonly [string, (board: Board) => unknown])[] = [
  ['setChartRange', (board) => board.setChartRange({ kind: 'auto' }, CHANGED_AT)],
  ['setConcurrencyLimit', (board) => board.setConcurrencyLimit(4, CHANGED_AT)],
  ['setDispatcherState', (board) => board.setDispatcherState('running', 'example-run', CHANGED_AT)],
  ['recordNote', (board) => board.recordNote('Example note from the orchestrator', CHANGED_AT)],
  ['moveTask', (board) => board.moveTask(1, 'paused', { movesAnyway: false }, CHANGED_AT)],
  ['correctTask', (board) => board.correctTask(1, { name: 'Example renamed row', status: 'in-review' }, { movesAnyway: true })],
  ['annotateTask', (board) => board.annotateTask(1, { note: 'Example note', tokens: 0 })],
  ['addTask without a ticket', (board) => board.addTask({ name: 'Example free-standing row', startsNow: true, movesTheLink: false }, CHANGED_AT)],
  ['removeTask of a row no ticket names', (board) => board.removeTask(2)],
  ['recordAgentStop', (board) => board.recordAgentStop({
    agentId:              'agent_example',
    agentType:            'general-purpose',
    apiCallCount:         1,
    endContextTokens:     1_000,
    totalInputTokens:     1_000,
    cacheReadInputTokens: 0,
    outputTokens:         10,
  }, [{ target: 'row', taskId: 1, tokens: 1_000 }, { target: 'ticket', ticketId: '001', tokens: 1_000 }], CHANGED_AT)],
  ['startReviewBar', (board) => board.startReviewBar('001', { round: 1, owner: 'Alex Example' }, CHANGED_AT)],
  ['clearTracker without the tickets', (board) => board.clearTracker({ ticketsSurvive: false }, CHANGED_AT)],
  ['ticketIsReleasable', (board) => board.tickets().map((ticket) => board.ticketIsReleasable(ticket))],
  ['unsettledDependenciesOf', (board) => board.unsettledDependenciesOf('001')],
  ['lowPriorityWorkHoldingBack', (board) => board.lowPriorityWorkHoldingBack('002')],
  ['pausedBuildRowOf', (board) => board.pausedBuildRowOf('001')],
  ['readyTickets', (board) => board.readyTickets()],
  ['heldTicketIds', (board) => board.heldTicketIds()],
  ['taskIsSettled', (board) => board.tasks().map((task) => board.taskIsSettled(task))],
  ['ticketIsSettled', (board) => board.tickets().map((ticket) => board.ticketIsSettled(ticket))],
  ['tasks', (board) => board.tasks()],
  ['tickets', (board) => board.tickets()],
  ['taskById', (board) => board.taskById(1)],
  ['ticketByReference', (board) => board.ticketByReference('1')],
  ['concurrency', (board) => board.concurrency()],
  ['dispatcherState', (board) => board.dispatcherState()],
  ['dispatcherRunId', (board) => board.dispatcherRunId()],
  ['changedTickets', (board) => board.changedTickets()],
];

const CALLS_THAT_CHANGE_A_TICKET: readonly (readonly [string, (board: Board) => unknown, readonly string[]])[] = [
  ['addTask for a ticket', (board) => board.addTask({
    name:         'Example basket badge row',
    ticketId:     '002',
    startsNow:    false,
    movesTheLink: false,
  }, CHANGED_AT), ['002']],
  ['removeTask of the row a ticket names', (board) => board.removeTask(1), ['001']],
  ['fileTicket', (board) => board.fileTicket(ticketFixture({ id: '003', title: 'Example order history' }), CHANGED_AT), ['003']],
  ['moveTicket', (board) => board.moveTicket('001', 'in-review', { checksLegality: true }, CHANGED_AT), ['001']],
  ['moveTicket that closes a review bar', (board) => {
    board.startReviewBar('001', { round: 1 }, CHANGED_AT);
    return board.moveTicket('001', 'pending', { checksLegality: true }, CHANGED_AT);
  }, ['001']],
  ['rereviewTicket', (board) => {
    // Put in review by hand rather than by a move, so the only change that can mark the ticket is the review pass itself.
    const ticket = board.ticketByReference('001');
    if (ticket !== undefined) ticket.frontmatter.status = 'in-review';
    return board.rereviewTicket('001', CHANGED_AT);
  }, ['001']],
  ['setTicketDependencies', (board) => board.setTicketDependencies('002', ['001'], CHANGED_AT), ['002']],
  ['claimTickets', (board) => {
    // Unheld by hand rather than by a change, so the only change that can mark the ticket is the claim itself.
    const ticket = board.ticketByReference('002');
    if (ticket !== undefined) delete ticket.frontmatter.hold;
    return board.claimTickets(['002'], { owner: 'Alex Example' }, CHANGED_AT);
  }, ['002']],
  ['releaseTickets', (board) => {
    // Put in review by hand, so that each ticket is marked by the release alone.
    const ticket = board.ticketByReference('002');
    if (ticket !== undefined) ticket.frontmatter.status = 'in-review';
    return board.releaseTickets(['001', '002'], { branch: 'ticket/example-checkout', commit: 'a1b2c3d4' }, CHANGED_AT);
  }, ['001', '002']],
  ['setTicketPriority', (board) => board.setTicketPriority('002', 'high', CHANGED_AT), ['002']],
  ['linkTicketToTask', (board) => board.linkTicketToTask('002', 2, { movesTheLink: false }), ['002']],
  ['linkTicketToTask moving a row from its owner', (board) => board.linkTicketToTask('002', 1, { movesTheLink: true }), ['001', '002']],
  ['setTicketAgents', (board) => board.setTicketAgents('002', { model: 'sonnet' }, CHANGED_AT), ['002']],
  ['holdTicket', (board) => board.holdTicket('001', 'Example reason', CHANGED_AT), ['001']],
  ['unholdTicket', (board) => board.unholdTicket('002', CHANGED_AT), ['002']],
  ['clearTracker with the tickets', (board) => board.clearTracker({ ticketsSurvive: true }, CHANGED_AT), ['001', '002']],
];

describe('the tickets a method marks changed', () => {
  for (const [methodName, call] of CALLS_THAT_CHANGE_NO_TICKET) {
    // Marking one of these would rewrite a ticket file that nothing changed, which a person editing it by hand would lose.
    test(`${methodName} marks no ticket changed`, () => {
      const { board } = populatedBoardFixture();
      call(board);
      expect(board.changedTickets()).toEqual([]);
    });
  }

  for (const [methodName, call, changedTicketIds] of CALLS_THAT_CHANGE_A_TICKET) {
    // A ticket the Board changed and did not mark would never reach its file, and the row and the ticket would disagree on disk.
    test(`${methodName} marks ${changedTicketIds.map((ticketId) => `#${ticketId}`).join(', ')} changed`, () => {
      const { board } = populatedBoardFixture();
      call(board);
      expect(board.changedTickets().map((ticket) => ticket.frontmatter.id)).toEqual([...changedTicketIds]);
    });
  }
});

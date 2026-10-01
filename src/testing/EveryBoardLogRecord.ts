/**
 * One record of every kind, as the Board's own changes log them, so a spec pinning what log.jsonl stores reads the Board's key order rather
 * than a hand-written copy of it. Test-only: nothing that ships may import `src/testing/`.
 */
import type { LogRecord }              from '../lib/tracker-model/@types/LogRecord.ts';
import { boardFixture, ticketFixture } from './BoardFixtures.ts';

export function everyRecordKindTheBoardLogs(at: string): LogRecord[] {
  const { board, records } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', title: 'Example checkout page' }),
      ticketFixture({ id: '002', title: 'Example cart', group: 'example-shop' }),
    ],
  });
  board.recordNote('Example note from the orchestrator', at);
  board.fileTicket(ticketFixture({ id: '003', title: 'Example search page' }), at);
  board.setTicketPriority('001', 'high', at);
  board.setTicketDependencies('002', ['001'], at);
  board.setTicketAgents('001', { model: 'sonnet', effort: 'high' }, at);
  board.holdTicket('001', 'waiting on Example Agency', at);
  board.unholdTicket('001', at);
  board.markReleaseTicket('002', at);
  board.clearReleaseTicket('002', at);
  board.addEpic({
    key:      'example-checkout',
    title:    'Example checkout redesign',
    body:     '',
    filePath: '/example-agency/storefront/.agent-progress/epics/example-checkout.md',
  }, at);
  board.editEpic('example-checkout', { title: 'Example checkout overhaul' }, at);
  board.removeEpic('example-checkout', at);
  board.setTicketEpics('002', [], at);
  board.moveTicket('001', 'in-progress', { checksLegality: true }, at);
  board.moveTicket('001', 'in-review', { checksLegality: true }, at);
  board.startReviewBar('001', { round: 1 }, at);
  board.rereviewTicket('001', at);
  board.moveTicket('001', 'reviewed', { checksLegality: true }, at);
  board.moveTicket('001', 'delivered', { checksLegality: true }, at);
  board.moveTicket('001', 'pending', { checksLegality: false }, at);
  board.moveTicket('003', 'abandoned', { checksLegality: true, reason: 'superseded by #001' }, at);
  board.setChartRange({
    kind:        'relative',
    from:        '-2h',
    to:          'now',
    tickMinutes: 15,
  }, at);
  board.setConcurrencyLimit(3, at);
  board.setDispatcherState('running', 'example-run', at);
  board.recordAgentStop({
    agentId:              'example-agent',
    agentType:            'agent-progress-worker',
    apiCallCount:         12,
    endContextTokens:     48_000,
    totalInputTokens:     310_000,
    cacheReadInputTokens: 250_000,
    outputTokens:         9_000,
  }, [], at);
  board.clearTracker({ ticketsSurvive: true }, at);
  return records;
}

/**
 * Pins the bytes log.jsonl stores for every record kind the Board logs: a scenario through the Board's own changes, each record serialised
 * the way `src/adapters/log/LogFileWriter.ts` writes it, against a frozen table. JSON keeps key order, so a record built in another order
 * would change the stored file while every structural comparison still passed. To retake the table, print `storedLinesOf` and paste it.
 */
import { expect, test } from 'bun:test';

import { boardFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { LogRecord }              from './@types/LogRecord.ts';

const LOGGED_AT = '2026-09-26T10:15:00+02:00';

const FROZEN_STORED_LINES = [
  '{"at":"2026-09-26T10:15:00+02:00","kind":"note","fields":{"text":"Example note from the orchestrator"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-filed","ticketId":"003","fields":{"title":"Example search page"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-priority-changed","ticketId":"001","fields":{"from":"normal","to":"high"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-dependencies-set","ticketId":"002","fields":{"dependsOn":["001"]}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-agents-changed","ticketId":"001","fields":{"from":{"model":"opus","effort":"medium"},"to":{"model":"sonnet","effort":"high"}}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-held","ticketId":"001","fields":{"reason":"waiting on Example Agency"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-unheld","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-started","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-finished","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"review-bar-started","taskId":3,"ticketId":"001","fields":{"name":"Review 1 #001 — Example checkout page"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-rereviewed","ticketId":"001","fields":{"round":2}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-approved","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"review-bar-closed","taskId":3,"ticketId":"001","fields":{"name":"Review 1 #001 — Example checkout page"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-delivered","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-reopened","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-abandoned","ticketId":"003","fields":{"reason":"superseded by #001"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"chart-range-set","fields":{"view":{"kind":"relative","from":"-2h","to":"now","tickMinutes":15}}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"concurrency-limit-set","fields":{"limit":3}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"dispatcher-set","fields":{"state":"running","runId":"example-run"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"agent-stopped","fields":{"agentId":"example-agent","agentType":"agent-progress-worker",'
    + '"apiCallCount":12,"endContextTokens":48000,"totalInputTokens":310000,"cacheReadInputTokens":250000,"outputTokens":9000}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"tracker-cleared","fields":{}}',
];

function storedLinesOf(records: readonly LogRecord[]): string[] {
  return records.map((record) => JSON.stringify(record));
}

function recordsOfTheScenario(): LogRecord[] {
  const { board, records } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', title: 'Example checkout page' }),
      ticketFixture({ id: '002', title: 'Example cart' }),
    ],
  });
  board.recordNote('Example note from the orchestrator', LOGGED_AT);
  board.fileTicket(ticketFixture({ id: '003', title: 'Example search page' }), LOGGED_AT);
  board.setTicketPriority('001', 'high', LOGGED_AT);
  board.setTicketDependencies('002', ['001'], LOGGED_AT);
  board.setTicketAgents('001', { model: 'sonnet', effort: 'high' }, LOGGED_AT);
  board.holdTicket('001', 'waiting on Example Agency', LOGGED_AT);
  board.unholdTicket('001', LOGGED_AT);
  board.moveTicket('001', 'in-progress', { checksLegality: true }, LOGGED_AT);
  board.moveTicket('001', 'in-review', { checksLegality: true }, LOGGED_AT);
  board.startReviewBar('001', { round: 1 }, LOGGED_AT);
  board.rereviewTicket('001', LOGGED_AT);
  board.moveTicket('001', 'reviewed', { checksLegality: true }, LOGGED_AT);
  board.moveTicket('001', 'delivered', { checksLegality: true }, LOGGED_AT);
  board.moveTicket('001', 'pending', { checksLegality: false }, LOGGED_AT);
  board.moveTicket('003', 'abandoned', { checksLegality: true, reason: 'superseded by #001' }, LOGGED_AT);
  board.setChartRange({
    kind:        'relative',
    from:        '-2h',
    to:          'now',
    tickMinutes: 15,
  }, LOGGED_AT);
  board.setConcurrencyLimit(3, LOGGED_AT);
  board.setDispatcherState('running', 'example-run', LOGGED_AT);
  board.recordAgentStop({
    agentId:              'example-agent',
    agentType:            'agent-progress-worker',
    apiCallCount:         12,
    endContextTokens:     48_000,
    totalInputTokens:     310_000,
    cacheReadInputTokens: 250_000,
    outputTokens:         9_000,
  }, [], LOGGED_AT);
  board.clearTracker({ ticketsSurvive: true }, LOGGED_AT);
  return records;
}

test('the scenario logs every record kind there is', () => {
  const loggedKinds = new Set(recordsOfTheScenario().map((record) => record.kind));
  expect(loggedKinds.size).toBe(21);
});

test('every record the Board logs is stored byte for byte as the frozen table says', () => {
  expect(storedLinesOf(recordsOfTheScenario())).toEqual(FROZEN_STORED_LINES);
});

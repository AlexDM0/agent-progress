/**
 * Pins the bytes log.jsonl stores for every record kind the Board logs: `src/testing/EveryBoardLogRecord.ts` drives the Board's own
 * changes, each record serialised the way `src/adapters/log/LogFileWriter.ts` writes it, against a frozen table. JSON keeps key order,
 * so a record built in another order would change the stored file while every structural comparison still passed. To retake the table,
 * print `storedLinesOf` and paste it.
 */
import { expect, test } from 'bun:test';

import { everyRecordKindTheBoardLogs } from '../../testing/EveryBoardLogRecord.ts';
import type { LogRecord }              from './@types/LogRecord.ts';

const LOGGED_AT = '2026-09-26T10:15:00+02:00';

const RECORD_KIND_COUNT = 23;

const FROZEN_STORED_LINES = [
  '{"at":"2026-09-26T10:15:00+02:00","kind":"note","fields":{"text":"Example note from the orchestrator"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-filed","ticketId":"003","fields":{"title":"Example search page"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-priority-changed","ticketId":"001","fields":{"from":"normal","to":"high"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-dependencies-set","ticketId":"002","fields":{"dependsOn":["001"]}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-agents-changed","ticketId":"001","fields":{"from":{"model":"opus","effort":"medium"},"to":{"model":"sonnet","effort":"high"}}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-held","ticketId":"001","fields":{"reason":"waiting on Example Agency"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-unheld","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-release-marked","ticketId":"002","fields":{"group":"example-shop"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-release-cleared","ticketId":"002","fields":{}}',
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

test('the scenario logs every record kind there is, once each', () => {
  const records = everyRecordKindTheBoardLogs(LOGGED_AT);
  expect(records.length).toBe(RECORD_KIND_COUNT);
  expect(new Set(records.map((record) => record.kind)).size).toBe(RECORD_KIND_COUNT);
});

test('every record the Board logs is stored byte for byte as the frozen table says', () => {
  expect(storedLinesOf(everyRecordKindTheBoardLogs(LOGGED_AT))).toEqual(FROZEN_STORED_LINES);
});

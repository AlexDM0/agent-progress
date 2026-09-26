/**
 * log.jsonl is rewritten whole from the records read back, so a record the logger wrote must map to itself byte for byte, in the logger's key
 * order (at, kind, taskId, ticketId, fields), and a key the tool does not know, at the top or inside the fields, must not travel on.
 */
import { expect, test } from 'bun:test';

import type { LogRecord }       from '../../../lib/tracker-model/@types/LogRecord.ts';
import { createLogger }         from '../../../lib/tracker-model/Logger.ts';
import { LogRecordMappingUtil } from './LogRecordMappingUtil.ts';

const { recordOf } = LogRecordMappingUtil;

const RECORDED_AT = '2026-09-18T21:30:54+02:00';

function everyKindAsTheLoggerWritesIt(): LogRecord[] {
  const records: LogRecord[] = [];
  const logger = createLogger((record) => records.push(record));
  logger.note('Example note from the orchestrator', RECORDED_AT);
  logger.ticketFiled('001', 'Example checkout flow', RECORDED_AT);
  logger.ticketReopened('001', RECORDED_AT);
  logger.ticketStarted('001', RECORDED_AT);
  logger.ticketFinished('001', RECORDED_AT);
  logger.ticketApproved('001', RECORDED_AT);
  logger.ticketDelivered('001', RECORDED_AT);
  logger.ticketAbandoned('001', 'superseded by #002', RECORDED_AT);
  logger.ticketRereviewed('001', 2, RECORDED_AT);
  logger.ticketPriorityChanged('001', { from: 'normal', to: 'high' }, RECORDED_AT);
  logger.ticketDependenciesSet('002', ['001'], RECORDED_AT);
  logger.ticketAgentsChanged('001', { from: { model: 'opus', effort: 'medium' }, to: { model: 'sonnet', effort: 'low' } }, RECORDED_AT);
  logger.ticketHeld('001', 'waiting on design', RECORDED_AT);
  logger.ticketUnheld('001', RECORDED_AT);
  logger.reviewBarStarted({ taskId: 7, ticketId: '001', name: 'Review 1 #001 — Example checkout flow' }, RECORDED_AT);
  logger.reviewBarClosed({ taskId: 7, ticketId: '001', name: 'Review 1 #001 — Example checkout flow' }, RECORDED_AT);
  logger.chartRangeSet({
    kind:        'absolute',
    from:        '2026-03-02T08:00:00+01:00',
    to:          '2026-03-02T18:00:00+01:00',
    tickMinutes: 60,
  }, RECORDED_AT);
  logger.concurrencyLimitSet(3, RECORDED_AT);
  logger.dispatcherSet('running', 'wf_example', RECORDED_AT);
  logger.trackerCleared(RECORDED_AT);
  logger.agentStopped({
    agentId:              'agent_example',
    agentType:            'general-purpose',
    apiCallCount:         2,
    endContextTokens:     6800,
    totalInputTokens:     11_000,
    cacheReadInputTokens: 8000,
    outputTokens:         1000,
  }, RECORDED_AT);
  return records;
}

test('every record the logger writes maps back to the same line, key for key and in the same order', () => {
  for (const record of everyKindAsTheLoggerWritesIt()) {
    const line = JSON.stringify(record);
    expect(JSON.stringify(recordOf(JSON.parse(line))), record.kind).toBe(line);
  }
});

test('a review-bar record keeps the order at, kind, taskId, ticketId, fields', () => {
  const stored = {
    fields:   { name: 'Review 1 #001 — Example checkout flow' },
    ticketId: '001',
    taskId:   7,
    kind:     'review-bar-started',
    at:       RECORDED_AT,
  };
  expect(JSON.stringify(recordOf(stored)))
    .toBe(`{"at":"${RECORDED_AT}","kind":"review-bar-started","taskId":7,"ticketId":"001","fields":{"name":"Review 1 #001 — Example checkout flow"}}`);
});

test('an agent-stopped record keeps the usage figures in the order the hook builds them', () => {
  const stored = {
    at:     RECORDED_AT,
    kind:   'agent-stopped',
    fields: {
      outputTokens:         1000,
      cacheReadInputTokens: 8000,
      totalInputTokens:     11_000,
      endContextTokens:     6800,
      apiCallCount:         2,
      agentType:            'general-purpose',
      agentId:              'agent_example',
    },
  };
  expect(Object.keys(recordOf(stored).fields))
    .toEqual(['agentId', 'agentType', 'apiCallCount', 'endContextTokens', 'totalInputTokens', 'cacheReadInputTokens', 'outputTokens']);
});

test('keys the kind does not know are dropped, at the top, inside the fields and inside an agent pair', () => {
  const stored = {
    at:       RECORDED_AT,
    kind:     'ticket-agents-changed',
    taskId:   3,
    ticketId: '001',
    source:   'a newer build',
    fields:   {
      from:    { model: 'opus', effort: 'medium', temperature: 1 },
      to:      { model: 'sonnet', effort: 'low' },
      comment: 'by hand',
    },
  };
  expect(recordOf(stored)).toEqual({
    at:       RECORDED_AT,
    kind:     'ticket-agents-changed',
    ticketId: '001',
    fields:   { from: { model: 'opus', effort: 'medium' }, to: { model: 'sonnet', effort: 'low' } },
  });
});

test('an automatic chart range keeps only its kind', () => {
  const stored = { at: RECORDED_AT, kind: 'chart-range-set', fields: { view: { kind: 'auto', from: '-2h' } } };
  expect(recordOf(stored)).toEqual({ at: RECORDED_AT, kind: 'chart-range-set', fields: { view: { kind: 'auto' } } });
});

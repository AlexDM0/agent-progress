/**
 * What the Board and the sinks rely on: every Logger method hands the sink exactly one record, carrying the method's kind, ids and
 * fields and the stamp it was given, in call order, and returns that same record, so a Board change can return what it logged.
 */
import { expect, test } from 'bun:test';

import type {
  AgentUsage,
  LogRecord,
  LogRecordContent,
  ReviewBarReference
} from './@types/LogRecord';
import type { ViewRange }            from './@types/ProgressFile';
import type { AgentPair }            from './@types/Ticket';
import { createLogger, type Logger } from './Logger';

const LOGGED_AT = '2026-09-26T10:15:00+02:00';

const EXAMPLE_USAGE: AgentUsage = {
  agentId:              'example-agent',
  agentType:            'agent-progress-worker',
  apiCallCount:         12,
  endContextTokens:     48_000,
  totalInputTokens:     310_000,
  cacheReadInputTokens: 250_000,
  outputTokens:         9_000,
};

const EXAMPLE_BAR: ReviewBarReference = { taskId: 7, ticketId: '003', name: 'Review 2 #003 — Example checkout page' };

const EXAMPLE_VIEW: ViewRange = {
  kind:        'relative',
  from:        '-2h',
  to:          'now',
  tickMinutes: 15,
};

const DEFAULT_AGENTS: AgentPair = { model: 'opus', effort: 'medium' };

const CHOSEN_AGENTS: AgentPair = { model: 'sonnet', effort: 'high' };

interface LoggerCall {
  call:     (logger: Logger) => LogRecord;
  expected: LogRecord;
}

function stampedAtLoggedAt(content: LogRecordContent): LogRecord {
  return { at: LOGGED_AT, ...content };
}

const EVERY_LOGGER_CALL: readonly LoggerCall[] = [
  {
    call:     (logger) => logger.note('Example note', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'note', fields: { text: 'Example note' } }),
  },
  {
    call:     (logger) => logger.ticketFiled('003', 'Example checkout page', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-filed', ticketId: '003', fields: { title: 'Example checkout page' } }),
  },
  {
    call:     (logger) => logger.ticketReopened('003', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-reopened', ticketId: '003', fields: {} }),
  },
  {
    call:     (logger) => logger.ticketStarted('003', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-started', ticketId: '003', fields: {} }),
  },
  {
    call:     (logger) => logger.ticketFinished('003', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-finished', ticketId: '003', fields: {} }),
  },
  {
    call:     (logger) => logger.ticketApproved('003', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-approved', ticketId: '003', fields: {} }),
  },
  {
    call:     (logger) => logger.ticketDelivered('003', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-delivered', ticketId: '003', fields: {} }),
  },
  {
    call:     (logger) => logger.ticketAbandoned('003', 'superseded by #007', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-abandoned', ticketId: '003', fields: { reason: 'superseded by #007' } }),
  },
  {
    call:     (logger) => logger.ticketRereviewed('003', 2, LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-rereviewed', ticketId: '003', fields: { round: 2 } }),
  },
  {
    call:     (logger) => logger.ticketPriorityChanged('003', { from: 'normal', to: 'high' }, LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-priority-changed', ticketId: '003', fields: { from: 'normal', to: 'high' } }),
  },
  {
    call:     (logger) => logger.ticketDependenciesSet('003', ['001', '002'], LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-dependencies-set', ticketId: '003', fields: { dependsOn: ['001', '002'] } }),
  },
  {
    call:     (logger) => logger.ticketAgentsChanged('003', { from: DEFAULT_AGENTS, to: CHOSEN_AGENTS }, LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-agents-changed', ticketId: '003', fields: { from: DEFAULT_AGENTS, to: CHOSEN_AGENTS } }),
  },
  {
    call:     (logger) => logger.ticketHeld('003', 'waiting on Example Agency', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-held', ticketId: '003', fields: { reason: 'waiting on Example Agency' } }),
  },
  {
    call:     (logger) => logger.ticketUnheld('003', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'ticket-unheld', ticketId: '003', fields: {} }),
  },
  {
    call:     (logger) => logger.reviewBarStarted(EXAMPLE_BAR, LOGGED_AT),
    expected: stampedAtLoggedAt({
      kind:     'review-bar-started',
      taskId:   7,
      ticketId: '003',
      fields:   { name: EXAMPLE_BAR.name },
    }),
  },
  {
    call:     (logger) => logger.reviewBarClosed(EXAMPLE_BAR, LOGGED_AT),
    expected: stampedAtLoggedAt({
      kind:     'review-bar-closed',
      taskId:   7,
      ticketId: '003',
      fields:   { name: EXAMPLE_BAR.name },
    }),
  },
  {
    call:     (logger) => logger.chartRangeSet(EXAMPLE_VIEW, LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'chart-range-set', fields: { view: EXAMPLE_VIEW } }),
  },
  {
    call:     (logger) => logger.concurrencyLimitSet(3, LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'concurrency-limit-set', fields: { limit: 3 } }),
  },
  {
    call:     (logger) => logger.dispatcherSet('running', 'example-run', LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'dispatcher-set', fields: { state: 'running', runId: 'example-run' } }),
  },
  {
    call:     (logger) => logger.trackerCleared(LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'tracker-cleared', fields: {} }),
  },
  {
    call:     (logger) => logger.agentStopped(EXAMPLE_USAGE, LOGGED_AT),
    expected: stampedAtLoggedAt({ kind: 'agent-stopped', fields: EXAMPLE_USAGE }),
  },
];

function recordingLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { logger: createLogger((record) => records.push(record)), records };
}

// A Logger method the table forgets would pass every other case, so the table is checked against the logger's own method list.
test('the table below calls every method the logger has, once each', () => {
  const { logger } = recordingLogger();
  const calledKinds = new Set(EVERY_LOGGER_CALL.map(({ expected }) => expected.kind));
  expect(EVERY_LOGGER_CALL.length).toBe(Object.keys(logger).length);
  expect(calledKinds.size).toBe(EVERY_LOGGER_CALL.length);
});

test('each call hands the sink one record with its kind, ids, fields and stamp', () => {
  for (const { call, expected } of EVERY_LOGGER_CALL) {
    const { logger, records } = recordingLogger();
    call(logger);
    expect(records).toEqual([expected]);
  }
});

// A Board change returns the records it logged; that is only true if what it got back is what the sink received.
test('each call returns the very record the sink received', () => {
  for (const { call } of EVERY_LOGGER_CALL) {
    const { logger, records } = recordingLogger();
    const returned = call(logger);
    expect(returned).toBe(records[0] as LogRecord);
  }
});

test('records reach the sink in call order, one per call', () => {
  const { logger, records } = recordingLogger();
  logger.ticketStarted('003', '2026-09-26T10:00:00+02:00');
  logger.reviewBarClosed(EXAMPLE_BAR, '2026-09-26T10:05:00+02:00');
  logger.note('Example note', '2026-09-26T10:10:00+02:00');
  expect(records.map(({ kind, at }) => `${kind} ${at}`)).toEqual([
    'ticket-started 2026-09-26T10:00:00+02:00',
    'review-bar-closed 2026-09-26T10:05:00+02:00',
    'note 2026-09-26T10:10:00+02:00',
  ]);
});

test('nothing reaches the sink until a method is called', () => {
  const { records } = recordingLogger();
  expect(records).toEqual([]);
});

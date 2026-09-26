/**
 * The log is read back by people and kept in stored files, so a record must word as the sentence the tracker wrote before records
 * existed, byte for byte. The frozen table pins one row per kind, and both forms where a kind has two; the usage line's claims pin the
 * units it shares with the chart.
 */
import { describe, expect, test } from 'bun:test';

import type { AgentUsage, LogRecord, LogRecordContent } from '../../lib/tracker-model/@types/LogRecord';
import { LogUtil }                                      from './LogUtil';

const {
  dispatcherStateTextOf,
  identifiedEntryOf,
  sentenceOf,
  wordedEntryOf,
} = LogUtil;

/**
 * Taken from the binary before the records existed, at bc42604 (the last commit before step 4b). To retake a row, check that commit out
 * in a worktree, run `bun run <worktree>/agent-progress.ts init` in a scratch git repository, then the command that logs the row (`log`,
 * a `ticket` or `task` verb, `range`, `concurrency`, `dispatcher`, `clear --yes`), and copy its text from the `log` in progress.json.
 * Rows no command reaches easily (a hold or abandon without a reason, two dependencies at once) are read from the wording in
 * bc42604:cli/ticket/TicketCommand.ts and bc42604:lib/tickets/TicketTransitions.ts.
 */
const SENTENCE_FOR_RECORD: readonly (readonly [LogRecordContent, string])[] = [
  [{ kind: 'note', fields: { text: 'Example note from the orchestrator' } }, 'Example note from the orchestrator'],
  [{ kind: 'ticket-filed', ticketId: '001', fields: { title: 'Example checkout flow' } }, 'Ticket #001 filed: Example checkout flow'],
  [{ kind: 'ticket-reopened', ticketId: '004', fields: {} }, 'Ticket #004 reopened'],
  [{ kind: 'ticket-started', ticketId: '001', fields: {} }, 'Ticket #001 started'],
  [{ kind: 'ticket-finished', ticketId: '004', fields: {} }, 'Ticket #004 in review'],
  [{ kind: 'ticket-approved', ticketId: '004', fields: {} }, 'Ticket #004 reviewed'],
  [{ kind: 'ticket-delivered', ticketId: '005', fields: {} }, 'Ticket #005 delivered'],
  [{ kind: 'ticket-abandoned', ticketId: '006', fields: { reason: 'superseded by #002' } }, 'Ticket #006 abandoned: superseded by #002'],
  [{ kind: 'ticket-abandoned', ticketId: '006', fields: { reason: '' } }, 'Ticket #006 abandoned: '],
  [{ kind: 'ticket-rereviewed', ticketId: '004', fields: { round: 2 } }, 'Ticket #004 in review, round 2'],
  [{ kind: 'ticket-priority-changed', ticketId: '006', fields: { from: 'low', to: 'normal' } }, 'Ticket #006 priority low → normal'],
  [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: ['004'] } }, 'Ticket #005 waits on #004'],
  [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: ['003', '004'] } }, 'Ticket #005 waits on #003, #004'],
  [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: [] } }, 'Ticket #005 waits on no other ticket'],
  [
    { kind: 'ticket-agents-changed', ticketId: '001', fields: { from: { model: 'opus', effort: 'medium' }, to: { model: 'sonnet', effort: 'low' } } },
    'Ticket #001 agents opus/medium → sonnet/low',
  ],
  [{ kind: 'ticket-held', ticketId: '001', fields: { reason: 'waiting on design' } }, 'Ticket #001 held: waiting on design'],
  [{ kind: 'ticket-held', ticketId: '001', fields: { reason: '' } }, 'Ticket #001 held'],
  [{ kind: 'ticket-unheld', ticketId: '001', fields: {} }, 'Ticket #001 unheld'],
  [
    {
      kind:     'review-bar-started',
      taskId:   7,
      ticketId: '004',
      fields:   { name: 'Review 1 #004 — Example cart badge' },
    },
    'Review row #7 started: Review 1 #004 — Example cart badge',
  ],
  [
    {
      kind:     'review-bar-closed',
      taskId:   13,
      ticketId: '005',
      fields:   { name: 'Example review pass' },
    },
    'Closed the review row #13, delivered: Example review pass',
  ],
  [{ kind: 'chart-range-set', fields: { view: { kind: 'auto' } } }, 'Chart range: automatic'],
  [
    {
      kind:   'chart-range-set',
      fields: {
        view: {
          kind:        'absolute',
          from:        '2026-03-02T08:00:00+01:00',
          to:          '2026-03-02T18:00:00+01:00',
          tickMinutes: 60,
        },
      },
    },
    'Chart range: 2026-03-02T08:00:00+01:00 → 2026-03-02T18:00:00+01:00 (tick 60m)',
  ],
  [
    {
      kind:   'chart-range-set',
      fields: {
        view: {
          kind:        'relative',
          from:        '-2h',
          to:          'now',
          tickMinutes: null,
        },
      },
    },
    'Chart range: -2h → now',
  ],
  [{ kind: 'concurrency-limit-set', fields: { limit: 3 } }, 'Concurrency limit set to 3'],
  [{ kind: 'dispatcher-set', fields: { state: 'running', runId: 'example-run' } }, 'Dispatcher set to running (run example-run)'],
  [{ kind: 'dispatcher-set', fields: { state: 'finished', runId: null } }, 'Dispatcher set to finished'],
  [{ kind: 'tracker-cleared', fields: {} }, 'Tracker cleared'],
  [
    {
      kind:   'agent-stopped',
      fields: {
        agentId:              'agent_example',
        agentType:            'general-purpose',
        apiCallCount:         2,
        endContextTokens:     6800,
        totalInputTokens:     11_000,
        cacheReadInputTokens: 8000,
        outputTokens:         1000,
      },
    },
    'Agent agent_example (general-purpose) stopped: 2 calls, end context 6.8k, input 11k (cache read 8k), output 1k',
  ],
];

const RECORD_KIND_COUNT = 21;

test('every kind of record reads as the sentence the log held before there were records', () => {
  expect(new Set(SENTENCE_FOR_RECORD.map(([record]) => record.kind)).size, 'the table covers every kind').toBe(RECORD_KIND_COUNT);
  for (const [record, sentence] of SENTENCE_FOR_RECORD) expect(sentenceOf(record), record.kind).toBe(sentence);
});

test('a worded entry keeps the record\'s stamp and carries its sentence', () => {
  const at = '2026-09-18T20:11:03+02:00';
  const record: LogRecord = {
    at,
    kind:     'ticket-started',
    ticketId: '001',
    fields:   {},
  };
  expect(wordedEntryOf(record)).toEqual({ at, text: 'Ticket #001 started' });
});

describe('the entry the page reads', () => {
  const at = '2026-09-18T20:11:03+02:00';

  test('gives a ticket record its ticket id only, and a review-bar record its task id and ticket id', () => {
    const ticketRecord: LogRecord    = {
      at,
      kind:     'ticket-held',
      ticketId: '003',
      fields:   { reason: 'waits on #005' },
    };
    const reviewBarRecord: LogRecord = {
      at,
      kind:     'review-bar-started',
      taskId:   9,
      ticketId: '003',
      fields:   { name: 'Review 1 #003 — Example' },
    };

    expect(identifiedEntryOf(ticketRecord)).toEqual({ at, text: 'Ticket #003 held: waits on #005', ticketId: '003' });
    expect(identifiedEntryOf(reviewBarRecord)).toEqual({
      at,
      text:     'Review row #9 started: Review 1 #003 — Example',
      taskId:   9,
      ticketId: '003',
    });
  });

  // A line with no id key is the one the detail panel still matches by its words, so an id-less record must reach the page without one.
  test('gives a record that names no task or ticket exactly the stamp and the sentence', () => {
    const recordsWithoutIds: readonly LogRecord[] = [
      { at, kind: 'note', fields: { text: 'Ticket #001 looks done' } },
      {
        at,
        kind:   'agent-stopped',
        fields: {
          agentId:              'agent_1',
          agentType:            'Explore',
          apiCallCount:         2,
          endContextTokens:     6000,
          totalInputTokens:     12_000,
          cacheReadInputTokens: 9000,
          outputTokens:         500,
        },
      },
      { at, kind: 'tracker-cleared', fields: {} },
      { at, kind: 'dispatcher-set', fields: { state: 'running', runId: 'example-run' } },
    ];

    for (const record of recordsWithoutIds) expect(Object.keys(identifiedEntryOf(record)), record.kind).toEqual(['at', 'text']);
  });

  test('words a record exactly as the entry status prints', () => {
    for (const [content] of SENTENCE_FOR_RECORD) {
      const record: LogRecord = { ...content, at };
      const identified        = identifiedEntryOf(record);

      expect({ at: identified.at, text: identified.text }, content.kind).toEqual(wordedEntryOf(record));
    }
  });
});

test('a dispatcher state names its run only when it has one, as the dispatcher command reads it back', () => {
  expect(dispatcherStateTextOf('running', 'example-run')).toBe('running (run example-run)');
  expect(dispatcherStateTextOf('stopped', null)).toBe('stopped');
});

describe('the line the log receives', () => {
  function agentStoppedSentenceOf(usage: AgentUsage): string {
    return sentenceOf({ kind: 'agent-stopped', fields: usage });
  }

  test('it names the agent, the call count and the three figures, in the units the chart uses', () => {
    const line = agentStoppedSentenceOf({
      agentId:              'agent_42',
      agentType:            'general-purpose',
      apiCallCount:         32,
      endContextTokens:     165_000,
      totalInputTokens:     4_800_000,
      cacheReadInputTokens: 4_500_000,
      outputTokens:         48_000,
    });

    expect(line).toBe('Agent agent_42 (general-purpose) stopped: 32 calls, end context 165k, input 4.8M (cache read 4.5M), output 48k');
  });

  /** The cache-read share is what explains a long session; a plain input total hides it, which is why it is printed beside it. */
  test('prints the input total it is given beside the cache-read share, each in the chart units', () => {
    const line = agentStoppedSentenceOf({
      agentId:              'agent_1',
      agentType:            'Explore',
      apiCallCount:         2,
      endContextTokens:     6000,
      totalInputTokens:     12_000,
      cacheReadInputTokens: 9000,
      outputTokens:         500,
    });

    expect(line).toContain('input 12k (cache read 9k)');
    expect(line).toContain('output 500');
  });
});

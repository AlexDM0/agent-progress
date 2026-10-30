/**
 * The log is read back by people and kept in stored files, so a record must word as the sentence the tracker wrote before records
 * existed, byte for byte. The frozen table pins one row per kind, and both forms where a kind has two; the usage line's claims pin the
 * units it shares with the chart.
 */
import { describe, expect, test } from 'bun:test';

import type { AgentUsage, LogRecord, LogRecordContent } from '../../lib/tracker-model/@types/LogRecord.ts';
import { LogUtil }                                      from './LogUtil.ts';

const {
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
  [{ kind: 'ticket-retitled', ticketId: '006', fields: { from: 'Example cart', to: 'Example basket' } }, 'Ticket #006 renamed: Example cart → Example basket'],
  [{ kind: 'ticket-rereviewed', ticketId: '004', fields: { round: 2 } }, 'Ticket #004 in review, round 2'],
  [{ kind: 'ticket-priority-changed', ticketId: '006', fields: { from: 'low', to: 'normal' } }, 'Ticket #006 priority low → normal'],
  [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: ['004'] } }, 'Ticket #005 waits on #004'],
  [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: ['003', '004'] } }, 'Ticket #005 waits on #003, #004'],
  [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: [] } }, 'Ticket #005 waits on no other ticket'],
  [{ kind: 'ticket-epics-set', ticketId: '005', fields: { epics: ['checkout-redesign'] } }, 'Ticket #005 belongs to epic checkout-redesign'],
  [{ kind: 'ticket-epics-set', ticketId: '005', fields: { epics: ['search', 'checkout-redesign'] } }, 'Ticket #005 belongs to epics search, checkout-redesign'],
  [{ kind: 'ticket-epics-set', ticketId: '005', fields: { epics: [] } }, 'Ticket #005 belongs to no epic'],
  [{ kind: 'ticket-check-command-restamped', ticketId: '005', fields: { command: 'bun run checks' } }, 'Ticket #005 restamped with the check command bun run checks'],
  [{ kind: 'ticket-check-command-restamped', ticketId: '005', fields: { command: null } }, 'Ticket #005 restamped with no check command'],
  [{ kind: 'epic-added', epicKey: 'search', fields: { title: 'Example search' } }, 'Epic search added: Example search'],
  [{ kind: 'epic-edited', epicKey: 'search', fields: { title: 'Example search' } }, 'Epic search edited: Example search'],
  [{ kind: 'epic-removed', epicKey: 'search', fields: {} }, 'Epic search removed'],
  [
    { kind: 'ticket-agents-changed', ticketId: '001', fields: { from: { model: 'opus', effort: 'medium' }, to: { model: 'sonnet', effort: 'low' } } },
    'Ticket #001 agents opus/medium → sonnet/low',
  ],
  [{ kind: 'ticket-size-changed', ticketId: '001', fields: { to: 'M' } }, 'Ticket #001 sized M'],
  [{ kind: 'ticket-size-changed', ticketId: '001', fields: { from: 'M', to: 'XL' } }, 'Ticket #001 size M → XL'],
  [{ kind: 'ticket-held', ticketId: '001', fields: { reason: 'waiting on design' } }, 'Ticket #001 held: waiting on design'],
  [{ kind: 'ticket-held', ticketId: '001', fields: { reason: '' } }, 'Ticket #001 held'],
  [{ kind: 'ticket-unheld', ticketId: '001', fields: {} }, 'Ticket #001 unheld'],
  [{ kind: 'ticket-release-marked', ticketId: '001', fields: { group: 'example-shop' } }, 'Ticket #001 marked as the release ticket of group example-shop'],
  [{ kind: 'ticket-release-cleared', ticketId: '001', fields: {} }, 'Ticket #001 no longer marked as its group\'s release ticket'],
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
  [{ kind: 'overseer-set', fields: { state: 'paused' } }, 'Overseer set to paused'],
  [{ kind: 'dispatcher-set', fields: { state: 'running', runId: 'example-run' } }, 'Dispatcher set to running (run example-run)'],
  [{ kind: 'dispatcher-set', fields: { state: 'finished', runId: null } }, 'Dispatcher set to finished'],
  [{ kind: 'check-command-set', fields: { command: 'bun run example-checks' } }, 'Check command set to bun run example-checks'],
  [{ kind: 'check-command-set', fields: { command: null } }, 'Check command cleared'],
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

const RECORD_KIND_COUNT = 32;

test('every kind of record reads as the sentence the log held before there were records', () => {
  expect(new Set(SENTENCE_FOR_RECORD.map(([record]) => record.kind)).size, 'the table covers every kind').toBe(RECORD_KIND_COUNT);
  for (const [record, sentence] of SENTENCE_FOR_RECORD) expect(sentenceOf(record), record.kind).toBe(sentence);
});

// No earlier binary logged these, so their wording is this suite's own; a launch is claimed by its tickets, every other job record by none.
describe('the Overseer and its jobs', () => {
  const SENTENCE_AND_TICKET_IDS_FOR_RECORD: readonly (readonly [LogRecordContent, string, readonly string[]])[] = [
    [{ kind: 'overseer-started', fields: { codeVersion: 'a1b2c3d', installVersion: 17 } }, 'Overseer started on code a1b2c3d, install version 17', []],
    [{ kind: 'overseer-stopped', fields: { reason: 'stopped' } }, 'Overseer stopped', []],
    [{ kind: 'overseer-stopped', fields: { reason: 'handed-over' } }, 'Overseer handed the board over to its successor', []],
    [
      {
        kind:   'job-launched',
        jobId:  'J3',
        fields: {
          kind:        'build',
          role:        'builder',
          ticketIds:   ['001', '002'],
          attempt:     2,
          target:      'group-example-shop',
          parentJobId: null,
        },
      },
      'Job J3 launched: build (builder) for #001, #002 onto group-example-shop, attempt 2',
      ['001', '002'],
    ],
    [
      {
        kind:   'job-launched',
        jobId:  'J5',
        fields: {
          kind:        'merge-agent',
          role:        'resolver',
          ticketIds:   [],
          attempt:     1,
          target:      null,
          parentJobId: 'J4',
        },
      },
      'Job J5 launched: merge-agent (resolver) under job J4, attempt 1',
      [],
    ],
    [{ kind: 'job-interrupted', jobId: 'J3', fields: { cause: 'reboot', watcherInstance: 1 } }, 'Job J3 interrupted (reboot) in Watcher instance 1', []],
    [{ kind: 'job-resumed', jobId: 'J3', fields: { watcherInstance: 2, cause: 'reboot' } }, 'Job J3 resumed in Watcher instance 2 after reboot', []],
    [{ kind: 'job-ended', jobId: 'J3', fields: { outcome: 'built', commit: 'b2c3d4e', deniedPermissions: [] } }, 'Job J3 ended built at b2c3d4e', []],
    [
      { kind: 'job-ended', jobId: 'J4', fields: { outcome: 'failed', cause: 'no report', deniedPermissions: ['WebFetch', 'Bash(curl:*)'] } },
      'Job J4 ended failed (no report); denied WebFetch, Bash(curl:*)',
      [],
    ],
  ];

  test.each(SENTENCE_AND_TICKET_IDS_FOR_RECORD)('%o reads as its sentence and is claimed by its tickets', (content, sentence, ticketIds) => {
    const identified = identifiedEntryOf({ ...content, at: '2026-09-18T20:11:03+02:00' });
    expect(identified.text).toBe(sentence);
    expect(identified.ticketIds).toEqual([...ticketIds]);
  });
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

    expect(identifiedEntryOf(ticketRecord)).toEqual({
      at,
      text:      'Ticket #003 held: waits on #005',
      taskIds:   [],
      ticketIds: ['003'],
    });
    expect(identifiedEntryOf(reviewBarRecord)).toEqual({
      at,
      text:      'Review row #9 started: Review 1 #003 — Example',
      taskIds:   [9],
      ticketIds: ['003'],
    });
  });

  /**
   * One row per kind, and each form of a dependency record: the waiting ticket comes first, then each ticket it waits on, once. A
   * `#005` inside a reason, a title or a bar name is free text and adds nothing.
   */
  test('carries every task and ticket id a record concerns, and none its free text mentions', () => {
    const idsForRecord: ReadonlyArray<readonly [LogRecordContent, { taskIds: number[]; ticketIds: string[] }]> = [
      [{ kind: 'ticket-filed', ticketId: '001', fields: { title: 'Follow up on #005' } }, { taskIds: [], ticketIds: ['001'] }],
      [{ kind: 'ticket-reopened', ticketId: '004', fields: {} }, { taskIds: [], ticketIds: ['004'] }],
      [{ kind: 'ticket-started', ticketId: '001', fields: {} }, { taskIds: [], ticketIds: ['001'] }],
      [{ kind: 'ticket-finished', ticketId: '004', fields: {} }, { taskIds: [], ticketIds: ['004'] }],
      [{ kind: 'ticket-approved', ticketId: '004', fields: {} }, { taskIds: [], ticketIds: ['004'] }],
      [{ kind: 'ticket-delivered', ticketId: '005', fields: {} }, { taskIds: [], ticketIds: ['005'] }],
      [{ kind: 'ticket-abandoned', ticketId: '006', fields: { reason: 'superseded by #005' } }, { taskIds: [], ticketIds: ['006'] }],
      [{ kind: 'ticket-retitled', ticketId: '006', fields: { from: 'Example cart', to: 'Example basket' } }, { taskIds: [], ticketIds: ['006'] }],
      [{ kind: 'ticket-rereviewed', ticketId: '004', fields: { round: 2 } }, { taskIds: [], ticketIds: ['004'] }],
      [{ kind: 'ticket-priority-changed', ticketId: '006', fields: { from: 'low', to: 'normal' } }, { taskIds: [], ticketIds: ['006'] }],
      [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: ['003', '004'] } }, { taskIds: [], ticketIds: ['005', '003', '004'] }],
      [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: ['004', '004'] } }, { taskIds: [], ticketIds: ['005', '004'] }],
      [{ kind: 'ticket-dependencies-set', ticketId: '005', fields: { dependsOn: [] } }, { taskIds: [], ticketIds: ['005'] }],
      [{ kind: 'ticket-epics-set', ticketId: '005', fields: { epics: ['search'] } }, { taskIds: [], ticketIds: ['005'] }],
      [{ kind: 'epic-added', epicKey: 'search', fields: { title: 'Example search' } }, { taskIds: [], ticketIds: [] }],
      [{ kind: 'epic-edited', epicKey: 'search', fields: { title: 'Example search' } }, { taskIds: [], ticketIds: [] }],
      [{ kind: 'epic-removed', epicKey: 'search', fields: {} }, { taskIds: [], ticketIds: [] }],
      [
        { kind: 'ticket-agents-changed', ticketId: '001', fields: { from: { model: 'opus', effort: 'medium' }, to: { model: 'sonnet', effort: 'low' } } },
        { taskIds: [], ticketIds: ['001'] },
      ],
      [{ kind: 'ticket-size-changed', ticketId: '003', fields: { to: 'S' } }, { taskIds: [], ticketIds: ['003'] }],
      [{ kind: 'ticket-held', ticketId: '003', fields: { reason: 'waits on #005' } }, { taskIds: [], ticketIds: ['003'] }],
      [{ kind: 'ticket-unheld', ticketId: '001', fields: {} }, { taskIds: [], ticketIds: ['001'] }],
      [{ kind: 'ticket-release-marked', ticketId: '007', fields: { group: 'release #002' } }, { taskIds: [], ticketIds: ['007'] }],
      [{ kind: 'ticket-release-cleared', ticketId: '007', fields: {} }, { taskIds: [], ticketIds: ['007'] }],
      [{ kind: 'ticket-check-command-restamped', ticketId: '007', fields: { command: 'bun run example-checks' } }, { taskIds: [], ticketIds: ['007'] }],
      [
        {
          kind:     'review-bar-started',
          taskId:   7,
          ticketId: '004',
          fields:   { name: 'Review 1 #004 — compare with #005' },
        },
        { taskIds: [7], ticketIds: ['004'] },
      ],
      [
        {
          kind:     'review-bar-closed',
          taskId:   13,
          ticketId: '005',
          fields:   { name: 'Example review pass' },
        },
        { taskIds: [13], ticketIds: ['005'] },
      ],
      [{ kind: 'chart-range-set', fields: { view: { kind: 'auto' } } }, { taskIds: [], ticketIds: [] }],
      [{ kind: 'concurrency-limit-set', fields: { limit: 3 } }, { taskIds: [], ticketIds: [] }],
      [{ kind: 'overseer-set', fields: { state: 'running' } }, { taskIds: [], ticketIds: [] }],
      [{ kind: 'dispatcher-set', fields: { state: 'running', runId: 'example-run' } }, { taskIds: [], ticketIds: [] }],
      [{ kind: 'check-command-set', fields: { command: 'bun run example-checks' } }, { taskIds: [], ticketIds: [] }],
      [{ kind: 'tracker-cleared', fields: {} }, { taskIds: [], ticketIds: [] }],
      [
        {
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
        { taskIds: [], ticketIds: [] },
      ],
    ];

    expect(new Set(idsForRecord.map(([record]) => record.kind)).size, 'the table covers every kind but the note').toBe(RECORD_KIND_COUNT - 1);
    for (const [content, expectedIds] of idsForRecord) {
      const identified = identifiedEntryOf({ ...content, at });
      expect({ taskIds: identified.taskIds, ticketIds: identified.ticketIds }, content.kind).toEqual(expectedIds);
    }
  });

  // A line with no id key is the one the detail panel still matches by its words, so a note must reach the page without one.
  test('gives a note exactly the stamp and the sentence', () => {
    const note: LogRecord = { at, kind: 'note', fields: { text: 'Ticket #001 looks done' } };

    expect(Object.keys(identifiedEntryOf(note))).toEqual(['at', 'text']);
  });

  test('words a record exactly as the entry status prints', () => {
    for (const [content] of SENTENCE_FOR_RECORD) {
      const record: LogRecord = { ...content, at };
      const identified        = identifiedEntryOf(record);

      expect({ at: identified.at, text: identified.text }, content.kind).toEqual(wordedEntryOf(record));
    }
  });
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

// No earlier binary logged these, so their wording is this suite's own; an opening is claimed by its tickets, every other record by none.
describe('decisions, incidents and triage', () => {
  const SENTENCE_AND_TICKET_IDS_FOR_RECORD: readonly (readonly [LogRecordContent, string, readonly string[]])[] = [
    [{ kind: 'ticket-triaged', ticketId: '004', fields: {} }, 'Ticket #004 put to the user\'s low-priority triage', ['004']],
    [
      { kind: 'worktree-repaired', ticketId: '004', fields: { step: 'recreate', patchPath: '/example-agency/jobs/J2/recreate-1.patch' } },
      'Worktree of #004 repaired: recreate, its changes saved to /example-agency/jobs/J2/recreate-1.patch',
      ['004'],
    ],
    [
      { kind: 'decision-opened', decisionId: 'E3', fields: { kind: 'agent-question', ticketIds: ['001', '002'] } },
      'Decision E3 opened: agent-question for #001, #002',
      ['001', '002'],
    ],
    [{ kind: 'decision-opened', decisionId: 'E4', fields: { kind: 'outage', ticketIds: [] } }, 'Decision E4 opened: outage', []],
    [
      { kind: 'decision-answered', decisionId: 'E3', fields: { answer: { 'Ship it?': 'Yes', 'Which "columns"?': 'Name, Total' } } },
      'Decision E3 answered: "Ship it?": "Yes"; "Which \\"columns\\"?": "Name, Total"',
      [],
    ],
    [{ kind: 'decision-withdrawn', decisionId: 'E3', fields: { reason: 'job stopped' } }, 'Decision E3 withdrawn: job stopped', []],
    [
      { kind: 'incident-opened', incidentId: 'I2', fields: { kind: 'malformed-ticket', ticketIds: ['001'] } },
      'Incident I2 opened: malformed-ticket for #001',
      ['001'],
    ],
    [{ kind: 'incident-handled', incidentId: 'I2', fields: { move: 'job-fresh' } }, 'Incident I2 handled by job-fresh', []],
    [
      { kind: 'incident-defaulted', incidentId: 'I2', fields: { move: 'merge-abort', cause: 'turn-closed' } },
      'Incident I2 took its default, merge-abort, when its delivery turn closed',
      [],
    ],
    [
      { kind: 'incident-defaulted', incidentId: 'I2', fields: { move: 'job-fresh', cause: 'turn-budget' } },
      'Incident I2 took its default, job-fresh, when its delivery turn reached its call budget',
      [],
    ],
    [
      { kind: 'incident-defaulted', incidentId: 'I2', fields: { move: 'ticket-park', cause: 'no-assistant' } },
      'Incident I2 took its default, ticket-park, while no orchestrator could come up',
      [],
    ],
    [{ kind: 'incident-escalated', incidentId: 'I2', fields: { decisionId: 'E5' } }, 'Incident I2 escalated to the user as decision E5', []],
  ];

  test.each(SENTENCE_AND_TICKET_IDS_FOR_RECORD)('%o reads as its sentence and is claimed by its tickets', (content, sentence, ticketIds) => {
    const identified = identifiedEntryOf({ ...content, at: '2026-09-18T20:11:03+02:00' });
    expect(identified.text).toBe(sentence);
    expect(identified.ticketIds).toEqual([...ticketIds]);
  });
});

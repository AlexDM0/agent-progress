/**
 * agent-dashboard's `GET /api/summary` document. What matters: `summaryOf` answers `summaryVersion: 1` in exactly the shape
 * `testing/fixtures/summary-v1.json` holds, so a change to the shape agent-dashboard reads fails here. A new shape is a new version and a
 * new fixture, never an edit of this one.
 */
import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';

import { BoardStateAssembly, type BoardState } from './BoardState.ts';

const SUMMARY_FIXTURE_PATH = join(import.meta.dir, 'testing', 'fixtures', 'summary-v1.json');

const EXAMPLE_STATE = {
  ticketCountByStatus: { pending: 1, 'in-progress': 1 },
  page:                { payload: {}, tickets: [] },
  jobs:                [{
    id: 'J1', kind: 'build', ticketIds: ['001'], state: 'running', role: 'builder', attempt: 1, live: { tokens: 1200, toolCalls: 4 }
  }],
  decisions:  [{ id: 'D1' }],
  incidents:  [],
  notices:    [{ kind: 'new-code' }],
  mergeQueue: { queuedTicketIds: [], slots: [] },
  overseer:   {
    state: 'serving', paused: false, url: 'http://127.0.0.1:4100/', generation: 2, codeVersion: 'code-example', installVersion: 17, handoverWarning: null
  },
  usage: { resetsAt: null, window: null },
} as unknown as BoardState;

describe('BoardStateAssembly.questionHistoryOf', () => {
  test('keeps every decision and incident record, ticket-triaged, and the records of session jobs alone', () => {
    const at = '2026-10-29T20:00:00+01:00';
    const records = [
      {
        kind:   'job-launched',
        at,
        jobId:  'J1',
        fields: {
          kind: 'build', role: 'builder', ticketIds: ['001'], attempt: 1, target: 'main', parentJobId: null
        }
      },
      {
        kind:   'job-launched',
        at,
        jobId:  'J2',
        fields: {
          kind: 'product-owner', role: 'product-owner', ticketIds: [], attempt: 1, target: null, parentJobId: null
        }
      },
      {
        kind: 'job-ended', at, jobId: 'J1', fields: { outcome: 'built' }
      },
      {
        kind: 'job-ended', at, jobId: 'J2', fields: { outcome: 'closed' }
      },
      {
        kind: 'decision-answered', at, decisionId: 'E1', fields: { answer: { 'Which?': 'Both' } }
      },
      {
        kind: 'incident-defaulted', at, incidentId: 'I1', fields: { move: 'ticket-triage', cause: 'turn-closed' }
      },
      {
        kind: 'ticket-triaged', at, ticketId: '004', fields: {}
      },
      {
        kind: 'ticket-readied', at, ticketId: '005', fields: {}
      },
    ] as unknown as Parameters<typeof BoardStateAssembly.questionHistoryOf>[0];
    expect(BoardStateAssembly.questionHistoryOf(records).map((record) => record.kind)).toEqual([
      'job-launched', 'job-ended', 'decision-answered', 'incident-defaulted', 'ticket-triaged'
    ]);
  });
});

describe('BoardStateAssembly.endedJobsOf', () => {
  test('answers each ended job with its launch and newest ending, oldest first, a reopened job once in its newest ending\'s place', () => {
    const records = [
      {
        kind:   'job-launched',
        at:     '2026-10-29T20:00:00+01:00',
        jobId:  'J1',
        fields: {
          kind: 'orchestrator', role: 'orchestrator', ticketIds: [], attempt: 1, target: null, parentJobId: null
        }
      },
      {
        kind:   'job-launched',
        at:     '2026-10-29T20:00:01+01:00',
        jobId:  'J5',
        fields: {
          kind: 'merge', role: null, ticketIds: ['001'], attempt: 1, target: 'main', parentJobId: null
        }
      },
      {
        kind: 'job-ended', at: '2026-10-29T20:00:02+01:00', jobId: 'J1', fields: { outcome: 'stopped', cause: 'runner-stopped' }
      },
      {
        kind: 'job-ended', at: '2026-10-29T20:00:03+01:00', jobId: 'J5', fields: { outcome: 'landed', commit: 'c0ffee' }
      },
      {
        kind: 'job-ended', at: '2026-10-29T20:00:04+01:00', jobId: 'J1', fields: { outcome: 'stopped' }
      },
    ] as unknown as Parameters<typeof BoardStateAssembly.endedJobsOf>[0];
    expect(BoardStateAssembly.endedJobsOf(records)).toEqual([
      {
        id: 'J5', kind: 'merge', role: null, ticketIds: ['001'], target: 'main', attempt: 1, state: 'ended', outcome: 'landed', cause: null, endedAt: '2026-10-29T20:00:03+01:00'
      },
      {
        id:        'J1',
        kind:      'orchestrator',
        role:      'orchestrator',
        ticketIds: [],
        target:    null,
        attempt:   1,
        state:     'ended',
        outcome:   'stopped',
        cause:     null,
        endedAt:   '2026-10-29T20:00:04+01:00'
      },
    ]);
  });
});

describe('BoardStateAssembly.summaryOf', () => {
  test('answers summaryVersion 1 exactly as the fixture holds it', () => {
    const fixture: unknown = JSON.parse(readFileSync(SUMMARY_FIXTURE_PATH, 'utf8'));
    expect(BoardStateAssembly.summaryOf(EXAMPLE_STATE, 'Example Agency', ['002'])).toEqual(fixture as ReturnType<typeof BoardStateAssembly.summaryOf>);
  });
});

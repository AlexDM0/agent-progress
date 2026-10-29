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

describe('BoardStateAssembly.summaryOf', () => {
  test('answers summaryVersion 1 exactly as the fixture holds it', () => {
    const fixture: unknown = JSON.parse(readFileSync(SUMMARY_FIXTURE_PATH, 'utf8'));
    expect(BoardStateAssembly.summaryOf(EXAMPLE_STATE, 'Example Agency', ['002'])).toEqual(fixture as ReturnType<typeof BoardStateAssembly.summaryOf>);
  });
});

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

const RECORD_KIND_COUNT = 44;

/**
 * Two kinds are logged twice: `draft-claimed`, plainly and as a forced takeover, since the two store different fields, and `draft-opened`,
 * since a closed draft cannot then be abandoned.
 */
const RECORD_COUNT = RECORD_KIND_COUNT + 2;

const FROZEN_STORED_LINES = [
  '{"at":"2026-09-26T10:15:00+02:00","kind":"note","fields":{"text":"Example note from the orchestrator"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-filed","ticketId":"003","fields":{"title":"Example search page"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-retitled","ticketId":"003","fields":{"from":"Example search page","to":"Example search results page"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-readied","ticketId":"003","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-priority-changed","ticketId":"001","fields":{"from":"normal","to":"high"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-size-changed","ticketId":"001","fields":{"to":"M"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-dependencies-set","ticketId":"002","fields":{"dependsOn":["001"]}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-agents-changed","ticketId":"001","fields":{"from":{"model":"opus","effort":"medium"},"to":{"model":"sonnet","effort":"high"}}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-held","ticketId":"001","fields":{"reason":"waiting on Example Agency"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-unheld","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-release-marked","ticketId":"002","fields":{"group":"example-shop"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-release-cleared","ticketId":"002","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"epic-added","epicKey":"example-checkout","fields":{"title":"Example checkout redesign"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"epic-edited","epicKey":"example-checkout","fields":{"title":"Example checkout overhaul"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"epic-removed","epicKey":"example-checkout","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-epics-set","ticketId":"002","fields":{"epics":[]}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-opened","draftId":"D1","fields":{"title":"Example export","owner":"opus"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-released","draftId":"D1","fields":{"owner":"opus"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-claimed","draftId":"D1","fields":{"owner":"opus"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-claimed","draftId":"D1","fields":{"owner":"example-session","takenFrom":"opus"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-note-added","draftId":"D1","fields":{"noteId":"N1","noteKind":"fact"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-question-asked","draftId":"D1","fields":{"questionId":"Q1"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-question-answered","draftId":"D1","fields":{"questionId":"Q1","answer":"a"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-item-dropped","draftId":"D1","fields":{"itemId":"N1"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-closed","draftId":"D1","fields":{"ticketIds":["003"]}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-opened","draftId":"D2","fields":{"title":"Example import","owner":"opus"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"draft-abandoned","draftId":"D2","fields":{"reason":"folded into D1"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-started","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"check-command-set","fields":{"command":"bun run example-checks"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-check-command-restamped","ticketId":"001","fields":{"command":"bun run example-checks"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-body-changed-after-claim","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-finished","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"review-bar-started","taskId":3,"ticketId":"001","fields":{"name":"Review 1 #001 — Example checkout page"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"review-recorded","taskId":3,"ticketId":"001","fields":{"round":1,"verdict":"round-requested",'
    + '"reviewStartCommit":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678","fixReworkedCodeLines":12,"rebaseReworkedCodeLines":4,"totalReworkedCodeLines":16,'
    + '"builderChangedFiles":3,"builderInsertions":120,"builderDeletions":8,"claims":[{"item":"A1","result":"holds","handoffContradicted":false}],'
    + '"findings":[{"class":"test-gap","severity":"quality","file":"src/example/ExampleCheckout.ts","summary":"The empty cart had no spec",'
    + '"evidence":"watched-fail","outcome":"fixed","commit":"b2c3d4e"},{"class":"out-of-scope","severity":"nit","file":"docs/example.md",'
    + '"summary":"An example sentence wraps late","evidence":"reading","outcome":"filed","filedTicketId":"004"}]}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-rereviewed","ticketId":"001","fields":{"round":2}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-approved","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"review-bar-closed","taskId":3,"ticketId":"001","fields":{"name":"Review 1 #001 — Example checkout page"}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-delivered","ticketId":"001","fields":{}}',
  '{"at":"2026-09-26T10:15:00+02:00","kind":"ticket-introduced-by-set","ticketId":"004","fields":{"introducedBy":"001"}}',
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

test('the scenario logs every record kind there is, two draft kinds twice and every other once', () => {
  const records = everyRecordKindTheBoardLogs(LOGGED_AT);
  expect(records.length).toBe(RECORD_COUNT);
  expect(new Set(records.map((record) => record.kind)).size).toBe(RECORD_KIND_COUNT);
});

test('every record the Board logs is stored byte for byte as the frozen table says', () => {
  expect(storedLinesOf(everyRecordKindTheBoardLogs(LOGGED_AT))).toEqual(FROZEN_STORED_LINES);
});

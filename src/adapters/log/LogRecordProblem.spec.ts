/**
 * What the log ingestion believes. Every kind the Board logs must pass, so the records come from the Board's own changes and must cover the
 * whole schema; every id and field of every kind must be refused by name when malformed, because the reason is all a person repairing the
 * file sees, and that sweep is derived from the schema so a new kind is held without a line here. One exact reason per field shape pins the
 * wording. `constructor` is refused as a kind because it is a property of every object, and a review bar's task id follows a row's id rule.
 */
import { describe, expect, test } from 'bun:test';

import type { LogRecord, LogRecordKind }                  from '../../lib/tracker-model/@types/LogRecord.ts';
import { DECISION_KINDS, INCIDENT_KINDS, INCIDENT_MOVES } from '../../lib/tracker-model/constants/DecisionAndIncidentVocabulary.ts';
import { LOG_RECORD_SCHEMA, LOG_RECORD_SUBJECT_IDS }      from '../../lib/tracker-model/constants/LogRecordSchema.ts';
import { everyRecordKindTheBoardLogs }                    from '../../testing/EveryBoardLogRecord.ts';
import { logRecordProblemOf }                             from './LogRecordProblem.ts';

const RECORDED_AT = '2026-09-18T21:30:54+02:00';

// The retired kinds nothing logs any more, as the retired `checks` verb stored them, so a log holding them is held to still read.
const RETIRED_RECORDS: readonly LogRecord[] = [
  { at: RECORDED_AT, kind: 'check-command-set', fields: { command: 'bun run example-checks' } },
  {
    at: RECORDED_AT, kind: 'ticket-check-command-restamped', ticketId: '001', fields: { command: 'bun run example-checks' }
  },
  { at: RECORDED_AT, kind: 'install-command-set', fields: { command: 'bun install --frozen-lockfile' } },
  { at: RECORDED_AT, kind: 'checks-definition-files-set', fields: { patterns: ['pyproject.toml'] } },
  { at: RECORDED_AT, kind: 'gate-key-command-set', fields: { command: 'bun --version' } },
  { at: RECORDED_AT, kind: 'gate-cache-paths-set', fields: { paths: ['~/.bun/install/cache'] } },
];

const RECORDS_THE_BOARD_LOGS = [...everyRecordKindTheBoardLogs(RECORDED_AT), ...RETIRED_RECORDS];

// No field shape accepts an empty object, and an agent pair names its missing model.
const MALFORMED_VALUE = {};

function loggedRecordOf(kind: LogRecordKind): LogRecord {
  const record = RECORDS_THE_BOARD_LOGS.find((logged) => logged.kind === kind);
  if (record === undefined) throw new Error(`the Board logs no ${kind} record`);
  return record;
}

function withFields(kind: LogRecordKind, fields: Record<string, unknown>): Record<string, unknown> {
  const logged = loggedRecordOf(kind);
  return { ...logged, fields: { ...logged.fields, ...fields } };
}

function withKeys(kind: LogRecordKind, keys: Record<string, unknown>): Record<string, unknown> {
  return { ...loggedRecordOf(kind), ...keys };
}

const EXACT_REASONS: readonly (readonly [string, Record<string, unknown>, string])[] = [
  ['text', withFields('ticket-retitled', { to: null }), 'fields.to is not a string'],
  ['optional text', withFields('agent-stopped', { agentLabel: null }), 'fields.agentLabel is not a string'],
  ['priority', withFields('ticket-priority-changed', { to: 'urgent' }), 'fields.to is "urgent", which is not one of low, normal, high'],
  ['ticket size', withFields('ticket-size-changed', { to: 'm' }), 'fields.to is "m", which is not one of XS, S, M, L, XL, XXL'],
  ['optional ticket size', withFields('ticket-size-changed', { from: 'm' }), 'fields.from is "m", which is not one of XS, S, M, L, XL, XXL'],
  ['agent pair', withFields('ticket-agents-changed', { from: { model: 'gpt', effort: 'low' } }), 'fields.from.model is "gpt", which is not a known model'],
  ['agent pair effort', withFields('ticket-agents-changed', { to: { model: 'opus', effort: 'extreme' } }), 'fields.to.effort is "extreme", which is not a known effort'],
  ['ticket ids', withFields('ticket-dependencies-set', { dependsOn: ['001', 2] }), 'fields.dependsOn is not a list of ticket ids'],
  ['epic keys', withFields('ticket-epics-set', { epics: 'example-checkout' }), 'fields.epics is not a list of epic keys'],
  ['review round', withFields('ticket-rereviewed', { round: 1 }), 'fields.round is not a whole round of at least 2'],
  ['chart range', withFields('chart-range-set', { view: { kind: 'absolute', from: '-2h' } }), 'fields.view is not a chart range'],
  ['concurrency limit', withFields('concurrency-limit-set', { limit: 0 }), 'fields.limit is not a whole number of agents'],
  ['dispatcher state', withFields('dispatcher-set', { state: 'paused' }), 'fields.state is "paused", which is not one of running, finished, stopped'],
  ['dispatcher run id', withFields('dispatcher-set', { runId: '  ' }), 'fields.runId is neither null nor a run id'],
  ['check command', withFields('check-command-set', { command: ' ' }), 'fields.command is neither null nor a shell line that is not blank'],
  ['count', withFields('agent-stopped', { cacheReadInputTokens: -1 }), 'fields.cacheReadInputTokens is not a whole number of at least 0'],
  ['decision kind', withFields('decision-opened', { kind: 'first-run' }), `fields.kind is "first-run", which is not one of ${DECISION_KINDS.join(', ')}`],
  ['decision answer', withFields('decision-answered', { answer: { 'Ship it?': 1 } }), 'fields.answer is not an object of at least one answer keyed by its question'],
  ['empty decision answer', withFields('decision-answered', { answer: {} }), 'fields.answer is not an object of at least one answer keyed by its question'],
  ['incident kind', withFields('incident-opened', { kind: 'outage' }), `fields.kind is "outage", which is not one of ${INCIDENT_KINDS.join(', ')}`],
  ['incident move', withFields('incident-handled', { move: 'ticket-waive' }), `fields.move is "ticket-waive", which is not one of ${INCIDENT_MOVES.join(', ')}`],
  ['incident default cause', withFields('incident-defaulted', { cause: 'timeout' }), 'fields.cause is "timeout", which is not one of turn-closed, turn-budget, no-orchestrator'],
  ['decision id', withKeys('decision-answered', { decisionId: 7 }), 'decisionId is not a string'],
  ['incident id', withKeys('incident-escalated', { incidentId: null }), 'incidentId is not a string'],
  ['ticket id', withKeys('ticket-started', { ticketId: null }), 'ticketId is not a string'],
  ['epic key', withKeys('epic-edited', { epicKey: null }), 'epicKey is not a string'],
  ['task id', withKeys('review-bar-started', { taskId: 7.5 }), 'taskId is not a whole number'],
];

describe('a well-formed record', () => {
  test('the Board logs a record of every kind the schema knows', () => {
    expect(new Set(RECORDS_THE_BOARD_LOGS.map((record) => record.kind))).toEqual(new Set(Object.keys(LOG_RECORD_SCHEMA) as LogRecordKind[]));
  });

  test('every record the Board logs passes', () => {
    for (const record of RECORDS_THE_BOARD_LOGS) expect(logRecordProblemOf(record), record.kind).toBeNull();
  });

  test('a dispatcher record with no run passes, because a stopped dispatcher has none', () => {
    expect(logRecordProblemOf(withFields('dispatcher-set', { state: 'stopped', runId: null }))).toBeNull();
  });

  test('a check command record with no command passes, because a cleared setting has none', () => {
    expect(logRecordProblemOf(withFields('check-command-set', { command: null }))).toBeNull();
  });

  test('an agent stop naming its workflow run and label passes', () => {
    expect(logRecordProblemOf(withFields('agent-stopped', { workflowRunId: 'wf_example', agentLabel: 'build #7' }))).toBeNull();
  });

  test('a review bar on task 0 passes, as a row with id 0 reads', () => {
    expect(logRecordProblemOf(withKeys('review-bar-started', { taskId: 0 }))).toBeNull();
  });

  test('keys no kind knows are no reason to refuse a record', () => {
    expect(logRecordProblemOf({ ...loggedRecordOf('note'), source: 'a newer build' })).toBeNull();
  });
});

describe('a malformed record', () => {
  test('every id and every field of every kind is refused by name when malformed', () => {
    let checkedCount = 0;
    for (const record of RECORDS_THE_BOARD_LOGS) {
      const { subject, fields } = LOG_RECORD_SCHEMA[record.kind];
      for (const idKey of Object.keys(LOG_RECORD_SUBJECT_IDS[subject])) {
        expect(logRecordProblemOf(withKeys(record.kind, { [idKey]: MALFORMED_VALUE })), `${record.kind} ${idKey}`).toStartWith(`${idKey} is `);
        checkedCount += 1;
      }
      for (const name of Object.keys(fields)) {
        const reason = logRecordProblemOf(withFields(record.kind, { [name]: MALFORMED_VALUE }));
        expect(reason, `${record.kind} ${name}`).toMatch(new RegExp(`^fields\\.${name}[ .]`));
        checkedCount += 1;
      }
    }
    expect(checkedCount).toBeGreaterThan(RECORDS_THE_BOARD_LOGS.length);
  });

  test.each(EXACT_REASONS)('a malformed %s is refused with its own reason', (_shape, record, reason) => {
    expect(logRecordProblemOf(record)).toBe(reason);
  });

  test('a value that is not an object is refused', () => {
    expect(logRecordProblemOf(['note'])).toBe('it is not an object');
    expect(logRecordProblemOf(null)).toBe('it is not an object');
    expect(logRecordProblemOf('Example note')).toBe('it is not an object');
  });

  test('a record without a timestamp is refused naming at', () => {
    expect(logRecordProblemOf(withKeys('note', { at: 1_700_000_000 }))).toBe('at is not a string');
  });

  test('an unknown kind is refused, and so is constructor, which every object carries', () => {
    expect(logRecordProblemOf(withKeys('note', { kind: 'ticket-done' }))).toBe('kind is "ticket-done", which is not a kind of log record');
    expect(logRecordProblemOf(withKeys('note', { kind: 'constructor' }))).toBe('kind is "constructor", which is not a kind of log record');
    expect(logRecordProblemOf(withKeys('note', { kind: undefined }))).toBe('kind is undefined, which is not a kind of log record');
  });

  test('a record whose fields are missing or not an object is refused naming fields', () => {
    expect(logRecordProblemOf(withKeys('note', { fields: undefined }))).toBe('fields is not an object');
    expect(logRecordProblemOf(withKeys('tracker-cleared', { fields: [] }))).toBe('fields is not an object');
  });
});

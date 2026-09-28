/**
 * What the log ingestion believes. Every kind the logger writes must pass, so the table holds one record per kind, as the logger builds
 * it, and is exact in both directions; every kind must refuse a malformed field by name, because the reason is all a person repairing the file sees.
 * `constructor` is refused as a kind because it is a property of every object, and a review bar's task id follows a row's id rule.
 */
import { describe, expect, test } from 'bun:test';

import type { AgentUsage, LogRecord } from '../../lib/tracker-model/@types/LogRecord.ts';
import type { AgentPair }             from '../../lib/tracker-model/@types/Ticket.ts';
import type { ViewRange }             from '../../lib/tracker-model/@types/TrackerProgress.ts';
import { createLogger }               from '../../lib/tracker-model/Logger.ts';
import { logRecordProblemOf }         from './LogRecordProblem.ts';

const RECORDED_AT = '2026-09-18T21:30:54+02:00';

const RECORD_KIND_COUNT = 21;

const REVIEW_BAR = { taskId: 7, ticketId: '001', fields: { name: 'Review 1 #001 — Example checkout flow' } };

const RELATIVE_VIEW: ViewRange = {
  kind:        'relative',
  from:        '-2h',
  to:          'now',
  tickMinutes: null,
};

const AGENT_USAGE: AgentUsage = {
  agentId:              'agent_example',
  agentType:            'general-purpose',
  apiCallCount:         2,
  endContextTokens:     6800,
  totalInputTokens:     11_000,
  cacheReadInputTokens: 8000,
  outputTokens:         1000,
};

const DEFAULT_AGENTS: AgentPair = { model: 'opus', effort: 'medium' };

const CHOSEN_AGENTS: AgentPair = { model: 'sonnet', effort: 'low' };

// Stamped by the logger itself, so every record is shaped as the Board's records reach log.jsonl.
const { log } = createLogger(() => {});

const WELL_FORMED_RECORD_FOR_KIND: Readonly<Record<LogRecord['kind'], LogRecord>> = {
  'note':                    log({ kind: 'note', fields: { text: 'Example note from the orchestrator' } }, RECORDED_AT),
  'ticket-filed':            log({ kind: 'ticket-filed', ticketId: '001', fields: { title: 'Example checkout flow' } }, RECORDED_AT),
  'ticket-reopened':         log({ kind: 'ticket-reopened', ticketId: '001', fields: {} }, RECORDED_AT),
  'ticket-started':          log({ kind: 'ticket-started', ticketId: '001', fields: {} }, RECORDED_AT),
  'ticket-finished':         log({ kind: 'ticket-finished', ticketId: '001', fields: {} }, RECORDED_AT),
  'ticket-approved':         log({ kind: 'ticket-approved', ticketId: '001', fields: {} }, RECORDED_AT),
  'ticket-delivered':        log({ kind: 'ticket-delivered', ticketId: '001', fields: {} }, RECORDED_AT),
  'ticket-abandoned':        log({ kind: 'ticket-abandoned', ticketId: '001', fields: { reason: 'superseded by #002' } }, RECORDED_AT),
  'ticket-rereviewed':       log({ kind: 'ticket-rereviewed', ticketId: '001', fields: { round: 2 } }, RECORDED_AT),
  'ticket-priority-changed': log({ kind: 'ticket-priority-changed', ticketId: '001', fields: { from: 'low', to: 'high' } }, RECORDED_AT),
  'ticket-dependencies-set': log({ kind: 'ticket-dependencies-set', ticketId: '002', fields: { dependsOn: ['001'] } }, RECORDED_AT),
  'ticket-agents-changed':   log({ kind: 'ticket-agents-changed', ticketId: '001', fields: { from: DEFAULT_AGENTS, to: CHOSEN_AGENTS } }, RECORDED_AT),
  'ticket-held':             log({ kind: 'ticket-held', ticketId: '001', fields: { reason: '' } }, RECORDED_AT),
  'ticket-unheld':           log({ kind: 'ticket-unheld', ticketId: '001', fields: {} }, RECORDED_AT),
  'review-bar-started':      log({ kind: 'review-bar-started', ...REVIEW_BAR }, RECORDED_AT),
  'review-bar-closed':       log({ kind: 'review-bar-closed', ...REVIEW_BAR }, RECORDED_AT),
  'chart-range-set':         log({ kind: 'chart-range-set', fields: { view: RELATIVE_VIEW } }, RECORDED_AT),
  'concurrency-limit-set':   log({ kind: 'concurrency-limit-set', fields: { limit: 3 } }, RECORDED_AT),
  'dispatcher-set':          log({ kind: 'dispatcher-set', fields: { state: 'running', runId: 'wf_example' } }, RECORDED_AT),
  'tracker-cleared':         log({ kind: 'tracker-cleared', fields: {} }, RECORDED_AT),
  'agent-stopped':           log({ kind: 'agent-stopped', fields: AGENT_USAGE }, RECORDED_AT),
};

function withFields(kind: LogRecord['kind'], fields: Record<string, unknown>): Record<string, unknown> {
  const wellFormed = WELL_FORMED_RECORD_FOR_KIND[kind];
  return { ...wellFormed, fields: { ...wellFormed.fields, ...fields } };
}

function withKeys(kind: LogRecord['kind'], keys: Record<string, unknown>): Record<string, unknown> {
  return { ...WELL_FORMED_RECORD_FOR_KIND[kind], ...keys };
}

const MALFORMED_RECORD_FOR_KIND: Readonly<Record<LogRecord['kind'], readonly [Record<string, unknown>, string]>> = {
  'note':                    [withFields('note', { text: 7 }), 'fields.text is not a string'],
  'ticket-filed':            [withFields('ticket-filed', { title: null }), 'fields.title is not a string'],
  'ticket-reopened':         [withKeys('ticket-reopened', { ticketId: 1 }), 'ticketId is not a string'],
  'ticket-started':          [withKeys('ticket-started', { ticketId: null }), 'ticketId is not a string'],
  'ticket-finished':         [withKeys('ticket-finished', { ticketId: undefined }), 'ticketId is not a string'],
  'ticket-approved':         [withKeys('ticket-approved', { ticketId: ['001'] }), 'ticketId is not a string'],
  'ticket-delivered':        [withKeys('ticket-delivered', { ticketId: 5 }), 'ticketId is not a string'],
  'ticket-abandoned':        [withFields('ticket-abandoned', { reason: false }), 'fields.reason is not a string'],
  'ticket-rereviewed':       [withFields('ticket-rereviewed', { round: 1 }), 'fields.round is not a whole round of at least 2'],
  'ticket-priority-changed': [withFields('ticket-priority-changed', { to: 'urgent' }), 'fields.to is "urgent", which is not one of low, normal, high'],
  'ticket-dependencies-set': [withFields('ticket-dependencies-set', { dependsOn: ['001', 2] }), 'fields.dependsOn is not a list of ticket ids'],
  'ticket-agents-changed':   [withFields('ticket-agents-changed', { from: { model: 'gpt', effort: 'low' } }), 'fields.from.model is "gpt", which is not a known model'],
  'ticket-held':             [withFields('ticket-held', { reason: undefined }), 'fields.reason is not a string'],
  'ticket-unheld':           [withKeys('ticket-unheld', { ticketId: {} }), 'ticketId is not a string'],
  'review-bar-started':      [withKeys('review-bar-started', { taskId: 7.5 }), 'taskId is not a whole number'],
  'review-bar-closed':       [withFields('review-bar-closed', { name: 42 }), 'fields.name is not a string'],
  'chart-range-set':         [withFields('chart-range-set', { view: { kind: 'absolute', from: '-2h' } }), 'fields.view is not a chart range'],
  'concurrency-limit-set':   [withFields('concurrency-limit-set', { limit: 0 }), 'fields.limit is not a whole number of agents'],
  'dispatcher-set':          [withFields('dispatcher-set', { runId: '  ' }), 'fields.runId is neither null nor a run id'],
  'tracker-cleared':         [withKeys('tracker-cleared', { fields: [] }), 'fields is not an object'],
  'agent-stopped':           [withFields('agent-stopped', { cacheReadInputTokens: -1 }), 'fields.cacheReadInputTokens is not a whole number of at least 0'],
};

describe('a well-formed record', () => {
  test('the table holds one record for each of the 21 kinds, each under its own kind', () => {
    const entries = Object.entries(WELL_FORMED_RECORD_FOR_KIND);
    expect(entries).toHaveLength(RECORD_KIND_COUNT);
    for (const [kind, record] of entries) expect(record.kind).toBe(kind as LogRecord['kind']);
  });

  test('every kind the logger writes passes', () => {
    for (const record of Object.values(WELL_FORMED_RECORD_FOR_KIND)) expect(logRecordProblemOf(record), record.kind).toBeNull();
  });

  test('a dispatcher record with no run passes, because a stopped dispatcher has none', () => {
    expect(logRecordProblemOf(withFields('dispatcher-set', { state: 'stopped', runId: null }))).toBeNull();
  });

  test('a review bar on task 0 passes, as a row with id 0 reads', () => {
    expect(logRecordProblemOf(withKeys('review-bar-started', { taskId: 0 }))).toBeNull();
  });

  test('keys no kind knows are no reason to refuse a record', () => {
    expect(logRecordProblemOf({ ...WELL_FORMED_RECORD_FOR_KIND.note, source: 'a newer build' })).toBeNull();
  });
});

describe('a malformed record', () => {
  test('every kind refuses a malformed field and names it', () => {
    expect(Object.keys(MALFORMED_RECORD_FOR_KIND)).toHaveLength(RECORD_KIND_COUNT);
    for (const [kind, [record, reason]] of Object.entries(MALFORMED_RECORD_FOR_KIND)) expect(logRecordProblemOf(record), kind).toBe(reason);
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

  test('a record whose fields are missing is refused naming fields', () => {
    expect(logRecordProblemOf(withKeys('note', { fields: undefined }))).toBe('fields is not an object');
  });
});

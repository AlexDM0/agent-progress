/**
 * What the Board tells the log, one method per kind of event. `createLogger` is the only implementation: each call becomes one
 * `LogRecord` for the sink, and what the sink stores (a file, a test's list, nothing) is the sink's decision.
 */
import type {
  AgentUsage,
  LogRecord,
  LogRecordContent,
  ReviewBarReference
} from './@types/LogRecord.ts';
import type { DispatcherState, ViewRange } from './@types/ProgressFile.ts';
import type { AgentPair, TicketPriority }  from './@types/Ticket.ts';

export interface Logger {
  note(text: string, at: string): LogRecord;
  ticketFiled(ticketId: string, title: string, at: string): LogRecord;
  ticketReopened(ticketId: string, at: string): LogRecord;
  ticketStarted(ticketId: string, at: string): LogRecord;
  ticketFinished(ticketId: string, at: string): LogRecord;
  ticketApproved(ticketId: string, at: string): LogRecord;
  ticketDelivered(ticketId: string, at: string): LogRecord;
  ticketAbandoned(ticketId: string, reason: string, at: string): LogRecord;
  ticketRereviewed(ticketId: string, round: number, at: string): LogRecord;
  ticketPriorityChanged(ticketId: string, change: { from: TicketPriority; to: TicketPriority }, at: string): LogRecord;
  ticketDependenciesSet(ticketId: string, dependsOn: readonly string[], at: string): LogRecord;
  ticketAgentsChanged(ticketId: string, change: { from: AgentPair; to: AgentPair }, at: string): LogRecord;
  ticketHeld(ticketId: string, reason: string, at: string): LogRecord;
  ticketUnheld(ticketId: string, at: string): LogRecord;
  reviewBarStarted(bar: ReviewBarReference, at: string): LogRecord;
  reviewBarClosed(bar: ReviewBarReference, at: string): LogRecord;
  chartRangeSet(view: ViewRange, at: string): LogRecord;
  concurrencyLimitSet(limit: number, at: string): LogRecord;
  dispatcherSet(state: DispatcherState, runId: string | null, at: string): LogRecord;
  trackerCleared(at: string): LogRecord;
  agentStopped(usage: AgentUsage, at: string): LogRecord;
}

function reviewBarContentOf(kind: 'review-bar-started' | 'review-bar-closed', bar: ReviewBarReference): LogRecordContent {
  return {
    kind,
    taskId:   bar.taskId,
    ticketId: bar.ticketId,
    fields:   { name: bar.name },
  };
}

export function createLogger(sink: (record: LogRecord) => void): Logger {
  function handToTheSink(content: LogRecordContent, at: string): LogRecord {
    const record: LogRecord = { at, ...content };
    sink(record);
    return record;
  }

  return {
    note:                  (text, at) => handToTheSink({ kind: 'note', fields: { text } }, at),
    ticketFiled:           (ticketId, title, at) => handToTheSink({ kind: 'ticket-filed', ticketId, fields: { title } }, at),
    ticketReopened:        (ticketId, at) => handToTheSink({ kind: 'ticket-reopened', ticketId, fields: {} }, at),
    ticketStarted:         (ticketId, at) => handToTheSink({ kind: 'ticket-started', ticketId, fields: {} }, at),
    ticketFinished:        (ticketId, at) => handToTheSink({ kind: 'ticket-finished', ticketId, fields: {} }, at),
    ticketApproved:        (ticketId, at) => handToTheSink({ kind: 'ticket-approved', ticketId, fields: {} }, at),
    ticketDelivered:       (ticketId, at) => handToTheSink({ kind: 'ticket-delivered', ticketId, fields: {} }, at),
    ticketAbandoned:       (ticketId, reason, at) => handToTheSink({ kind: 'ticket-abandoned', ticketId, fields: { reason } }, at),
    ticketRereviewed:      (ticketId, round, at) => handToTheSink({ kind: 'ticket-rereviewed', ticketId, fields: { round } }, at),
    ticketPriorityChanged: (ticketId, { from, to }, at) => handToTheSink({ kind: 'ticket-priority-changed', ticketId, fields: { from, to } }, at),
    ticketDependenciesSet: (ticketId, dependsOn, at) => handToTheSink({ kind: 'ticket-dependencies-set', ticketId, fields: { dependsOn } }, at),
    ticketAgentsChanged:   (ticketId, { from, to }, at) => handToTheSink({ kind: 'ticket-agents-changed', ticketId, fields: { from, to } }, at),
    ticketHeld:            (ticketId, reason, at) => handToTheSink({ kind: 'ticket-held', ticketId, fields: { reason } }, at),
    ticketUnheld:          (ticketId, at) => handToTheSink({ kind: 'ticket-unheld', ticketId, fields: {} }, at),
    reviewBarStarted:      (bar, at) => handToTheSink(reviewBarContentOf('review-bar-started', bar), at),
    reviewBarClosed:       (bar, at) => handToTheSink(reviewBarContentOf('review-bar-closed', bar), at),
    chartRangeSet:         (view, at) => handToTheSink({ kind: 'chart-range-set', fields: { view } }, at),
    concurrencyLimitSet:   (limit, at) => handToTheSink({ kind: 'concurrency-limit-set', fields: { limit } }, at),
    dispatcherSet:         (state, runId, at) => handToTheSink({ kind: 'dispatcher-set', fields: { state, runId } }, at),
    trackerCleared:        (at) => handToTheSink({ kind: 'tracker-cleared', fields: {} }, at),
    agentStopped:          (usage, at) => handToTheSink({ kind: 'agent-stopped', fields: usage }, at),
  };
}

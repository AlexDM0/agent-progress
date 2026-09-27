/**
 * Words the Board's log records as sentences, so entries written by any version of the tool read alike: `status` through `wordedEntryOf`,
 * the page through `identifiedEntryOf`, which also carries every task and ticket id the record concerns, so a detail panel never reads ids
 * out of the sentence.
 */
import type { AgentUsage, LogRecord, LogRecordContent } from '../../lib/tracker-model/@types/LogRecord.ts';
import type { DispatcherState, ViewRange }              from '../../lib/tracker-model/@types/TrackerProgress.ts';
import { TokenCountUtil }                               from '../../lib/utils/TokenCountUtil.ts';
import type { IdentifiedLogEntry, WordedLogEntry }      from '../../shared/@types/WordedLogEntry.ts';
import type { MovedToStatus }                           from './StatusWordingUtil.ts';
import { StatusWordingUtil }                            from './StatusWordingUtil.ts';
import { TicketPhraseUtil }                             from './TicketPhraseUtil.ts';

type TicketMoveKind = 'ticket-reopened' | 'ticket-started' | 'ticket-finished' | 'ticket-approved' | 'ticket-delivered';

const STATUS_REACHED_BY_MOVE_KIND: Readonly<Record<TicketMoveKind, MovedToStatus>> = {
  'ticket-reopened':  'pending',
  'ticket-started':   'in-progress',
  'ticket-finished':  'in-review',
  'ticket-approved':  'reviewed',
  'ticket-delivered': 'delivered',
};

function dispatcherStateTextOf(state: DispatcherState, runId: string | null): string {
  return runId === null ? state : `${state} (run ${runId})`;
}

function chartRangeTextOf(view: ViewRange): string {
  if (view.kind === 'auto') return 'automatic';
  const tick = view.tickMinutes === null ? '' : ` (tick ${view.tickMinutes}m)`;
  return `${view.from} → ${view.to}${tick}`;
}

/**
 * Formatted through `src/lib/utils/TokenCountUtil.ts`, so the log and the chart's token column read in the same units. The cache-read
 * share is named beside the whole input because it is the figure that explains a long session and is invisible in a plain total.
 */
function agentStoppedTextOf(usage: AgentUsage): string {
  return `Agent ${usage.agentId} (${usage.agentType}) stopped: ${usage.apiCallCount} calls, `
    + `end context ${TokenCountUtil.formatTokenCount(usage.endContextTokens)}, `
    + `input ${TokenCountUtil.formatTokenCount(usage.totalInputTokens)} (cache read ${TokenCountUtil.formatTokenCount(usage.cacheReadInputTokens)}), `
    + `output ${TokenCountUtil.formatTokenCount(usage.outputTokens)}`;
}

function sentenceOf(record: LogRecordContent): string {
  switch (record.kind) {
    case 'note':
      return record.fields.text;
    case 'ticket-filed':
      return `Ticket #${record.ticketId} filed: ${record.fields.title}`;
    case 'ticket-reopened':
    case 'ticket-started':
    case 'ticket-finished':
    case 'ticket-approved':
    case 'ticket-delivered':
      return `Ticket #${record.ticketId} ${StatusWordingUtil.movedPhraseFor(STATUS_REACHED_BY_MOVE_KIND[record.kind])}`;
    case 'ticket-abandoned':
      return `Ticket #${record.ticketId} abandoned: ${record.fields.reason}`;
    case 'ticket-rereviewed':
      return `Ticket #${record.ticketId} ${StatusWordingUtil.movedPhraseFor('in-review')}, round ${record.fields.round}`;
    case 'ticket-priority-changed':
      return `Ticket #${record.ticketId} priority ${record.fields.from} → ${record.fields.to}`;
    case 'ticket-dependencies-set': {
      const { dependsOn } = record.fields;
      return dependsOn.length === 0
        ? `Ticket #${record.ticketId} waits on no other ticket`
        : `Ticket #${record.ticketId} waits on ${TicketPhraseUtil.ticketReferencesText(dependsOn)}`;
    }
    case 'ticket-agents-changed':
      return `Ticket #${record.ticketId} agents ${TicketPhraseUtil.agentPairText(record.fields.from)} → ${TicketPhraseUtil.agentPairText(record.fields.to)}`;
    case 'ticket-held':
      return record.fields.reason === '' ? `Ticket #${record.ticketId} held` : `Ticket #${record.ticketId} held: ${record.fields.reason}`;
    case 'ticket-unheld':
      return `Ticket #${record.ticketId} unheld`;
    case 'review-bar-started':
      return `Review row #${record.taskId} started: ${record.fields.name}`;
    case 'review-bar-closed':
      return `Closed the review row #${record.taskId}, delivered: ${record.fields.name}`;
    case 'chart-range-set':
      return `Chart range: ${chartRangeTextOf(record.fields.view)}`;
    case 'concurrency-limit-set':
      return `Concurrency limit set to ${record.fields.limit}`;
    case 'dispatcher-set':
      return `Dispatcher set to ${dispatcherStateTextOf(record.fields.state, record.fields.runId)}`;
    case 'tracker-cleared':
      return 'Tracker cleared';
    case 'agent-stopped':
      return agentStoppedTextOf(record.fields);
  }
}

function wordedEntryOf(record: LogRecord): WordedLogEntry {
  return { at: record.at, text: sentenceOf(record) };
}

function taskIdsConcernedBy(record: LogRecordContent): number[] {
  switch (record.kind) {
    case 'review-bar-started':
    case 'review-bar-closed':
      return [record.taskId];
    case 'note':
    case 'ticket-filed':
    case 'ticket-reopened':
    case 'ticket-started':
    case 'ticket-finished':
    case 'ticket-approved':
    case 'ticket-delivered':
    case 'ticket-abandoned':
    case 'ticket-rereviewed':
    case 'ticket-priority-changed':
    case 'ticket-dependencies-set':
    case 'ticket-agents-changed':
    case 'ticket-held':
    case 'ticket-unheld':
    case 'chart-range-set':
    case 'concurrency-limit-set':
    case 'dispatcher-set':
    case 'tracker-cleared':
    case 'agent-stopped':
      return [];
  }
}

function ticketIdsConcernedBy(record: LogRecordContent): string[] {
  switch (record.kind) {
    case 'ticket-dependencies-set':
      return [...new Set([record.ticketId, ...record.fields.dependsOn])];
    case 'review-bar-started':
    case 'review-bar-closed':
    case 'ticket-filed':
    case 'ticket-reopened':
    case 'ticket-started':
    case 'ticket-finished':
    case 'ticket-approved':
    case 'ticket-delivered':
    case 'ticket-abandoned':
    case 'ticket-rereviewed':
    case 'ticket-priority-changed':
    case 'ticket-agents-changed':
    case 'ticket-held':
    case 'ticket-unheld':
      return [record.ticketId];
    case 'note':
    case 'chart-range-set':
    case 'concurrency-limit-set':
    case 'dispatcher-set':
    case 'tracker-cleared':
    case 'agent-stopped':
      return [];
  }
}

function identifiedEntryOf(record: LogRecord): IdentifiedLogEntry {
  if (record.kind === 'note') {
    return wordedEntryOf(record);
  }
  return {
    ...wordedEntryOf(record),
    taskIds:   taskIdsConcernedBy(record),
    ticketIds: ticketIdsConcernedBy(record),
  };
}

export const LogUtil = {
  dispatcherStateTextOf,
  identifiedEntryOf,
  sentenceOf,
  wordedEntryOf,
} as const;

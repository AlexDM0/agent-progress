/**
 * Words the Board's log records as sentences, so entries written by any version of the tool read alike: `status` through `wordedEntryOf`,
 * the page through `identifiedEntryOf`, which also carries every task and ticket id the record concerns, so a detail panel never reads ids
 * out of the sentence.
 */
import { TokenCountUtil }                               from '../../lib/token-count/TokenCountUtil.ts';
import type { AgentUsage, LogRecord, LogRecordContent } from '../../lib/tracker-model/@types/LogRecord.ts';
import type { DispatcherState, ViewRange }              from '../../lib/tracker-model/@types/TrackerProgress.ts';
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
 * Formatted through `src/lib/token-count/TokenCountUtil.ts`, so the log and the chart's token column read in the same units. The cache-read
 * share is named beside the whole input because it is the figure that explains a long session and is invisible in a plain total.
 */
function agentStoppedTextOf(usage: AgentUsage): string {
  const label       = usage.agentLabel === undefined ? '' : ` "${usage.agentLabel}"`;
  const workflowRun = usage.workflowRunId === undefined ? '' : ` of workflow run ${usage.workflowRunId}`;
  return `Agent ${usage.agentId}${label} (${usage.agentType})${workflowRun} stopped: ${usage.apiCallCount} calls, `
    + `end context ${TokenCountUtil.formatTokenCount(usage.endContextTokens)}, `
    + `input ${TokenCountUtil.formatTokenCount(usage.totalInputTokens)} (cache read ${TokenCountUtil.formatTokenCount(usage.cacheReadInputTokens)}), `
    + `output ${TokenCountUtil.formatTokenCount(usage.outputTokens)}`;
}

function epicsText(epicKeys: readonly string[]): string {
  if (epicKeys.length === 0) return 'no epic';
  return `${epicKeys.length === 1 ? 'epic' : 'epics'} ${epicKeys.join(', ')}`;
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
    case 'ticket-retitled':
      return `Ticket #${record.ticketId} renamed: ${record.fields.from} → ${record.fields.to}`;
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
    case 'ticket-body-changed-after-claim':
      return `Ticket #${record.ticketId} body changed after its claim`;
    case 'ticket-release-marked':
      return `Ticket #${record.ticketId} marked as the release ticket of group ${record.fields.group}`;
    case 'ticket-release-cleared':
      return `Ticket #${record.ticketId} no longer marked as its group's release ticket`;
    case 'ticket-epics-set':
      return `Ticket #${record.ticketId} belongs to ${epicsText(record.fields.epics)}`;
    case 'ticket-check-command-restamped':
      return record.fields.command === null
        ? `Ticket #${record.ticketId} restamped with no check command`
        : `Ticket #${record.ticketId} restamped with the check command ${record.fields.command}`;
    case 'epic-added':
      return `Epic ${record.epicKey} added: ${record.fields.title}`;
    case 'epic-edited':
      return `Epic ${record.epicKey} edited: ${record.fields.title}`;
    case 'epic-removed':
      return `Epic ${record.epicKey} removed`;
    case 'draft-opened':
      return `Draft ${record.draftId} opened by ${record.fields.owner}: ${record.fields.title}`;
    case 'draft-claimed':
      return record.fields.takenFrom === undefined
        ? `Draft ${record.draftId} claimed by ${record.fields.owner}`
        : `Draft ${record.draftId} taken over by ${record.fields.owner} from ${record.fields.takenFrom}`;
    case 'draft-released':
      return `Draft ${record.draftId} released by ${record.fields.owner}`;
    case 'draft-closed':
      return `Draft ${record.draftId} closed into ${TicketPhraseUtil.ticketReferencesText(record.fields.ticketIds)}`;
    case 'draft-abandoned':
      return `Draft ${record.draftId} abandoned: ${record.fields.reason}`;
    case 'draft-note-added':
      return `Draft ${record.draftId} noted ${record.fields.noteKind} ${record.fields.noteId}`;
    case 'draft-question-asked':
      return record.fields.underQuestionId === undefined
        ? `Draft ${record.draftId} asked ${record.fields.questionId}`
        : `Draft ${record.draftId} asked ${record.fields.questionId} under ${record.fields.underQuestionId}`;
    case 'draft-question-answered':
      return `Draft ${record.draftId} ${record.fields.questionId} answered: ${record.fields.answer}`;
    case 'draft-item-dropped':
      return `Draft ${record.draftId} dropped ${record.fields.itemId}`;
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
    case 'check-command-set':
      return record.fields.command === null ? 'Check command cleared' : `Check command set to ${record.fields.command}`;
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
  return 'taskId' in record ? [record.taskId] : [];
}

function ticketIdsConcernedBy(record: LogRecordContent): string[] {
  if (record.kind === 'ticket-dependencies-set') return [...new Set([record.ticketId, ...record.fields.dependsOn])];
  if (record.kind === 'draft-closed') return [...record.fields.ticketIds];
  return 'ticketId' in record ? [record.ticketId] : [];
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

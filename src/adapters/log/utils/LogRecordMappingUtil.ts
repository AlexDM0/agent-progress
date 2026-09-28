/** A validated log.jsonl line rebuilt as the model's record: only its kind's known keys, in the order the logger writes them. */
import type { LogRecord }                        from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { AgentPair }                        from '../../../lib/tracker-model/@types/Ticket.ts';
import type { ViewRange }                        from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import type { LogFileReading, StoredLogReading } from '../@types/StoredLog.ts';

function viewRangeOf(view: ViewRange): ViewRange {
  if (view.kind === 'auto') return { kind: view.kind };
  return {
    kind:        view.kind,
    from:        view.from,
    to:          view.to,
    tickMinutes: view.tickMinutes,
  };
}

function agentPairOf(agentPair: AgentPair): AgentPair {
  return { model: agentPair.model, effort: agentPair.effort };
}

/** `validated` is a value `logRecordProblemOf` found no problem in; anything else is a broken invariant, not a bad file. */
function recordOf(validated: unknown): LogRecord {
  const record = validated as LogRecord;
  const { at } = record;
  switch (record.kind) {
    case 'note':
      return { at, kind: record.kind, fields: { text: record.fields.text } };
    case 'ticket-filed':
      return {
        at,
        kind:     record.kind,
        ticketId: record.ticketId,
        fields:   { title: record.fields.title },
      };
    case 'ticket-reopened':
    case 'ticket-started':
    case 'ticket-finished':
    case 'ticket-approved':
    case 'ticket-delivered':
    case 'ticket-unheld':
    case 'ticket-release-cleared':
      return {
        at,
        kind:     record.kind,
        ticketId: record.ticketId,
        fields:   {},
      };
    case 'ticket-abandoned':
    case 'ticket-held':
      return {
        at,
        kind:     record.kind,
        ticketId: record.ticketId,
        fields:   { reason: record.fields.reason },
      };
    case 'ticket-release-marked':
      return {
        at,
        kind:     record.kind,
        ticketId: record.ticketId,
        fields:   { group: record.fields.group },
      };
    case 'ticket-rereviewed':
      return {
        at,
        kind:     record.kind,
        ticketId: record.ticketId,
        fields:   { round: record.fields.round },
      };
    case 'ticket-priority-changed':
      return {
        at,
        kind:     record.kind,
        ticketId: record.ticketId,
        fields:   { from: record.fields.from, to: record.fields.to },
      };
    case 'ticket-dependencies-set':
      return {
        at,
        kind:     record.kind,
        ticketId: record.ticketId,
        fields:   { dependsOn: [...record.fields.dependsOn] },
      };
    case 'ticket-agents-changed':
      return {
        at,
        kind:     record.kind,
        ticketId: record.ticketId,
        fields:   { from: agentPairOf(record.fields.from), to: agentPairOf(record.fields.to) },
      };
    case 'review-bar-started':
    case 'review-bar-closed':
      return {
        at,
        kind:     record.kind,
        taskId:   record.taskId,
        ticketId: record.ticketId,
        fields:   { name: record.fields.name },
      };
    case 'chart-range-set':
      return { at, kind: record.kind, fields: { view: viewRangeOf(record.fields.view) } };
    case 'concurrency-limit-set':
      return { at, kind: record.kind, fields: { limit: record.fields.limit } };
    case 'dispatcher-set':
      return { at, kind: record.kind, fields: { state: record.fields.state, runId: record.fields.runId } };
    case 'tracker-cleared':
      return { at, kind: record.kind, fields: {} };
    case 'agent-stopped':
      return {
        at,
        kind:   record.kind,
        fields: {
          agentId:              record.fields.agentId,
          agentType:            record.fields.agentType,
          apiCallCount:         record.fields.apiCallCount,
          endContextTokens:     record.fields.endContextTokens,
          totalInputTokens:     record.fields.totalInputTokens,
          cacheReadInputTokens: record.fields.cacheReadInputTokens,
          outputTokens:         record.fields.outputTokens,
          ...(record.fields.workflowRunId === undefined ? {} : { workflowRunId: record.fields.workflowRunId }),
          ...(record.fields.agentLabel === undefined ? {} : { agentLabel: record.fields.agentLabel }),
        },
      };
  }
}

/** Which log a tracker has, from its log.jsonl reading: the file's records, an empty log when it is absent, or its own unreadable verdict. */
function storedLogOf(logFileReading: LogFileReading): StoredLogReading {
  if (logFileReading.verdict === 'unreadable') return logFileReading;
  const records = logFileReading.verdict === 'readable' ? logFileReading.records : [];
  return { verdict: 'readable', records };
}

export const LogRecordMappingUtil = { recordOf, storedLogOf } as const;

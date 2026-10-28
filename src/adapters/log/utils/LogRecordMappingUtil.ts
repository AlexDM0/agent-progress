/** A validated log.jsonl line rebuilt as the model's record: only its kind's known keys, in the order the logger writes them. */
import type { LogRecord, LogRecordKind }             from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { AgentPair }                            from '../../../lib/tracker-model/@types/Ticket.ts';
import type { ViewRange }                            from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import type { LogFieldShape }                        from '../../../lib/tracker-model/constants/LogRecordSchema.ts';
import { LOG_RECORD_SCHEMA, LOG_RECORD_SUBJECT_IDS } from '../../../lib/tracker-model/constants/LogRecordSchema.ts';
import type { LogFileReading, StoredLogReading }     from '../@types/StoredLog.ts';
import { ReviewRecordFieldsUtil }                    from './ReviewRecordFieldsUtil.ts';

type UnknownObject = Record<string, unknown>;

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

function listCopyOf(value: unknown): unknown {
  return [...(value as readonly string[])];
}

function sameValue(value: unknown): unknown {
  return value;
}

/** Every value is one `logRecordProblemOf` passed for its shape. */
const COPY_FOR_FIELD_SHAPE: Readonly<Record<LogFieldShape, (value: unknown) => unknown>> = {
  'text':                   sameValue,
  'task-id':                sameValue,
  'optional-text':          sameValue,
  'priority':               sameValue,
  'ticket-size':            sameValue,
  'optional-size':          sameValue,
  'agent-pair':             (value) => agentPairOf(value as AgentPair),
  'ticket-ids':             listCopyOf,
  'epic-keys':              listCopyOf,
  'network-domains':        listCopyOf,
  'review-round':           sameValue,
  'chart-range':            (value) => viewRangeOf(value as ViewRange),
  'concurrency-limit':      sameValue,
  'dispatcher-state':       sameValue,
  'dispatcher-run-id':      sameValue,
  'check-command':          sameValue,
  'count':                  sameValue,
  'review-bar-round':       sameValue,
  'review-verdict':         sameValue,
  'review-claims':          ReviewRecordFieldsUtil.claimsCopyOf,
  'review-findings':        ReviewRecordFieldsUtil.findingsCopyOf,
  'nullable-text':          sameValue,
  'job-kind':               sameValue,
  'job-role':               sameValue,
  'job-outcome':            sameValue,
  'interruption-cause':     sameValue,
  'host-instance':          sameValue,
  'permission-names':       listCopyOf,
  'runner-stop-reason':     sameValue,
  'job-stop-mode':          sameValue,
  'decision-kind':          sameValue,
  'decision-answer':        (value) => ({ ...(value as Readonly<Record<string, string>>) }),
  'incident-kind':          sameValue,
  'incident-move':          sameValue,
  'incident-default-cause': sameValue,
  'gate-outcome':           sameValue,
  'file-paths':             listCopyOf,
  'landing-kind':           sameValue,
  'flag':                   sameValue,
  'optional-flag':          sameValue,
};

/** Copies into `target` each value `shapes` names, in the schema's order, leaving out an optional one that is absent. */
function copyShapedValues(stored: UnknownObject, shapes: Readonly<Record<string, LogFieldShape>>, target: UnknownObject): UnknownObject {
  for (const [name, shape] of Object.entries(shapes)) {
    const value = stored[name];
    if ((shape === 'optional-text' || shape === 'optional-size' || shape === 'optional-flag') && value === undefined) continue;
    target[name] = COPY_FOR_FIELD_SHAPE[shape](value);
  }
  return target;
}

/** `validated` is a value `logRecordProblemOf` found no problem in; anything else is a broken invariant, not a bad file. */
function recordOf(validated: unknown): LogRecord {
  const stored                      = validated as UnknownObject & { at: string; kind: LogRecordKind; fields: UnknownObject };
  const { at, kind }                = stored;
  const { subject, fields: shapes } = LOG_RECORD_SCHEMA[kind];
  const record                      = copyShapedValues(stored, LOG_RECORD_SUBJECT_IDS[subject], { at, kind });
  record['fields']                  = copyShapedValues(stored.fields, shapes, {});
  return record as LogRecord;
}

/** Which log a tracker has, from its log.jsonl reading: the file's records, an empty log when it is absent, or its own unreadable verdict. */
function storedLogOf(logFileReading: LogFileReading): StoredLogReading {
  if (logFileReading.verdict === 'unreadable') return logFileReading;
  const records = logFileReading.verdict === 'readable' ? logFileReading.records : [];
  return { verdict: 'readable', records };
}

export const LogRecordMappingUtil = { recordOf, storedLogOf } as const;

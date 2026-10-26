/**
 * What the Board tells the log, as ids and values with no wording; the caller words it. Every record type is derived from
 * `src/lib/tracker-model/constants/LogRecordSchema.ts`, so a new kind is an entry there plus its wording in `src/adapters/utils/LogUtil.ts`.
 */
import type { LogFieldShape, LOG_RECORD_SCHEMA, LOG_RECORD_SUBJECT_IDS } from '../constants/LogRecordSchema.ts';
import type { ReviewClaim, ReviewFinding, ReviewVerdict }                from './ReviewRecord.ts';
import type { AgentPair, TicketPriority }                                from './Ticket.ts';
import type { DispatcherState, ViewRange }                               from './TrackerProgress.ts';

interface ValueOfFieldShape {
  'text':              string;
  'task-id':           number;
  'optional-text':     string;
  'priority':          TicketPriority;
  'agent-pair':        AgentPair;
  'ticket-ids':        readonly string[];
  'epic-keys':         readonly string[];
  'review-round':      number;
  'chart-range':       ViewRange;
  'concurrency-limit': number;
  'dispatcher-state':  DispatcherState;
  'dispatcher-run-id': string | null;
  'check-command':     string | null;
  'count':             number;
  'review-bar-round':  number;
  'review-verdict':    ReviewVerdict;
  'review-claims':     readonly ReviewClaim[];
  'review-findings':   readonly ReviewFinding[];
}

type Schema = typeof LOG_RECORD_SCHEMA;

export type LogRecordKind = keyof Schema;

type FieldShapes = Readonly<Record<string, LogFieldShape>>;

type OptionalFieldNames<Shapes extends FieldShapes> = { [Name in keyof Shapes]: Shapes[Name] extends 'optional-text' ? Name : never }[keyof Shapes];

type Flattened<Value> = { [Key in keyof Value]: Value[Key] };

type ValuesOfShapes<Shapes extends FieldShapes> = Flattened<
  & { [Name in Exclude<keyof Shapes, OptionalFieldNames<Shapes>>]: ValueOfFieldShape[Shapes[Name]] }
  & { [Name in OptionalFieldNames<Shapes>]?: ValueOfFieldShape[Shapes[Name]] }
>;

type FieldsOfShapes<Shapes extends FieldShapes> = [keyof Shapes] extends [never] ? Record<string, never> : ValuesOfShapes<Shapes>;

export type LogRecordFieldsOf<Kind extends LogRecordKind> = FieldsOfShapes<Schema[Kind]['fields']>;

type IdsOf<Kind extends LogRecordKind> = ValuesOfShapes<(typeof LOG_RECORD_SUBJECT_IDS)[Schema[Kind]['subject']]>;

export type LogRecordContent = {
  [Kind in LogRecordKind]: Flattened<{ kind: Kind } & IdsOf<Kind> & { fields: LogRecordFieldsOf<Kind> }>
}[LogRecordKind];

export type AgentUsage = LogRecordFieldsOf<'agent-stopped'>;

export type LogRecord = LogRecordContent & { at: string };

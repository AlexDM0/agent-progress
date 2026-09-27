/**
 * The reply schema of each agent the dispatcher starts. Key and array orders are part of the wire contract the frozen table hashes, and the
 * field names mirror the `status --json` fields the prompts ask the agents to copy, with `worktreeExists` the survey's own `test -d`.
 */
import type { DispatcherState }                 from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { BuilderOutcome, ReviewerVerdict } from '../@types/AgentReadings.ts';
import type { JsonSchema }                      from '../@types/WorkflowRuntime.ts';

const READY_TICKET_SCHEMA: JsonSchema = {
  type:       'object',
  properties: {
    id:       { type: 'string' },
    priority: { type: 'string' },
    model:    { type: 'string' },
    effort:   { type: 'string' },
    held:     { type: 'boolean' },
  },
  required: ['id', 'priority', 'model', 'effort'],
};

const STATUS_BLOCK_SCHEMA: JsonSchema = {
  type:       'object',
  properties: {
    limit:                 { type: 'integer', minimum: 1 },
    agentsInFlight:        { type: 'integer', minimum: 0 },
    freeSlots:             { type: 'integer', minimum: 0 },
    readyTicketIds:        { type: 'array', items: { type: 'string' } },
    readyTickets:          { type: 'array', items: READY_TICKET_SCHEMA },
    // The wire order, which is not the model's `DISPATCHER_STATES` order.
    dispatcherState:       { type: 'string', enum: ['running', 'stopped', 'finished'] satisfies readonly DispatcherState[] },
    inProgressTicketIds:   { type: 'array', items: { type: 'string' } },
    inProgressReviewOfIds: { type: 'array', items: { type: 'string' } },
    heldTicketIds:         { type: 'array', items: { type: 'string' } },
  },
  required: ['limit', 'agentsInFlight', 'freeSlots', 'readyTicketIds', 'readyTickets', 'dispatcherState', 'inProgressTicketIds', 'inProgressReviewOfIds', 'heldTicketIds'],
};

const TICKET_AGENT_SETTINGS_SCHEMA: JsonSchema = {
  type:       'object',
  properties: { id: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' } },
  required:   ['id'],
};

const PAUSED_BUILD_SCHEMA: JsonSchema = {
  type:       'object',
  properties: {
    id:             { type: 'string' },
    note:           { type: 'string' },
    worktreeExists: { type: 'boolean' },
    priority:       { type: 'string' },
    model:          { type: 'string' },
    effort:         { type: 'string' },
  },
  required: ['id', 'note', 'worktreeExists', 'priority'],
};

const FINDING_SCHEMA: JsonSchema = {
  type:       'object',
  properties: { class: { type: 'string' }, file: { type: 'string' }, summary: { type: 'string' } },
  required:   ['class', 'file', 'summary'],
};

const SURVEY: JsonSchema = {
  type:       'object',
  properties: {
    status:               STATUS_BLOCK_SCHEMA,
    reviewWaitingTickets: { type: 'array', items: TICKET_AGENT_SETTINGS_SCHEMA },
    pausedBuilds:         { type: 'array', items: PAUSED_BUILD_SCHEMA },
  },
  required: ['status', 'reviewWaitingTickets', 'pausedBuilds'],
};

const TICKET_SETTINGS_LOOKUP: JsonSchema = {
  type:       'object',
  properties: { tickets: { type: 'array', items: TICKET_AGENT_SETTINGS_SCHEMA } },
  required:   ['tickets'],
};

const BUILDER: JsonSchema = {
  type:       'object',
  properties: {
    outcome:   { type: 'string', enum: ['in-review', 'claim-refused', 'failed'] satisfies readonly BuilderOutcome[] },
    detail:    { type: 'string' },
    claimNote: { type: 'string' },
    status:    STATUS_BLOCK_SCHEMA,
  },
  required: ['outcome', 'detail', 'claimNote', 'status'],
};

const REVIEWER: JsonSchema = {
  type:       'object',
  properties: {
    round:          { type: 'integer', minimum: 1 },
    verdict:        { type: 'string', enum: ['released', 'round-requested', 'does-not-hold', 'not-released'] satisfies readonly ReviewerVerdict[] },
    releaseReason:  { type: 'string' },
    reworkedLines:  { type: 'integer', minimum: 0 },
    findings:       { type: 'array', items: FINDING_SCHEMA },
    filedTicketIds: { type: 'array', items: { type: 'string' } },
    status:         STATUS_BLOCK_SCHEMA,
  },
  required: ['round', 'verdict', 'releaseReason', 'reworkedLines', 'findings', 'filedTicketIds', 'status'],
};

const PARKING: JsonSchema = {
  type:       'object',
  properties: { status: STATUS_BLOCK_SCHEMA },
  required:   ['status'],
};

export const AGENT_REPLY_SCHEMAS = {
  SURVEY,
  TICKET_SETTINGS_LOOKUP,
  BUILDER,
  REVIEWER,
  PARKING,
} as const;

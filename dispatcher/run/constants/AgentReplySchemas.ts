/**
 * The reply schema of each agent the dispatcher starts. Key and array orders are part of the wire contract the frozen table hashes, and the
 * field names mirror the `status --json` fields the prompts ask the agents to copy, with `worktreeNames` the survey's own `ls`.
 */
import type { DispatcherState }                 from '../../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { BuilderOutcome, ReviewerVerdict } from '../../@types/AgentReadings.ts';
import type { JsonSchema }                      from '../../@types/WorkflowRuntime.ts';

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
    id:       { type: 'string' },
    note:     { type: 'string' },
    priority: { type: 'string' },
    model:    { type: 'string' },
    effort:   { type: 'string' },
  },
  required: ['id', 'note', 'priority'],
};

const WORKTREE_NAMES_SCHEMA: JsonSchema = { type: 'array', items: { type: 'string' } };

const FINDING_SCHEMA: JsonSchema = {
  type:       'object',
  properties: { class: { type: 'string' }, file: { type: 'string' }, summary: { type: 'string' } },
  required:   ['class', 'file', 'summary'],
};

const SURVEY: JsonSchema = {
  type:       'object',
  properties: {
    status:                 STATUS_BLOCK_SCHEMA,
    reviewWaitingTickets:   { type: 'array', items: TICKET_AGENT_SETTINGS_SCHEMA },
    pausedBuilds:           { type: 'array', items: PAUSED_BUILD_SCHEMA },
    worktreeNames:          WORKTREE_NAMES_SCHEMA,
    dirtyMainCheckoutFiles: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'reviewWaitingTickets', 'pausedBuilds', 'worktreeNames', 'dirtyMainCheckoutFiles'],
};

const LOOKED_UP_TICKET_SCHEMA: JsonSchema = {
  type:       'object',
  properties: {
    id:     { type: 'string' },
    model:  { type: 'string' },
    effort: { type: 'string' },
    group:  { type: 'string' },
  },
  required: ['id'],
};

const BOARD_TICKET_SCHEMA: JsonSchema = {
  type:       'object',
  properties: {
    id:            { type: 'string' },
    status:        { type: 'string' },
    dependsOn:     { type: 'array', items: { type: 'string' } },
    releasesGroup: { type: 'boolean' },
    group:         { type: 'string' },
    model:         { type: 'string' },
    effort:        { type: 'string' },
  },
  required: ['id', 'status', 'dependsOn', 'releasesGroup'],
};

const TICKET_SETTINGS_LOOKUP: JsonSchema = {
  type:       'object',
  properties: {
    tickets:      { type: 'array', items: LOOKED_UP_TICKET_SCHEMA },
    boardTickets: { type: 'array', items: BOARD_TICKET_SCHEMA },
  },
  required: ['tickets', 'boardTickets'],
};

const TICKET_ROW_SCHEMA: JsonSchema = {
  type:       'object',
  properties: {
    id:         { type: 'string' },
    row:        { type: 'object', properties: { note: { type: 'string' } } },
    reviewBars: { type: 'array', items: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] } },
  },
  required: ['id', 'reviewBars'],
};

const GROUP_SURVEY: JsonSchema = {
  type:       'object',
  properties: {
    status:        STATUS_BLOCK_SCHEMA,
    tickets:       { type: 'array', items: BOARD_TICKET_SCHEMA },
    ticketRows:    { type: 'array', items: TICKET_ROW_SCHEMA },
    worktreeNames: WORKTREE_NAMES_SCHEMA,
  },
  required: ['status', 'tickets', 'ticketRows', 'worktreeNames'],
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
    blockingFiles:  { type: 'array', items: { type: 'string' } },
    reworkedLines:  { type: 'integer', minimum: 0 },
    findings:       { type: 'array', items: FINDING_SCHEMA },
    filedTicketIds: { type: 'array', items: { type: 'string' } },
    status:         STATUS_BLOCK_SCHEMA,
  },
  required: ['round', 'verdict', 'releaseReason', 'blockingFiles', 'reworkedLines', 'findings', 'filedTicketIds', 'status'],
};

const GROUP_REVIEWER: JsonSchema = {
  type:       'object',
  properties: {
    round:            { type: 'integer', minimum: 1 },
    verdict:          { type: 'string', enum: ['integrated', 'round-requested', 'does-not-hold', 'not-released'] satisfies readonly ReviewerVerdict[] },
    releaseReason:    { type: 'string' },
    integratedCommit: { type: 'string' },
    reworkedLines:    { type: 'integer', minimum: 0 },
    findings:         { type: 'array', items: FINDING_SCHEMA },
    filedTicketIds:   { type: 'array', items: { type: 'string' } },
    status:           STATUS_BLOCK_SCHEMA,
  },
  required: ['round', 'verdict', 'releaseReason', 'integratedCommit', 'reworkedLines', 'findings', 'filedTicketIds', 'status'],
};

const PARKING: JsonSchema = {
  type:       'object',
  properties: { status: STATUS_BLOCK_SCHEMA },
  required:   ['status'],
};

export const AGENT_REPLY_SCHEMAS = {
  SURVEY,
  TICKET_SETTINGS_LOOKUP,
  GROUP_SURVEY,
  BUILDER,
  REVIEWER,
  GROUP_REVIEWER,
  PARKING,
} as const;

/**
 * The log's vocabulary: every record kind with what it is about and the shape of each field, in the order the record stores them. The
 * record types in `src/lib/tracker-model/@types/LogRecord.ts` are derived from it, and so are the stored check and the mapping back, so a
 * new kind is one entry here plus its wording and its emitter.
 */

export type LogRecordSubject = 'board' | 'ticket' | 'epic' | 'draft' | 'review-bar';

export type LogFieldShape =
  | 'text'
  | 'task-id'
  | 'optional-text'
  | 'priority'
  | 'ticket-size'
  | 'agent-pair'
  | 'ticket-ids'
  | 'epic-keys'
  | 'review-round'
  | 'chart-range'
  | 'concurrency-limit'
  | 'dispatcher-state'
  | 'dispatcher-run-id'
  | 'check-command'
  | 'count'
  | 'review-bar-round'
  | 'review-verdict'
  | 'review-claims'
  | 'review-findings';

export interface LogRecordKindSchema {
  subject: LogRecordSubject;
  fields:  Readonly<Record<string, LogFieldShape>>;
}

const NO_FIELDS = {} as const;

/** The ids each subject sets beside `kind`, in stored order: a review bar carries its task id before its ticket id. */
export const LOG_RECORD_SUBJECT_IDS = {
  'board':      NO_FIELDS,
  'ticket':     { ticketId: 'text' },
  'epic':       { epicKey: 'text' },
  'draft':      { draftId: 'text' },
  'review-bar': { taskId: 'task-id', ticketId: 'text' },
} as const satisfies Readonly<Record<LogRecordSubject, Readonly<Record<string, LogFieldShape>>>>;

export const LOG_RECORD_SCHEMA = {
  'note':                            { subject: 'board', fields: { text: 'text' } },
  'ticket-filed':                    { subject: 'ticket', fields: { title: 'text' } },
  'ticket-reopened':                 { subject: 'ticket', fields: NO_FIELDS },
  'ticket-started':                  { subject: 'ticket', fields: NO_FIELDS },
  'ticket-finished':                 { subject: 'ticket', fields: NO_FIELDS },
  'ticket-approved':                 { subject: 'ticket', fields: NO_FIELDS },
  'ticket-delivered':                { subject: 'ticket', fields: NO_FIELDS },
  'ticket-abandoned':                { subject: 'ticket', fields: { reason: 'text' } },
  'ticket-retitled':                 { subject: 'ticket', fields: { from: 'text', to: 'text' } },
  'ticket-body-changed-after-claim': { subject: 'ticket', fields: NO_FIELDS },
  'ticket-rereviewed':               { subject: 'ticket', fields: { round: 'review-round' } },
  'ticket-priority-changed':         { subject: 'ticket', fields: { from: 'priority', to: 'priority' } },
  // `from` is absent when the ticket had no size.
  'ticket-size-changed':             { subject: 'ticket', fields: { from: 'optional-text', to: 'ticket-size' } },
  'ticket-dependencies-set':         { subject: 'ticket', fields: { dependsOn: 'ticket-ids' } },
  // `introducedBy` is absent when the cause was cleared.
  'ticket-introduced-by-set':        { subject: 'ticket', fields: { introducedBy: 'optional-text' } },
  'ticket-agents-changed':           { subject: 'ticket', fields: { from: 'agent-pair', to: 'agent-pair' } },
  'ticket-held':                     { subject: 'ticket', fields: { reason: 'text' } },
  'ticket-unheld':                   { subject: 'ticket', fields: NO_FIELDS },
  'ticket-release-marked':           { subject: 'ticket', fields: { group: 'text' } },
  'ticket-release-cleared':          { subject: 'ticket', fields: NO_FIELDS },
  'ticket-epics-set':                { subject: 'ticket', fields: { epics: 'epic-keys' } },
  'ticket-check-command-restamped':  { subject: 'ticket', fields: { command: 'check-command' } },
  'epic-added':                      { subject: 'epic', fields: { title: 'text' } },
  'epic-edited':                     { subject: 'epic', fields: { title: 'text' } },
  'epic-removed':                    { subject: 'epic', fields: NO_FIELDS },
  'draft-opened':                    { subject: 'draft', fields: { title: 'text', owner: 'text' } },
  // `takenFrom` is set only when a forced claim took the draft from another owner.
  'draft-claimed':                   { subject: 'draft', fields: { owner: 'text', takenFrom: 'optional-text' } },
  'draft-released':                  { subject: 'draft', fields: { owner: 'text' } },
  'draft-closed':                    { subject: 'draft', fields: { ticketIds: 'ticket-ids' } },
  'draft-abandoned':                 { subject: 'draft', fields: { reason: 'text' } },
  'draft-note-added':                { subject: 'draft', fields: { noteId: 'text', noteKind: 'text' } },
  'draft-question-asked':            { subject: 'draft', fields: { questionId: 'text', underQuestionId: 'optional-text' } },
  // `answer` is the option letters joined by commas, or the free text: the log keeps every answer, the draft only the current one.
  'draft-question-answered':         { subject: 'draft', fields: { questionId: 'text', answer: 'text' } },
  // A dropped question's follow-ups are dropped too, one record each after it.
  'draft-item-dropped':              { subject: 'draft', fields: { itemId: 'text' } },
  // A review bar's `name` is carried because the sentence prints the row's stored name, which an edit may have made anything.
  'review-bar-started':              { subject: 'review-bar', fields: { name: 'text' } },
  'review-bar-closed':               { subject: 'review-bar', fields: { name: 'text' } },
  // One reviewer pass: the rework is code lines only, the fix and rebase parts apart, and the builder's change is measured at the review's start.
  'review-recorded':                 {
    subject: 'review-bar',
    fields:  {
      round:                   'review-bar-round',
      verdict:                 'review-verdict',
      reviewStartCommit:       'text',
      fixReworkedCodeLines:    'count',
      rebaseReworkedCodeLines: 'count',
      totalReworkedCodeLines:  'count',
      builderChangedFiles:     'count',
      builderInsertions:       'count',
      builderDeletions:        'count',
      claims:                  'review-claims',
      findings:                'review-findings',
    },
  },
  'chart-range-set':       { subject: 'board', fields: { view: 'chart-range' } },
  'concurrency-limit-set': { subject: 'board', fields: { limit: 'concurrency-limit' } },
  'dispatcher-set':        { subject: 'board', fields: { state: 'dispatcher-state', runId: 'dispatcher-run-id' } },
  'check-command-set':     { subject: 'board', fields: { command: 'check-command' } },
  'tracker-cleared':       { subject: 'board', fields: NO_FIELDS },
  // `totalInputTokens` is fresh input plus cache read plus cache creation; the run id and label are stored only for an agent a workflow run spawned.
  'agent-stopped':         {
    subject: 'board',
    fields:  {
      agentId:              'text',
      agentType:            'text',
      apiCallCount:         'count',
      endContextTokens:     'count',
      totalInputTokens:     'count',
      cacheReadInputTokens: 'count',
      outputTokens:         'count',
      workflowRunId:        'optional-text',
      agentLabel:           'optional-text',
    },
  },
} as const satisfies Readonly<Record<string, LogRecordKindSchema>>;

/**
 * The builder, reviewer and resolver report schemas (design section 4.3), each one draft-07 document: handed to the agent's command line as
 * written and checked by `reportVerdictOf`, so the two never disagree. No report carries a round, a rework count, a verdict or a release.
 */
import type { ReviewFinding } from '../../lib/tracker-model/@types/ReviewRecord.ts';
import {
  REVIEW_CLAIM_RESULTS,
  REVIEW_FINDING_CLASSES,
  REVIEW_FINDING_EVIDENCE_KINDS,
  REVIEW_FINDING_SEVERITIES
} from '../../lib/tracker-model/constants/ReviewRecordVocabulary.ts';
import type { JsonSchema } from './ReportValidation.ts';

/** A reviewer report's finding: the stored `ReviewFinding` unchanged when fixed; when filed, the relay's ticket id or its request id. */
export type ReportedReviewFinding =
  | Extract<ReviewFinding, { outcome: 'fixed' }>
  | Omit<Extract<ReviewFinding, { outcome: 'filed' }>, 'filedTicketId'> & { filedTicketId: string | null; relayRequestId: string | null };

const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

const COMMIT_SHA: JsonSchema = { type: 'string', pattern: '^[0-9a-f]{40}$' };

const SHORT_NOTE_CHARACTERS = 300;

const SHORT_NOTE: JsonSchema = { type: 'string', maxLength: SHORT_NOTE_CHARACTERS };

const TEXT: JsonSchema = { type: 'string' };

const NULLABLE_TEXT: JsonSchema = { type: ['string', 'null'] };

/** An Acceptance item's label, `A1`, never its text: verification matches a report's items to the ticket's labels exactly. */
const ACCEPTANCE_LABEL: JsonSchema = { type: 'string', pattern: '^A\\d+$' };

function closedObject(properties: Readonly<Record<string, JsonSchema>>, required: readonly string[] = Object.keys(properties)): JsonSchema {
  return {
    type: 'object', properties, required, additionalProperties: false
  };
}

function listOf(items: JsonSchema): JsonSchema {
  return { type: 'array', items };
}

/**
 * `blocked` stays for a session that cannot continue at all, with a reason; a question is asked live, so there is no `blockedOn`. `gates`
 * claims each gate the agent ran green and the commit it passed on: never trusted, only held against HEAD before any gate runs.
 */
export const BUILDER_REPORT_SCHEMA: JsonSchema = {
  $schema: DRAFT_07,
  title:   'builder report',
  ...closedObject({
    role:       { const: 'builder' },
    outcome:    { enum: ['built', 'blocked', 'cannot-build', 'wound-down'] },
    headCommit: COMMIT_SHA,
    acceptance: listOf(closedObject({
      item:         ACCEPTANCE_LABEL,
      state:        { enum: ['met', 'waiver-proposed'] },
      evidence:     SHORT_NOTE,
      waiverReason: TEXT,
    }, ['item', 'state', 'evidence'])),
    alsoFixed:         listOf(closedObject({ summary: TEXT, files: listOf(TEXT), evidence: TEXT })),
    gates:             listOf(closedObject({ name: TEXT, commit: COMMIT_SHA })),
    handoff:           TEXT,
    blockedReason:     NULLABLE_TEXT,
    cannotBuildReason: NULLABLE_TEXT,
  }),
  if:   { properties: { outcome: { const: 'blocked' } } },
  then: { properties: { blockedReason: { type: 'string', minLength: 1 } } },
};

const FINDING_DESCRIPTION: Readonly<Record<string, JsonSchema>> = {
  class:    { enum: REVIEW_FINDING_CLASSES },
  severity: { enum: REVIEW_FINDING_SEVERITIES },
  file:     TEXT,
  summary:  TEXT,
  evidence: { enum: REVIEW_FINDING_EVIDENCE_KINDS },
};

const FIXED_FINDING = closedObject({ ...FINDING_DESCRIPTION, outcome: { const: 'fixed' }, commit: COMMIT_SHA });

/** A filed finding names the ticket the relay answered with, or the request id `queued` printed: at least one of the two. */
const FILED_FINDING: JsonSchema = {
  ...closedObject({
    ...FINDING_DESCRIPTION, outcome: { const: 'filed' }, filedTicketId: NULLABLE_TEXT, relayRequestId: NULLABLE_TEXT
  }),
  anyOf: [
    { properties: { filedTicketId: TEXT }, required: ['filedTicketId'] },
    { properties: { relayRequestId: TEXT }, required: ['relayRequestId'] },
  ],
};

/** There is no `file-ticket` outcome: a reviewer files its own out-of-scope findings through the relay. */
export const REVIEWER_REPORT_SCHEMA: JsonSchema = {
  $schema: DRAFT_07,
  title:   'reviewer report',
  ...closedObject({
    role:       { const: 'reviewer' },
    headCommit: COMMIT_SHA,
    claims:     listOf(closedObject({
      item: ACCEPTANCE_LABEL, result: { enum: REVIEW_CLAIM_RESULTS }, handoffContradicted: { type: 'boolean' }, note: SHORT_NOTE
    })),
    findings:   listOf({ oneOf: [FIXED_FINDING, FILED_FINDING] }),
    reviewText: TEXT,
  }),
};

const TEXT_LIST = listOf(TEXT);

const ONBOARDER_GATE = closedObject({
  name: TEXT, run: TEXT, definedBy: TEXT_LIST, network: TEXT_LIST, writes: TEXT_LIST
});

const ONBOARDER_REVIEW: JsonSchema = { oneOf: [{ type: 'null' }, closedObject({ name: TEXT, model: NULLABLE_TEXT, effort: NULLABLE_TEXT })], };

/** Each optimisation `advise` makes is a draft low ticket the onboarder filed through its Hatch, named as a reviewer names a filed finding. */
const FILED_OPTIMISATION: JsonSchema = {
  ...closedObject({ summary: TEXT, filedTicketId: NULLABLE_TEXT, relayRequestId: NULLABLE_TEXT }),
  anyOf: [
    { properties: { filedTicketId: TEXT }, required: ['filedTicketId'] },
    { properties: { relayRequestId: TEXT }, required: ['relayRequestId'] },
  ],
};

/**
 * The onboarder's proposal for the whole pipeline, every array starting from the defaults; `headCommit` is the main-line snapshot it read.
 * `setup` answers `checks-not-set`; `advise` takes the gate history and files its optimisations.
 */
export const ONBOARDER_REPORT_SCHEMA: JsonSchema = {
  $schema: DRAFT_07,
  title:   'onboarder report',
  ...closedObject({
    role:         { const: 'onboarder' },
    mode:         { enum: ['setup', 'advise'] },
    headCommit:   COMMIT_SHA,
    prepare:      listOf(closedObject({ name: TEXT, run: TEXT })),
    gates:        listOf(ONBOARDER_GATE),
    review:       ONBOARDER_REVIEW,
    constitution: TEXT_LIST,
    agents:       closedObject({
      builder: TEXT_LIST, reviewer: TEXT_LIST, merger: TEXT_LIST, productOwner: TEXT_LIST, onboarder: TEXT_LIST, assistant: TEXT_LIST
    }),
    optimisations: listOf(FILED_OPTIMISATION),
    notes:         TEXT,
  }),
};

/** The resolver's, the merge gate fixer's and the resolution reviewer's: `reportKind` is non-null only with `cannot-resolve`. */
export const RESOLVER_REPORT_SCHEMA: JsonSchema = {
  $schema: DRAFT_07,
  title:   'resolver report',
  ...closedObject({
    role:            { enum: ['resolver', 'merge-fix', 'resolution-review'] },
    outcome:         { enum: ['resolved', 'cannot-resolve'] },
    headCommit:      COMMIT_SHA,
    resolvedFiles:   listOf(TEXT),
    semanticChanges: listOf(closedObject({ file: TEXT, why: TEXT })),
    notes:           TEXT,
    reportKind:      { enum: ['malformed-ticket', 'system-blocker', null] },
  }),
  if:   { properties: { outcome: { const: 'resolved' } } },
  then: { properties: { reportKind: { const: null } } },
};

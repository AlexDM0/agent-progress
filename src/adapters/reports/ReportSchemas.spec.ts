/**
 * One table of reports, each with the verdict its schema must give: the validator and the draft-07 document are one source, so the table
 * holds both. The cases that matter are the shapes the design removed or constrained: no `blockedOn`, a `blocked` report needing its
 * reason, no `file-ticket`, a filed finding naming a ticket or a request id, and `reportKind` only beside `cannot-resolve`.
 */
import { describe, expect, test } from 'bun:test';

import {
  BUILDER_REPORT_SCHEMA,
  ONBOARDER_REPORT_SCHEMA,
  RESOLVER_REPORT_SCHEMA,
  REVIEWER_REPORT_SCHEMA
} from './ReportSchemas.ts';
import { reportVerdictOf, type JsonSchema } from './ReportValidation.ts';
import { onboarderReportOf }                from './testing/OnboarderReportFixture.ts';

const HEAD = 'a'.repeat(40);

const ONBOARDED = onboarderReportOf(HEAD);

function adviceFiling(relayRequestId: string | null): Record<string, unknown> {
  return { ...ONBOARDED, mode: 'advise', optimisations: [{ summary: 'Cache the test gate.', filedTicketId: null, relayRequestId }] };
}

const BUILT = {
  role:              'builder',
  outcome:           'built',
  headCommit:        HEAD,
  acceptance:        [{ item: 'A1', state: 'met', evidence: 'cli/Main.spec.ts › relays' }],
  alsoFixed:         [],
  gates:             [{ name: 'tests', commit: HEAD }],
  handoff:           'Done.',
  blockedReason:     null,
  cannotBuildReason: null,
};

const FINDING = {
  class: 'correctness', severity: 'quality', file: 'cli/Main.ts', summary: 'Off by one.', evidence: 'probe'
} as const;

const REVIEWED = {
  role:       'reviewer',
  headCommit: HEAD,
  claims:     [{
    item: 'A1', result: 'holds', handoffContradicted: false, note: 'Watched it fail.'
  }],
  findings: [{ ...FINDING, outcome: 'fixed', commit: HEAD }, {
    ...FINDING, outcome: 'filed', filedTicketId: null, relayRequestId: '5f0c'
  }],
  reviewText: 'Holds.',
};

const RESOLVED = {
  role: 'resolver', outcome: 'resolved', headCommit: HEAD, resolvedFiles: ['cli/Main.ts'], semanticChanges: [], notes: '', reportKind: null
};

const ITEM_NAMED_BY_ITS_TEXT = { ...BUILT, acceptance: [{ item: 'A1. The palette names a colour.', state: 'met', evidence: 'palette.txt line 1' }] };

const REPORT_TABLE: ReadonlyArray<[name: string, schema: JsonSchema, report: unknown, valid: boolean]> = [
  ['a built builder report', BUILDER_REPORT_SCHEMA, BUILT, true],
  ['a blocked builder report with its reason', BUILDER_REPORT_SCHEMA, { ...BUILT, outcome: 'blocked', blockedReason: 'The worktree is gone.' }, true],
  ['a blocked builder report without a reason', BUILDER_REPORT_SCHEMA, { ...BUILT, outcome: 'blocked' }, false],
  ['a builder report carrying blockedOn', BUILDER_REPORT_SCHEMA, { ...BUILT, blockedOn: 'Which currency?' }, false],
  ['a builder report with a short head commit', BUILDER_REPORT_SCHEMA, { ...BUILT, headCommit: 'abc123' }, false],
  ['a builder report with a round', BUILDER_REPORT_SCHEMA, { ...BUILT, round: 2 }, false],
  ['a builder report without gate claims', BUILDER_REPORT_SCHEMA, Object.fromEntries(Object.entries(BUILT).filter(([field]) => field !== 'gates')), false],
  ['a builder report claiming a gate on a short commit', BUILDER_REPORT_SCHEMA, { ...BUILT, gates: [{ name: 'tests', commit: 'abc123' }] }, false],
  ['an acceptance evidence over 300 characters', BUILDER_REPORT_SCHEMA, { ...BUILT, acceptance: [{ item: 'A1', state: 'met', evidence: 'x'.repeat(301) }] }, false],
  ['an acceptance item named by its text rather than its label', BUILDER_REPORT_SCHEMA, ITEM_NAMED_BY_ITS_TEXT, false],
  ['a reviewer report with a fixed and a queued filed finding', REVIEWER_REPORT_SCHEMA, REVIEWED, true],
  ['a claim naming its item by its text rather than its label', REVIEWER_REPORT_SCHEMA, {
    ...REVIEWED,
    claims: [{
      item: 'A1. The palette names a colour.', result: 'holds', handoffContradicted: false, note: ''
    }]
  }, false],
  ['a filed finding naming its ticket', REVIEWER_REPORT_SCHEMA, {
    ...REVIEWED,
    findings: [{
      ...FINDING, outcome: 'filed', filedTicketId: '014', relayRequestId: null
    }]
  }, true],
  ['a filed finding naming neither', REVIEWER_REPORT_SCHEMA, {
    ...REVIEWED,
    findings: [{
      ...FINDING, outcome: 'filed', filedTicketId: null, relayRequestId: null
    }]
  }, false],
  ['a file-ticket finding', REVIEWER_REPORT_SCHEMA, { ...REVIEWED, findings: [{ ...FINDING, outcome: 'file-ticket' }] }, false],
  ['a reviewer report with a verdict', REVIEWER_REPORT_SCHEMA, { ...REVIEWED, verdict: 'released' }, false],
  ['a claim result outside the vocabulary', REVIEWER_REPORT_SCHEMA, {
    ...REVIEWED,
    claims: [{
      item: 'A1', result: 'maybe', handoffContradicted: false, note: ''
    }]
  }, false],
  ['a resolved resolver report', RESOLVER_REPORT_SCHEMA, RESOLVED, true],
  ['a merge-fix that cannot resolve a malformed ticket', RESOLVER_REPORT_SCHEMA, {
    ...RESOLVED, role: 'merge-fix', outcome: 'cannot-resolve', reportKind: 'malformed-ticket'
  }, true],
  ['a resolution review that cannot resolve, with no kind', RESOLVER_REPORT_SCHEMA, { ...RESOLVED, role: 'resolution-review', outcome: 'cannot-resolve' }, true],
  ['a resolved report carrying a report kind', RESOLVER_REPORT_SCHEMA, { ...RESOLVED, reportKind: 'system-blocker' }, false],
  ['a resolver report of the builder role', RESOLVER_REPORT_SCHEMA, { ...RESOLVED, role: 'builder' }, false],
  ['an onboarder setup proposal', ONBOARDER_REPORT_SCHEMA, ONBOARDED, true],
  ['an onboarder proposing no review', ONBOARDER_REPORT_SCHEMA, { ...ONBOARDED, review: null }, true],
  ['an onboarder advice naming a queued optimisation', ONBOARDER_REPORT_SCHEMA, adviceFiling('5f0c'), true],
  ['an onboarder optimisation naming neither ticket nor request', ONBOARDER_REPORT_SCHEMA, adviceFiling(null), false],
  ['an onboarder report missing its constitution', ONBOARDER_REPORT_SCHEMA, Object.fromEntries(Object.entries(ONBOARDED).filter(([field]) => field !== 'constitution')), false],
  ['an onboarder report with an unknown field', ONBOARDER_REPORT_SCHEMA, { ...ONBOARDED, checks: 'bun test' }, false],
  ['an onboarder gate without its writes', ONBOARDER_REPORT_SCHEMA, {
    ...ONBOARDED,
    gates: [{
      name: 'tests', run: 'bun test', definedBy: [], network: []
    }]
  }, false],
  ['an onboarder agents array for an unknown role', ONBOARDER_REPORT_SCHEMA, { ...ONBOARDED, agents: { ...ONBOARDED['agents'] as object, tester: [] } }, false],
  ['an onboarder report in an unknown mode', ONBOARDER_REPORT_SCHEMA, { ...ONBOARDED, mode: 'install' }, false],
];

describe('the report table', () => {
  test.each(REPORT_TABLE)('%s', (_name, schema, report, valid) => {
    expect(reportVerdictOf(schema, report).verdict).toBe(valid ? 'valid' : 'invalid');
  });

  test('each schema is a draft-07 document that survives JSON unchanged, as the command line receives it', () => {
    for (const schema of [BUILDER_REPORT_SCHEMA, REVIEWER_REPORT_SCHEMA, RESOLVER_REPORT_SCHEMA, ONBOARDER_REPORT_SCHEMA]) {
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    }
  });

  test('an invalid report names each problem by its path', () => {
    const problems = ['$.headCommit does not match ^[0-9a-f]{40}$', '$.blockedOn is not allowed'];
    expect(reportVerdictOf(BUILDER_REPORT_SCHEMA, { ...BUILT, blockedOn: 'x', headCommit: 'abc' })).toEqual({ verdict: 'invalid', problems });
  });
});

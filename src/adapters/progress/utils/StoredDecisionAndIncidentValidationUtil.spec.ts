/**
 * A stored decision or incident the format does not hold makes the whole progress file unreadable, so each field's check is planted once
 * and its reason must name the field; well-formed ones, and a file with none of the four keys, pass.
 */
import { expect, test } from 'bun:test';

import { StoredDecisionAndIncidentValidationUtil } from './StoredDecisionAndIncidentValidationUtil.ts';

const { decisionProblem, incidentProblem, decisionsAndIncidentsProblemOf } = StoredDecisionAndIncidentValidationUtil;

const WELL_FORMED_QUESTION = {
  question:    'Which export format?',
  header:      'Format',
  multiSelect: false,
  options:     [{ label: 'CSV', description: 'Comma separated' }],
};

const WELL_FORMED_DECISION = {
  id:        'E1',
  kind:      'agent-question',
  ticketIds: ['001'],
  jobId:     'J1',
  askedBy:   'builder',
  requestId: 'request-1',
  questions: [WELL_FORMED_QUESTION],
  context:   'Example export',
  openedAt:  '2026-09-26T10:15:00+02:00',
};

const WELL_FORMED_INCIDENT = {
  id:              'I1',
  kind:            'findings-delivered',
  ticketIds:       ['001'],
  jobId:           null,
  facts:           { findings: '005, 006' },
  defaultMove:     'ticket-triage',
  deliveredInTurn: null,
  openedAt:        '2026-09-26T10:15:00+02:00',
};

test('a well-formed decision and incident have no problem, a code-opened decision and a delivered incident included', () => {
  expect(decisionProblem(WELL_FORMED_DECISION, 0)).toBeNull();
  expect(decisionProblem({
    ...WELL_FORMED_DECISION, kind: 'outage', jobId: null, askedBy: 'overseer', requestId: null,
  }, 0)).toBeNull();
  expect(incidentProblem(WELL_FORMED_INCIDENT, 0)).toBeNull();
  expect(incidentProblem({ ...WELL_FORMED_INCIDENT, deliveredInTurn: { jobId: 'J4', chatSequence: 1 } }, 0)).toBeNull();
});

test('a file with none of the four keys has no problem', () => {
  expect(decisionsAndIncidentsProblemOf({})).toBeNull();
});

test.each<[string, Record<string, unknown>, string]>([
  ['an id of the wrong form', { id: 'D1' }, 'decisions[0].id is "D1", and it has to be E and a whole number'],
  ['the retired first-run kind', { kind: 'first-run' }, 'decisions[0].kind is "first-run", which is not one of'],
  ['an unknown asker', { askedBy: 'user' }, 'decisions[0].askedBy is "user", which is not one of'],
  ['a request id that is a number', { requestId: 7 }, 'decisions[0].requestId is neither a request id nor null'],
  ['ticket ids that are not a list', { ticketIds: '001' }, 'decisions[0].ticketIds is not a list of ticket ids'],
  ['a job id that is a number', { jobId: 1 }, 'decisions[0].jobId is neither a job id nor null'],
  ['no context', { context: undefined }, 'decisions[0].context is not a string'],
  ['no opening stamp', { openedAt: null }, 'decisions[0].openedAt is not a string'],
  ['questions that are not a list', { questions: {} }, 'decisions[0].questions is not a list'],
  ['a question without a header', { questions: [{ ...WELL_FORMED_QUESTION, header: null }] }, 'decisions[0].questions[0].header is not a string'],
  ['a multiSelect that is text', { questions: [{ ...WELL_FORMED_QUESTION, multiSelect: 'no' }] }, 'decisions[0].questions[0].multiSelect is not true or false'],
  [
    'an option without a description',
    { questions: [{ ...WELL_FORMED_QUESTION, options: [{ label: 'CSV' }] }] },
    'decisions[0].questions[0].options[0].description is not a string',
  ],
])('a decision with %s is refused naming the field', (_case, change, reason) => {
  expect(decisionsAndIncidentsProblemOf({ decisions: [{ ...WELL_FORMED_DECISION, ...change }] })).toStartWith(reason);
});

test.each<[string, Record<string, unknown>, string]>([
  ['an id of the wrong form', { id: 'I0' }, 'incidents[0].id is "I0", and it has to be I and a whole number'],
  ['an unknown kind', { kind: 'outage' }, 'incidents[0].kind is "outage", which is not one of'],
  ['facts that are not text', { facts: { exitCode: 1 } }, 'incidents[0].facts is not an object of text'],
  ['an unknown default move', { defaultMove: 'ticket-waive' }, 'incidents[0].defaultMove is "ticket-waive", which is not one of'],
  ['a delivery turn without a job', { deliveredInTurn: { chatSequence: 1 } }, 'incidents[0].deliveredInTurn.jobId is not a string'],
  ['a delivery turn numbered 0', { deliveredInTurn: { jobId: 'J1', chatSequence: 0 } }, 'incidents[0].deliveredInTurn.chatSequence is not a whole number of at least 1'],
  ['a delivery turn that is text', { deliveredInTurn: 'J1' }, 'incidents[0].deliveredInTurn is neither null nor an object'],
])('an incident with %s is refused naming the field', (_case, change, reason) => {
  expect(decisionsAndIncidentsProblemOf({ incidents: [{ ...WELL_FORMED_INCIDENT, ...change }] })).toStartWith(reason);
});

test.each<[Record<string, unknown>, string]>([
  [{ nextDecisionId: 0 }, 'nextDecisionId is 0, and when present it has to be a whole number of at least 1'],
  [{ nextIncidentId: 1.5 }, 'nextIncidentId is 1.5, and when present it has to be a whole number of at least 1'],
  [{ decisions: {} }, 'decisions is present but not an array'],
  [{ incidents: 'I1' }, 'incidents is present but not an array'],
  [{ decisions: [WELL_FORMED_DECISION, null] }, 'decisions[1] is not an object'],
])('%o is refused naming the key', (document, reason) => {
  expect(decisionsAndIncidentsProblemOf(document)).toBe(reason);
});

/**
 * A stored job the format does not hold makes the whole progress file unreadable, so each field's check is planted once and its reason must
 * name the field; a well-formed job, and a file with neither key, pass.
 */
import { expect, test } from 'bun:test';

import { StoredJobValidationUtil } from './StoredJobValidationUtil.ts';

const { jobProblem, jobsProblemOf } = StoredJobValidationUtil;

const WELL_FORMED_JOB = {
  id:                 'J1',
  kind:               'build',
  role:               'builder',
  ticketIds:          ['001'],
  parentJobId:        null,
  attempt:            1,
  target:             'main',
  state:              'running',
  hostInstance:       1,
  eventCursor:        { instance: 1, sequence: 0 },
  answeredRequestIds: [],
  crashResumes:       0,
};

test('a well-formed job, with or without its optional fields, has no problem', () => {
  expect(jobProblem(WELL_FORMED_JOB, 0)).toBeNull();
  expect(jobProblem({
    ...WELL_FORMED_JOB,
    role:         null,
    interruption: 'reboot',
    slot:         {
      target: 'main', targetTip: 'a1b2c3d', branchTip: 'b2c3d4e', phase: 'gating',
    },
    outcome: 'landed',
  }, 0)).toBeNull();
});

test('a file with neither jobs nor a job counter has no problem', () => {
  expect(jobsProblemOf({})).toBeNull();
});

test.each<[string, Record<string, unknown>, string]>([
  ['an id without its J', { id: '1' }, 'jobs[0].id'],
  ['an unknown kind', { kind: 'deploy' }, 'jobs[0].kind'],
  ['an unknown role', { role: 'tester' }, 'jobs[0].role'],
  ['ticket ids that are not text', { ticketIds: [1] }, 'jobs[0].ticketIds'],
  ['a parent that is not a job id', { parentJobId: 2 }, 'jobs[0].parentJobId'],
  ['an attempt below 1', { attempt: 0 }, 'jobs[0].attempt'],
  ['a target that is not a branch', { target: 3 }, 'jobs[0].target'],
  ['an unknown state', { state: 'ended' }, 'jobs[0].state'],
  ['a host instance below 1', { hostInstance: 0 }, 'jobs[0].hostInstance'],
  ['a cursor without its sequence', { eventCursor: { instance: 1 } }, 'jobs[0].eventCursor.sequence'],
  ['answered ids that are not a list', { answeredRequestIds: 'request-1' }, 'jobs[0].answeredRequestIds'],
  ['a negative crash count', { crashResumes: -1 }, 'jobs[0].crashResumes'],
  ['an unknown interruption', { interruption: 'power-cut' }, 'jobs[0].interruption'],
  ['a slot in an unknown phase', {
    slot: {
      target: 'main', targetTip: 'a', branchTip: 'b', phase: 'waiting'
    }
  }, 'jobs[0].slot.phase'],
  ['an unknown outcome', { outcome: 'shipped' }, 'jobs[0].outcome'],
])('%s is a problem naming the field', (_case, change, field) => {
  expect(jobsProblemOf({ jobs: [{ ...WELL_FORMED_JOB, ...change }] })).toStartWith(field);
});

test('a job counter below 1 and jobs that are not a list are problems', () => {
  expect(jobsProblemOf({ nextJobId: 0 })).toStartWith('nextJobId');
  expect(jobsProblemOf({ jobs: {} })).toBe('jobs is present but not an array');
});

/**
 * A red handoff's ladder, read from the log: a job interrupted `handoff-red` resumes its own session, never a new job, while its handoff
 * cycle has resumes left; the red after the last resume ends it and parks its ticket with a `parked` decision; a builder or reviewer
 * counts alike; and a fresh build after a session the vendor could not resume keeps the attempt and the count. What matters is that no
 * red gate launches a new session while the old one can be resumed, and that the third red parks.
 */
import { describe, expect, test } from 'bun:test';

import type { Job }       from './@types/Job.ts';
import type { LogRecord } from './@types/LogRecord.ts';
import { Playbook }       from './Playbook.ts';
import {
  endedRecord,
  factsWith,
  FIXTURE_AT,
  FIXTURE_LIMITS,
  interruptedRecord,
  jobFixture,
  launchedRecord,
  LIVE_ASSISTANT,
  stepKindsOf,
  ticketOf
} from './testing/LifecycleFixtures.ts';

function redResumedRecord(jobId: string, watcherInstance: number): LogRecord {
  return {
    kind: 'job-resumed', jobId, fields: { watcherInstance, cause: 'handoff-red' }, at: FIXTURE_AT,
  };
}

function redInterruptedJob(kind: 'build' | 'review', resumesSoFar: number): { job: Job; logRecords: LogRecord[] } {
  const job = jobFixture({
    id: 'J1', kind, role: kind === 'build' ? 'builder' : 'reviewer', ticketIds: ['001'], state: 'interrupted', interruption: 'handoff-red', watcherInstance: resumesSoFar + 1,
  });
  const logRecords: LogRecord[] = [launchedRecord('J1', kind, ['001'])];
  for (let resume = 1; resume <= resumesSoFar; resume += 1) logRecords.push(interruptedRecord('J1', 'handoff-red'), redResumedRecord('J1', resume + 1));
  logRecords.push(interruptedRecord('J1', 'handoff-red'));
  return { job, logRecords };
}

function stepsFor(kind: 'build' | 'review', resumesSoFar: number): ReturnType<typeof Playbook.nextStepsOf> {
  const { job, logRecords } = redInterruptedJob(kind, resumesSoFar);
  const status = kind === 'build' ? 'in-progress' : 'in-review';
  return Playbook.nextStepsOf(factsWith({ tickets: [ticketOf('001', status)], jobs: [LIVE_ASSISTANT, job], logRecords }), FIXTURE_LIMITS);
}

describe('a red handoff', () => {
  test('resumes the same job\'s session on the first and second red, launching no new job', () => {
    for (const resumesSoFar of [0, 1]) {
      expect(stepsFor('build', resumesSoFar)).toEqual([{ kind: 'resume-job', jobId: 'J1' }]);
    }
  });

  test('parks the ticket on the third red, ending the job, and opens no launch', () => {
    expect(stepsFor('build', FIXTURE_LIMITS.RED_HANDOFF_RESUMES_BEFORE_PARKING)).toEqual([{
      kind: 'park', ticketId: '001', cause: 'red-resumes-spent', jobId: 'J1'
    }]);
  });

  test('takes a reviewer whose fixes turned a gate red through the same ladder', () => {
    expect(stepsFor('review', 1)).toEqual([{ kind: 'resume-job', jobId: 'J1' }]);
    expect(stepKindsOf(stepsFor('review', 2))).toEqual(['park']);
  });

  test('never counts toward the crash bound, so it resumes whatever its crash resumes', () => {
    const { job, logRecords } = redInterruptedJob('build', 0);
    const crashed = { ...job, crashResumes: FIXTURE_LIMITS.JOB_RESUMES_BEFORE_FRESH };
    const steps = Playbook.nextStepsOf(factsWith({ tickets: [ticketOf('001', 'in-progress')], jobs: [LIVE_ASSISTANT, crashed], logRecords }), FIXTURE_LIMITS);

    expect(steps).toEqual([{ kind: 'resume-job', jobId: 'J1' }]);
  });
});

describe('a red handoff whose session could not be resumed', () => {
  const replacedAfterRed: LogRecord[] = [
    launchedRecord('J1', 'build', ['001']),
    interruptedRecord('J1', 'handoff-red'),
    redResumedRecord('J1', 2),
    endedRecord('J1', 'replaced'),
  ];

  test('launches a fresh build on the same attempt, which carries on the same resume count', () => {
    const steps = Playbook.nextStepsOf(factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: replacedAfterRed }), FIXTURE_LIMITS);

    expect(steps).toEqual([{
      kind: 'launch-build', ticketId: '001', attempt: 1, base: 'main'
    }]);
  });

  test('parks its successor on the red after the cycle\'s last resume', () => {
    const successor = jobFixture({
      id: 'J2', kind: 'build', role: 'builder', ticketIds: ['001'], state: 'interrupted', interruption: 'handoff-red', watcherInstance: 2,
    });
    const logRecords = [
      ...replacedAfterRed,
      launchedRecord('J2', 'build', ['001']),
      interruptedRecord('J2', 'handoff-red'),
      redResumedRecord('J2', 2),
      interruptedRecord('J2', 'handoff-red'),
    ];
    const steps = Playbook.nextStepsOf(factsWith({ tickets: [ticketOf('001', 'in-progress')], jobs: [LIVE_ASSISTANT, successor], logRecords }), FIXTURE_LIMITS);

    expect(stepKindsOf(steps)).toEqual(['park']);
  });

  test('keeps the attempt only after a red handoff: a session replaced after a crash takes the next attempt', () => {
    const replacedAfterCrash = [launchedRecord('J1', 'build', ['001']), interruptedRecord('J1', 'watcher-lost'), endedRecord('J1', 'replaced')];
    const steps = Playbook.nextStepsOf(factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: replacedAfterCrash }), FIXTURE_LIMITS);

    expect(steps).toEqual([{
      kind: 'launch-build', ticketId: '001', attempt: 2, base: 'main'
    }]);
  });
});

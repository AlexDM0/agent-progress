/**
 * The resume rules as pure verdicts. What matters: only an instance past the first is a resume, and it is told it was interrupted rather
 * than handed its task again; a resume fails only when the session exited by itself before it ever started; and only the newest earlier job
 * of the same work decides whether a fresh job inherits a replaced session's worktree.
 */
import { describe, expect, test } from 'bun:test';

import type { Job }       from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord } from '../../lib/tracker-model/@types/LogRecord.ts';
import { JobResumption }  from './JobResumption.ts';

const AT = '2026-09-18T22:11:03+02:00';

function buildJob(overrides: Partial<Job> = {}): Job {
  return {
    id:                 'J2',
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
    ...overrides,
  };
}

function launched(jobId: string, kind: 'build' | 'review', ticketIds: string[]): LogRecord {
  return {
    at:     AT,
    kind:   'job-launched',
    jobId,
    fields: {
      kind, role: kind === 'build' ? 'builder' : 'reviewer', ticketIds, attempt: 1, target: 'main', parentJobId: null
    }
  };
}

function ended(jobId: string, outcome: 'replaced' | 'failed'): LogRecord {
  return {
    at: AT, kind: 'job-ended', jobId, fields: { outcome, deniedPermissions: [] }
  };
}

describe('the launch of a job\'s current instance', () => {
  test('the first instance gets its task; a later one resumes and is told it was interrupted', () => {
    expect(JobResumption.launchPartsOf(buildJob(), 'Example task', 'Example resume')).toEqual({ resume: false, firstMessage: 'Example task' });
    expect(JobResumption.launchPartsOf(buildJob({ hostInstance: 2 }), 'Example task', 'Example resume')).toEqual({ resume: true, firstMessage: 'Example resume' });
  });
});

describe('a failed resume', () => {
  test('is a resumed instance that exited by itself before its session started', () => {
    expect(JobResumption.resumeFailed(buildJob({ hostInstance: 2 }), true, false)).toBe(true);
  });

  test('is never a first instance, a started session or one killed or lost before it started', () => {
    expect(JobResumption.resumeFailed(buildJob(), true, false)).toBe(false);
    expect(JobResumption.resumeFailed(buildJob({ hostInstance: 2 }), true, true)).toBe(false);
    expect(JobResumption.resumeFailed(buildJob({ hostInstance: 2 }), false, false)).toBe(false);
  });
});

describe('the earlier-session note', () => {
  test('goes to a fresh job whose newest earlier job of the same work ended replaced', () => {
    const records = [launched('J1', 'build', ['001']), ended('J1', 'replaced'), launched('J2', 'build', ['001'])];
    expect(JobResumption.earlierSessionWasReplaced(records, buildJob())).toBe(true);
  });

  test('does not go to a job whose newest earlier job ended otherwise, or whose replaced job did other work', () => {
    const laterFailure = [launched('J1', 'build', ['001']), ended('J1', 'replaced'), launched('J3', 'build', ['001']), ended('J3', 'failed')];
    expect(JobResumption.earlierSessionWasReplaced(laterFailure, buildJob({ id: 'J4' }))).toBe(false);
    const otherWork = [launched('J1', 'review', ['001']), ended('J1', 'replaced'), launched('J3', 'build', ['002']), ended('J3', 'replaced')];
    expect(JobResumption.earlierSessionWasReplaced(otherWork, buildJob({ id: 'J4' }))).toBe(false);
  });
});

/**
 * The resume rules as pure verdicts. What matters: only an instance past the first is a resume, and it is told it was interrupted rather
 * than handed its task again; a resume fails only when the session exited by itself before it ever started; and only the newest earlier job
 * of the same work decides whether a fresh job inherits a replaced session's worktree. A fresh instance's first message survives a Watcher
 * not yet listening and is sent once, its marker following the accepted frame.
 */
import { existsSync } from 'node:fs';
import { join }       from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { Job }                                       from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }                                 from '../../lib/tracker-model/@types/LogRecord.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { HostFleet }                                      from './HostFleet.ts';
import { JobResumption }                                  from './JobResumption.ts';
import { PlantedWatcher }                                 from './testing/PlantedWatcher.ts';

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

  test('a reopened product owner resumes with User\'s message, in the instance its reopening names only', () => {
    const reopened: LogRecord = {
      at: AT, kind: 'job-reopened', jobId: 'J2', fields: { hostInstance: 2, text: 'Example follow-up', offeredTicketIds: [] }
    };
    const job = buildJob({ kind: 'product-owner', role: 'product-owner', hostInstance: 2 });
    const reopenText = JobResumption.reopenTextOf([reopened], job);
    expect(JobResumption.launchPartsOf(job, 'Example task', 'Example resume', reopenText)).toEqual({ resume: true, firstMessage: 'Example follow-up' });
    expect(JobResumption.reopenTextOf([reopened], { ...job, hostInstance: 3 })).toBeNull();
  });
});

describe('the first message of a fresh instance', () => {
  let trackerDirectory = '';
  let monitorFolder    = '';

  beforeEach(() => {
    trackerDirectory = createScratchDirectory('first-message');
    monitorFolder    = createScratchDirectory('h');
  });

  afterEach(() => {
    removeScratchDirectory(trackerDirectory);
    removeScratchDirectory(monitorFolder);
  });

  function plantedLiveWatcher(job: Job): string {
    return PlantedWatcher.plantLiveWatcher({
      trackerDirectory, monitorFolder, jobId: job.id, instance: 1
    });
  }

  test('a Watcher refusing the first connection is sent the line on the next pass, and never again once it took it', async () => {
    const job        = buildJob();
    const jobs       = { jobs: (): readonly Readonly<Job>[] => [job] };
    const adapter    = { chatLineOf: (message: string): string => `chat:${message}` };
    const socketPath = plantedLiveWatcher(job);
    const jobFolder  = HostFleet.jobFolderOf(trackerDirectory, job.id);
    JobResumption.storeFirstMessage(jobFolder, 1, 'Example task');

    await JobResumption.deliverFirstMessages(trackerDirectory, jobs, adapter);
    expect(existsSync(join(jobFolder, 'first-message-1.sent'))).toBe(false);

    const received = await PlantedWatcher.framesReceivedWhile(socketPath, async () => {
      await JobResumption.deliverFirstMessages(trackerDirectory, jobs, adapter);
      await JobResumption.deliverFirstMessages(trackerDirectory, jobs, adapter);
    });
    const writes = received.filter((line) => line.includes('"write"'));
    expect(writes).toEqual([JSON.stringify({ kind: 'write', line: 'chat:Example task' })]);
    expect(existsSync(join(jobFolder, 'first-message-1.sent'))).toBe(true);
  });

  test('a resumed instance is never sent a stored first message', async () => {
    const job = buildJob({ hostInstance: 2 });
    plantedLiveWatcher(job);
    const jobFolder = HostFleet.jobFolderOf(trackerDirectory, job.id);
    JobResumption.storeFirstMessage(jobFolder, 2, 'Example task');
    await JobResumption.deliverFirstMessages(trackerDirectory, { jobs: () => [job] }, { chatLineOf: (message) => message });
    expect(existsSync(join(jobFolder, 'first-message-2.sent'))).toBe(false);
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

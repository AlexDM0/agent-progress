/**
 * The resume rules as pure verdicts. What matters: only an instance past the first is a resume, and it is told it was interrupted rather
 * than handed its task again; a resume fails only when the session exited by itself before it ever started; and only the newest earlier job
 * of the same work decides whether a fresh job inherits a replaced session's worktree. A fresh instance's first message survives a Watcher
 * not yet listening and is sent once, its marker following the accepted frame.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join }                  from 'node:path';
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
import { JobResumption }                                  from './JobResumption.ts';
import { RedHandoff, type RedHandoffFacts }               from './RedHandoff.ts';
import { WatcherFleet }                                   from './WatcherFleet.ts';
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
    watcherInstance:    1,
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

function ended(jobId: string, outcome: 'replaced' | 'failed' | 'built' | 'does-not-hold'): LogRecord {
  return {
    at: AT, kind: 'job-ended', jobId, fields: { outcome, deniedPermissions: [] }
  };
}

describe('the launch of a job\'s current instance', () => {
  test('the first instance gets its task; a later one resumes and is told it was interrupted', () => {
    expect(JobResumption.launchPartsOf(buildJob(), 'Example task', 'Example resume')).toEqual({ resume: false, firstMessage: 'Example task' });
    expect(JobResumption.launchPartsOf(buildJob({ watcherInstance: 2 }), 'Example task', 'Example resume')).toEqual({ resume: true, firstMessage: 'Example resume' });
  });

  test('a reopened product owner resumes with User\'s message, in the instance its reopening names only', () => {
    const reopened: LogRecord = {
      at: AT, kind: 'job-reopened', jobId: 'J2', fields: { watcherInstance: 2, text: 'Example follow-up', offeredTicketIds: [] }
    };
    const job = buildJob({ kind: 'product-owner', role: 'product-owner', watcherInstance: 2 });
    const reopenText = JobResumption.reopenTextOf([reopened], job);
    expect(JobResumption.launchPartsOf(job, 'Example task', 'Example resume', reopenText)).toEqual({ resume: true, firstMessage: 'Example follow-up' });
    expect(JobResumption.reopenTextOf([reopened], { ...job, watcherInstance: 3 })).toBeNull();
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
    const jobFolder  = WatcherFleet.jobFolderOf(trackerDirectory, job.id);
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
    const job = buildJob({ watcherInstance: 2 });
    plantedLiveWatcher(job);
    const jobFolder = WatcherFleet.jobFolderOf(trackerDirectory, job.id);
    JobResumption.storeFirstMessage(jobFolder, 2, 'Example task');
    await JobResumption.deliverFirstMessages(trackerDirectory, { jobs: () => [job] }, { chatLineOf: (message) => message });
    expect(existsSync(join(jobFolder, 'first-message-2.sent'))).toBe(false);
  });
});

describe('a failed resume', () => {
  test('is a resumed instance that exited by itself before its session started', () => {
    expect(JobResumption.resumeFailed(buildJob({ watcherInstance: 2 }), true, false)).toBe(true);
  });

  test('is never a first instance, a started session or one killed or lost before it started', () => {
    expect(JobResumption.resumeFailed(buildJob(), true, false)).toBe(false);
    expect(JobResumption.resumeFailed(buildJob({ watcherInstance: 2 }), true, true)).toBe(false);
    expect(JobResumption.resumeFailed(buildJob({ watcherInstance: 2 }), false, false)).toBe(false);
  });
});

// A review that did not hold resumes the builder's own session, so the build job after it carries on the session it was sent back from.
describe('the session a build job carries on', () => {
  const builtThenSentBack = [launched('J1', 'build', ['001']), ended('J1', 'built'), launched('R1', 'review', ['001']), ended('R1', 'does-not-hold')];

  test('is the builder its review sent back, across every later round', () => {
    expect(JobResumption.sessionOwnerJobIdOf([...builtThenSentBack, launched('J2', 'build', ['001'])], buildJob())).toBe('J1');
    const secondRound = [...builtThenSentBack, launched('J2', 'build', ['001']), ended('J2', 'built'), launched('J3', 'build', ['001'])];
    expect(JobResumption.sessionOwnerJobIdOf(secondRound, buildJob({ id: 'J3' }))).toBe('J1');
  });

  test('is the job itself when it starts a new attempt, as after an unhold', () => {
    const nextAttempt: LogRecord = { ...launched('J2', 'build', ['001']), fields: { ...launched('J2', 'build', ['001']).fields, attempt: 2 } } as LogRecord;
    expect(JobResumption.sessionOwnerJobIdOf([...builtThenSentBack, nextAttempt], buildJob({ id: 'J2', attempt: 2 }))).toBe('J2');
  });

  test('is the job itself after a replaced or failed build, and for a reviewer', () => {
    const afterReplaced = [launched('J1', 'build', ['001']), ended('J1', 'replaced'), launched('J2', 'build', ['001'])];
    expect(JobResumption.sessionOwnerJobIdOf(afterReplaced, buildJob())).toBe('J2');
    const review = buildJob({ id: 'R2', kind: 'review', role: 'reviewer' });
    expect(JobResumption.sessionOwnerJobIdOf([...builtThenSentBack, launched('R2', 'review', ['001'])], review)).toBe('R2');
  });

  test('is sent only the newest review section of the ticket', () => {
    const body = '## Report\nx\n\n## Review 1\n\nold\n\n## Review 2\n\n- A1 does-not-hold — the example fails\n\n## Notes\nlater\n';
    expect(JobResumption.newestReviewSectionOf(body)).toBe('## Review 2\n\n- A1 does-not-hold — the example fails');
    expect(JobResumption.newestReviewSectionOf('## Report\nx\n')).toBe('');
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

describe('a red handoff\'s resume', () => {
  let trackerDirectory = '';
  const messages = { resumeMessage: 'Example resume message', redHandoffMessageOf: (facts: Readonly<RedHandoffFacts>) => `Red ${facts.name}, resume ${facts.resume}` };

  beforeEach(() => {
    trackerDirectory = createScratchDirectory('red-resume');
  });

  afterEach(() => {
    removeScratchDirectory(trackerDirectory);
  });

  function writeRedFacts(jobId: string): void {
    const jobFolder = WatcherFleet.jobFolderOf(trackerDirectory, jobId);
    mkdirSync(jobFolder, { recursive: true });
    RedHandoff.writeRedHandoff(jobFolder, {
      kind:                'gate',
      name:                'tests',
      command:             'bun test',
      fixCommand:          null,
      commit:              'example-commit',
      exitCode:            1,
      batonPassPath:       RedHandoff.batonPassPathOf(jobFolder),
      fullLogPath:         null,
      resume:              1,
      resumesAllowed:      2,
      callBudget:          30,
      interruptedInstance: 1,
    }, 'expected 2, received 3');
  }

  function interrupted(jobId: string, cause: 'handoff-red' | 'watcher-lost'): LogRecord {
    return {
      at: AT, kind: 'job-interrupted', jobId, fields: { cause, watcherInstance: 1 }
    };
  }

  test('opens the resumed session with the red handoff\'s message, never the plain resume line', () => {
    writeRedFacts('J2');
    const board = { logRecordsSoFar: () => [] };

    expect(JobResumption.resumeLineOf(trackerDirectory, board, buildJob({ watcherInstance: 2, interruption: 'handoff-red' }), messages)).toBe('Red tests, resume 1');
    expect(JobResumption.resumeLineOf(trackerDirectory, board, buildJob({ watcherInstance: 2, interruption: 'watcher-lost' }), messages)).toBe('Example resume message');
  });

  test('hands a fresh session taking over an unresumable red handoff the same facts, its calls counted from its own first instance', () => {
    writeRedFacts('J1');
    const records = [launched('J1', 'build', ['001']), interrupted('J1', 'handoff-red'), ended('J1', 'replaced'), launched('J2', 'build', ['001'])];

    expect(JobResumption.redHandoffTakenOverOf(trackerDirectory, records, buildJob())).toMatchObject({ name: 'tests', resume: 1, interruptedInstance: 0 });
  });

  test('hands nothing to a fresh session whose predecessor was replaced after a crash', () => {
    writeRedFacts('J1');
    const records = [launched('J1', 'build', ['001']), interrupted('J1', 'watcher-lost'), ended('J1', 'replaced'), launched('J2', 'build', ['001'])];

    expect(JobResumption.redHandoffTakenOverOf(trackerDirectory, records, buildJob())).toBeNull();
  });
});

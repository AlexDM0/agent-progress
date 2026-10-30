/**
 * A build job's wind-down, close-input and stop frames against a planted Watcher. What matters: a Watcher refusing the first connection is
 * sent the frame on a later pass, its marker written only then; a frame taken once is never sent again, a restarted Overseer included, since
 * the marker is all that carries over; a Watcher no longer live is sent nothing and leaves no marker; and a session resumed after a red
 * handoff gets its own wind-down at the resume budget, counted from the resume.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join }                      from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { hostFilesOf }                                                     from '../../lib/agent-host/HostFiles.ts';
import { type HostRecord, hostRecordTextOf }                               from '../../lib/agent-host/HostRecord.ts';
import { EVENT_LOG_FORMAT_VERSION, HOST_PROTOCOL_VERSION }                 from '../../lib/agent-host/constants/HostProtocol.ts';
import type { Job }                                                        from '../../lib/tracker-model/@types/Job.ts';
import { DISPATCH_PROTOCOL }                                               from '../../shared/constants/DispatchProtocol.ts';
import { RED_HANDOFF_RESUME_CALL_BUDGET, SESSION_STOP_GRACE_MILLISECONDS } from '../../shared/constants/RunnerLimits.ts';
import { createScratchDirectory, removeScratchDirectory }                  from '../../testing/ScratchWorkspace.ts';
import { HostFleet }                                                       from './HostFleet.ts';
import { type BuildJobFrameRequest, JobLaunch }                            from './JobLaunch.ts';
import { RedHandoff, type RedHandoffFacts }                                from './RedHandoff.ts';
import { PlantedWatcher }                                                  from './testing/PlantedWatcher.ts';

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

function redHandoffFactsIn(jobFolder: string): RedHandoffFacts {
  return {
    kind:                'gate',
    name:                'tests',
    command:             'bun test',
    fixCommand:          null,
    commit:              'example-commit',
    exitCode:            1,
    handoverPath:        RedHandoff.handoverPathOf(jobFolder),
    fullLogPath:         join(jobFolder, 'gate.log'),
    resume:              1,
    resumesAllowed:      2,
    callBudget:          RED_HANDOFF_RESUME_CALL_BUDGET,
    interruptedInstance: 1,
  };
}

function actingFramesOf(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => !line.includes('"hello"'));
}

describe('a build job\'s frames to its Watcher', () => {
  let trackerDirectory = '';
  let monitorFolder    = '';
  let request: BuildJobFrameRequest;

  beforeEach(() => {
    trackerDirectory = createScratchDirectory('build-frames');
    monitorFolder    = createScratchDirectory('h');
    request = { trackerDirectory, agentAdapter: { chatLineOf: (message) => `chat:${message}` }, windDownMessage: 'Example wind-down' };
  });

  afterEach(() => {
    removeScratchDirectory(trackerDirectory);
    removeScratchDirectory(monitorFolder);
  });

  /** A pass against a Watcher refusing the connection, then two while it listens: the frames it received and the marker after each phase. */
  async function passesAcrossARefusal(job: Job, marker: string): Promise<{ markedWhileRefusing: boolean; frames: readonly string[]; marked: boolean }> {
    const socketPath = PlantedWatcher.plantLiveWatcher({
      trackerDirectory, monitorFolder, jobId: job.id, instance: 1
    });
    const markerPath = join(HostFleet.jobFolderOf(trackerDirectory, job.id), marker);
    await JobLaunch.deliverBuildJobFrames(request, job, 0);
    const markedWhileRefusing = existsSync(markerPath);
    const frames = await PlantedWatcher.framesReceivedWhile(socketPath, async () => {
      await JobLaunch.deliverBuildJobFrames(request, job, 0);
      await JobLaunch.deliverBuildJobFrames(request, job, 0);
    });
    return { markedWhileRefusing, frames: actingFramesOf(frames), marked: existsSync(markerPath) };
  }

  test('a stopping job\'s stop frame reaches a Watcher that refused the first connection on the next pass, marked only then and sent once', async () => {
    const outcome = await passesAcrossARefusal(buildJob({ state: 'stopping' }), 'stop-sent');
    expect(outcome).toEqual({ markedWhileRefusing: false, frames: [JSON.stringify({ kind: 'stop', graceMilliseconds: SESSION_STOP_GRACE_MILLISECONDS })], marked: true });
  });

  test('a verifying job\'s close-input reaches a Watcher that refused the first connection on the next pass, marked only then and sent once', async () => {
    const outcome = await passesAcrossARefusal(buildJob({ state: 'verifying' }), 'input-closed');
    expect(outcome).toEqual({ markedWhileRefusing: false, frames: [JSON.stringify({ kind: 'close-input' })], marked: true });
  });

  test('a job over its call budget is sent its wind-down turn on the pass after a refused one', async () => {
    const job = buildJob();
    const socketPath = PlantedWatcher.plantLiveWatcher({
      trackerDirectory, monitorFolder, jobId: job.id, instance: 1
    });
    const calls = DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET;
    await JobLaunch.deliverBuildJobFrames(request, job, calls);
    const frames = await PlantedWatcher.framesReceivedWhile(socketPath, async () => {
      await JobLaunch.deliverBuildJobFrames(request, job, calls);
    });
    expect(actingFramesOf(frames)).toEqual([JSON.stringify({ kind: 'write', line: 'chat:Example wind-down' })]);
  });

  test('a session resumed after a red handoff is sent its own wind-down at the resume budget, counted from the resume', async () => {
    const job = buildJob({ hostInstance: 2 });
    const jobFolder = HostFleet.jobFolderOf(trackerDirectory, job.id);
    RedHandoff.writeRedHandoff(jobFolder, redHandoffFactsIn(jobFolder), 'expected 2, received 3');
    writeFileSync(join(jobFolder, 'wind-down-sent'), '');
    const socketPath = PlantedWatcher.plantLiveWatcher({
      trackerDirectory, monitorFolder, jobId: job.id, instance: 2
    });
    const frames = await PlantedWatcher.framesReceivedWhile(socketPath, async () => {
      await JobLaunch.deliverBuildJobFrames(request, job, RED_HANDOFF_RESUME_CALL_BUDGET - 1);
      await JobLaunch.deliverBuildJobFrames(request, job, RED_HANDOFF_RESUME_CALL_BUDGET);
    });
    expect(actingFramesOf(frames)).toEqual([JSON.stringify({ kind: 'write', line: 'chat:Example wind-down' })]);
    expect(existsSync(join(jobFolder, 'wind-down-sent-2'))).toBe(true);
  });

  test('a frame taken before an Overseer restart is not sent again by the restarted one', async () => {
    const job = buildJob({ state: 'stopping' });
    const socketPath = PlantedWatcher.plantLiveWatcher({
      trackerDirectory, monitorFolder, jobId: job.id, instance: 1
    });
    const beforeRestart = await PlantedWatcher.framesReceivedWhile(socketPath, async () => {
      await JobLaunch.deliverBuildJobFrames(request, job, 0);
    });
    const restartedRequest: BuildJobFrameRequest = { ...request };
    const afterRestart = await PlantedWatcher.framesReceivedWhile(socketPath, async () => {
      await JobLaunch.deliverBuildJobFrames(restartedRequest, buildJob({ state: 'stopping' }), 0);
    });
    expect([actingFramesOf(beforeRestart).length, afterRestart]).toEqual([1, []]);
  });

  test('a Watcher no longer live is sent nothing and leaves no marker', async () => {
    const job = buildJob({ state: 'stopping' });
    const socketPath = PlantedWatcher.plantLiveWatcher({
      trackerDirectory, monitorFolder, jobId: job.id, instance: 1
    });
    const lostRecord: HostRecord = {
      protocolVersion: HOST_PROTOCOL_VERSION, eventLogFormatVersion: EVENT_LOG_FORMAT_VERSION, hostInstance: 1, state: 'running', host: null,
    };
    writeFileSync(hostFilesOf(HostFleet.jobFolderOf(trackerDirectory, job.id), 1).hostRecordPath, hostRecordTextOf(lostRecord));
    const frames = await PlantedWatcher.framesReceivedWhile(socketPath, async () => {
      await JobLaunch.deliverBuildJobFrames(request, job, 0);
    });
    expect([frames, existsSync(join(HostFleet.jobFolderOf(trackerDirectory, job.id), 'stop-sent'))]).toEqual([[], false]);
  });
});

/**
 * The runner's reaping of ended hosts, against the real host binary. What matters: an ended host lingers for its acknowledgement, and the
 * sweep over the tracker's job folders gives it, so the host process is gone once its job ended, an agent host and a process host in its
 * job's subfolder alike; a host still running its child is never touched.
 */
import { mkdirSync, symlinkSync } from 'node:fs';
import { join }                   from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { processIsGone }                                    from '../../lib/process-identity/ProcessIdentity.ts';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }          from '../../testing/ChildProcessCaseTimeout.ts';
import { type HostJob, createHostJob, HOST_JOB_IDENTIFIER } from '../../testing/HostJob.ts';
import { createScratchDirectory, removeScratchDirectory }   from '../../testing/ScratchWorkspace.ts';
import { HostFleet }                                        from './HostFleet.ts';

const HOST_BINARY_PATH = new URL('../../../agent-host.ts', import.meta.url).pathname;
const POLL_MILLISECONDS = 20;

let currentHostJob: HostJob | null = null;
let trackerDirectory = '';

beforeEach(() => {
  currentHostJob = createHostJob();
  trackerDirectory = createScratchDirectory('tracker');
  mkdirSync(join(trackerDirectory, 'jobs'));
  symlinkSync(currentHostJob.jobFolder, join(trackerDirectory, 'jobs', HOST_JOB_IDENTIFIER));
});

afterEach(() => {
  currentHostJob?.remove();
  currentHostJob = null;
  removeScratchDirectory(trackerDirectory);
});

function hostJob(): HostJob {
  if (currentHostJob === null) throw new Error('no host job');
  return currentHostJob;
}

async function untilEnded(hostFolder: string, instance: number): Promise<void> {
  while (HostFleet.livenessOf(hostFolder, instance).verdict !== 'ended') await Bun.sleep(POLL_MILLISECONDS);
}

async function untilGone(processId: number): Promise<void> {
  while (!processIsGone(processId)) await Bun.sleep(POLL_MILLISECONDS);
}

describe('reaping ended hosts', () => {
  test('an ended agent host lingers until the sweep acknowledges its end, then exits 0', async () => {
    hostJob().writeLaunch(1, 'agent', 'console.log("done");');
    const host = hostJob().spawnHost(1);
    await untilEnded(hostJob().jobFolder, 1);
    await Bun.sleep(POLL_MILLISECONDS * 5);
    expect(host.exitCode).toBeNull();
    expect(await HostFleet.reapEndedHosts(trackerDirectory)).toBe(1);
    expect(await host.exited).toBe(0);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('an ended process host in its job\'s subfolder is reaped by the same sweep', async () => {
    const hostFolder = join(hostJob().jobFolder, 'gate-1');
    HostFleet.writeProcessLaunchFile({
      hostFolder,
      instance:         1,
      jobId:            HOST_JOB_IDENTIFIER,
      socketName:       `${HOST_JOB_IDENTIFIER}/gate-1`,
      trackerId:        'tracker-example',
      monitorFolder:    hostJob().monitorFolder,
      hostCodeVersion:  'code-example',
      workingDirectory: hostFolder,
      argv:             [process.execPath, '-e', 'console.log("gate passed");'],
      environment:      {},
    });
    const processId = HostFleet.spawnHost({ bundlePath: HOST_BINARY_PATH, jobFolder: hostFolder, instance: 1 });
    if (processId === undefined) throw new Error('the process host did not spawn');
    await untilEnded(hostFolder, 1);
    expect(processIsGone(processId)).toBe(false);
    expect(await HostFleet.reapEndedHosts(trackerDirectory)).toBe(1);
    await untilGone(processId);
    expect(processIsGone(processId)).toBe(true);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a host still running its child is left alone', async () => {
    hostJob().writeLaunch(1, 'agent', 'setInterval(() => undefined, 1000);');
    const host = hostJob().spawnHost(1);
    const client = await hostJob().attach(1);
    await client.nextFrame((frame) => frame.kind === 'welcome');
    expect(HostFleet.livenessOf(hostJob().jobFolder, 1).verdict).toBe('live');
    expect(await HostFleet.reapEndedHosts(trackerDirectory)).toBe(0);
    expect(host.exitCode).toBeNull();
    client.send({ kind: 'stop', graceMilliseconds: 0 });
    await untilEnded(hostJob().jobFolder, 1);
    expect(await HostFleet.reapEndedHostsIn(hostJob().jobFolder)).toBe(1);
    expect(await host.exited).toBe(0);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

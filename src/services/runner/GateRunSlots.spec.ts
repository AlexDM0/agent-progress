/**
 * The machine-wide cap on gate runs. What matters: with the cap at 2 a third gate run waits until one of the two ends; a holder asking
 * again keeps the slot it holds rather than taking a second; a slot whose holder is no longer live is taken over without a release; and
 * the slots are files, so two Overseers sharing the folder share the cap. A gate host that never claimed is judged by the process
 * recorded with its slot, the acquirer's until the spawn is recorded, and one whose job folder is gone frees its slot: else a host dying
 * before its claim would hold a slot for good.
 */
import { mkdirSync } from 'node:fs';
import { join }      from 'node:path';

import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { identityOf, type ProcessIdentity }                           from '../../lib/process-identity/ProcessIdentity.ts';
import { createScratchDirectory, removeScratchDirectory }             from '../../testing/ScratchWorkspace.ts';
import { createGateRunSlots, gateRunHolderIsLive, type GateRunSlots } from './GateRunSlots.ts';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

const RETRY_MILLISECONDS = 5;

function slotsIn(folder: string, liveHolders: Set<string>): GateRunSlots {
  return createGateRunSlots({
    folder, limit: 2, holderIsLive: (holding) => liveHolders.has(holding.holder), retryMilliseconds: RETRY_MILLISECONDS,
  });
}

function hostJudgedSlotsIn(folder: string): GateRunSlots {
  return createGateRunSlots({
    folder, limit: 2, holderIsLive: gateRunHolderIsLive, retryMilliseconds: RETRY_MILLISECONDS,
  });
}

function scratchFolder(): string {
  const folder = createScratchDirectory('gate-slots');
  scratchDirectories.push(folder);
  return folder;
}

describe('the gate run slots', () => {
  test('with the cap at 2 and three gate runs due, the third waits until one ends', async () => {
    const liveHolders = new Set(['first', 'second', 'third']);
    const slots = slotsIn(scratchFolder(), liveHolders);
    const releaseFirst = await slots.acquire('first');
    await slots.acquire('second');
    let thirdStarted = false;

    const third = slots.acquire('third').then(() => {
      thirdStarted = true;
    });
    await Bun.sleep(RETRY_MILLISECONDS * 4);
    expect(thirdStarted).toBe(false);

    releaseFirst();
    await third;
    expect(thirdStarted).toBe(true);
  });

  test('two Overseers sharing the folder share the cap', () => {
    const folder = scratchFolder();
    const liveHolders = new Set(['overseer-one', 'overseer-two', 'overseer-three']);

    expect(slotsIn(folder, liveHolders).tryAcquire('overseer-one')).toBe(true);
    expect(slotsIn(folder, liveHolders).tryAcquire('overseer-two')).toBe(true);
    expect(slotsIn(folder, liveHolders).tryAcquire('overseer-three')).toBe(false);
  });

  test('a holder asking again keeps its one slot', () => {
    const slots = slotsIn(scratchFolder(), new Set(['host-a', 'host-b']));

    expect(slots.tryAcquire('host-a')).toBe(true);
    expect(slots.tryAcquire('host-a')).toBe(true);
    expect(slots.tryAcquire('host-b')).toBe(true);
  });

  test('a slot whose holder ended is taken over without a release', () => {
    const liveHolders = new Set(['ended-host', 'live-host', 'waiting-host']);
    const slots = slotsIn(scratchFolder(), liveHolders);
    slots.tryAcquire('ended-host');
    slots.tryAcquire('live-host');
    expect(slots.tryAcquire('waiting-host')).toBe(false);

    liveHolders.delete('ended-host');

    expect(slots.tryAcquire('waiting-host')).toBe(true);
  });
});

describe('a gate host that has not claimed', () => {
  function gateHostFolderIn(scratch: string, jobId: string): string {
    const jobFolder = join(scratch, 'jobs', jobId);
    mkdirSync(jobFolder, { recursive: true });
    return join(jobFolder, 'gate-1');
  }

  function sleeperIdentity(): { identity: ProcessIdentity; stop: () => Promise<void> } {
    const sleeper = Bun.spawn(['sleep', '30'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    const identity = identityOf(sleeper.pid);
    if (identity === null) throw new Error('the sleeper has no readable identity');
    return {
      identity,
      stop: async () => {
        sleeper.kill();
        await sleeper.exited;
      },
    };
  }

  /** Both slots taken by never-claimed gate hosts answered for by `firstProcess` and `secondProcess`. */
  function fullSlots(scratch: string, firstProcess: ProcessIdentity | null, secondProcess: ProcessIdentity | null): { slots: GateRunSlots; first: string; second: string } {
    const slots = hostJudgedSlotsIn(join(scratch, 'slots'));
    const first = gateHostFolderIn(scratch, 'first-job');
    const second = gateHostFolderIn(scratch, 'second-job');
    expect(slots.tryAcquire(first)).toBe(true);
    expect(slots.tryAcquire(second)).toBe(true);
    slots.recordSpawnedProcess(first, firstProcess);
    slots.recordSpawnedProcess(second, secondProcess);
    return { slots, first, second };
  }

  test('frees its slot once its spawned process is gone', async () => {
    const scratch = scratchFolder();
    const spawned = sleeperIdentity();
    const { slots } = fullSlots(scratch, spawned.identity, identityOf(process.pid));

    await spawned.stop();

    expect(slots.tryAcquire(gateHostFolderIn(scratch, 'waiting-job'))).toBe(true);
  });

  test('frees its slot once its job folder is gone, its recorded process still running', async () => {
    const scratch = scratchFolder();
    const { slots } = fullSlots(scratch, identityOf(process.pid), identityOf(process.pid));

    removeScratchDirectory(join(scratch, 'jobs', 'first-job'));

    expect(slots.tryAcquire(gateHostFolderIn(scratch, 'waiting-job'))).toBe(true);
  });

  test('keeps its slot while its spawned process runs', async () => {
    const scratch = scratchFolder();
    const spawned = sleeperIdentity();
    try {
      const { slots } = fullSlots(scratch, spawned.identity, identityOf(process.pid));

      expect(slots.tryAcquire(gateHostFolderIn(scratch, 'waiting-job'))).toBe(false);
    } finally {
      await spawned.stop();
    }
  });

  test('keeps its slot between the acquire and the recorded spawn, answered for by the acquiring process', () => {
    const scratch = scratchFolder();
    const slots = hostJudgedSlotsIn(join(scratch, 'slots'));
    expect(slots.tryAcquire(gateHostFolderIn(scratch, 'first-job'))).toBe(true);
    expect(slots.tryAcquire(gateHostFolderIn(scratch, 'second-job'))).toBe(true);

    expect(slots.tryAcquire(gateHostFolderIn(scratch, 'waiting-job'))).toBe(false);
  });

  test('frees its slot when its spawn left no process', () => {
    const scratch = scratchFolder();
    const { slots } = fullSlots(scratch, null, identityOf(process.pid));

    expect(slots.tryAcquire(gateHostFolderIn(scratch, 'waiting-job'))).toBe(true);
  });
});

/**
 * The machine-wide cap on gate runs. What matters: with the cap at 2 a third gate run waits until one of the two ends; a holder asking
 * again keeps the slot it holds rather than taking a second; a slot whose holder is no longer live is taken over without a release; and
 * the slots are files, so two Overseers sharing the folder share the cap.
 */
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { createGateRunSlots, type GateRunSlots }          from './GateRunSlots.ts';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

const RETRY_MILLISECONDS = 5;

function slotsIn(folder: string, liveHolders: Set<string>): GateRunSlots {
  return createGateRunSlots({
    folder, limit: 2, holderIsLive: (holder) => liveHolders.has(holder), retryMilliseconds: RETRY_MILLISECONDS,
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

/**
 * The things `withLock` promises: serialisation, takeover of a lock whose holder is gone, at most one
 * holder when waiters race a takeover at any of its steps, a dead taker's marker cleared, and the
 * fail-closed direction — a fresh unreadable lock or marker is waited for, never assumed free.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { afterAll, expect, test } from 'bun:test';

import { LOCK_RETRY_COUNT, LOCK_RETRY_INTERVAL_MILLISECONDS } from '../constants/Limits';
import { createScratchDirectory, removeScratchDirectory }     from '../tooling/dev/ScratchWorkspace';
import { LockTakeoverSteps, withLock }                        from './Lock';
import { refusalIsOperationRefusal }                          from './OperationRefusal';
import { workspacePathsFor }                                  from './Workspace';
import type { Workspace }                                     from './Workspace';

const REFUSAL_TEST_TIMEOUT_MILLISECONDS = LOCK_RETRY_COUNT * LOCK_RETRY_INTERVAL_MILLISECONDS * 3;

const HELD_ACTION_MILLISECONDS = LOCK_RETRY_INTERVAL_MILLISECONDS * 4;

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchWorkspace(prefix: string): Workspace {
  const rootDirectory = createScratchDirectory(prefix);
  scratchDirectories.push(rootDirectory);
  const workspace = workspacePathsFor(rootDirectory);
  mkdirSync(workspace.trackerDirectory, { recursive: true });
  return workspace;
}

const realClock = (): Date => new Date();

async function processIdOfAnExitedProcess(): Promise<number> {
  const child = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], { stdout: 'ignore', stderr: 'ignore' });
  const { pid } = child;
  await child.exited;
  return pid;
}

test('two overlapping calls run one after the other, never inside one another', async () => {
  const workspace = scratchWorkspace('lock-serialise');
  const observedOrder: string[] = [];

  const firstCall = withLock(workspace, async () => {
    observedOrder.push('first entered');
    await Bun.sleep(HELD_ACTION_MILLISECONDS);
    observedOrder.push('first left');
    return 'first';
  }, realClock);
  const secondCall = withLock(workspace, () => {
    observedOrder.push('second entered');
    observedOrder.push('second left');
    return 'second';
  }, realClock);

  expect(await Promise.all([firstCall, secondCall])).toEqual(['first', 'second']);
  expect(observedOrder).toEqual(['first entered', 'first left', 'second entered', 'second left']);
});

test('the lock file is gone once the action has finished', async () => {
  const workspace = scratchWorkspace('lock-released');
  await withLock(workspace, () => 'done', realClock);
  expect(existsSync(workspace.lockFilePath)).toBe(false);
});

test('an action that throws still gives the lock back', async () => {
  const workspace = scratchWorkspace('lock-released-on-throw');
  await expect(withLock(workspace, () => {
    throw new Error('the action failed');
  }, realClock)).rejects.toThrow('the action failed');
  expect(existsSync(workspace.lockFilePath)).toBe(false);
  expect(await withLock(workspace, () => 'the next command still works', realClock)).toBe('the next command still works');
});

test('the held lock names the process holding it and when it took it', async () => {
  const workspace = scratchWorkspace('lock-payload');
  const payloadWhileHeld = await withLock(workspace, () => JSON.parse(readFileSync(workspace.lockFilePath, 'utf8')) as { processId: number; acquiredAt: string }, realClock);
  expect(payloadWhileHeld.processId).toBe(process.pid);
  expect(payloadWhileHeld.acquiredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  expect(Number.isNaN(Date.parse(payloadWhileHeld.acquiredAt))).toBe(false);
});

test('a lock left behind by a process that no longer exists is taken over at once', async () => {
  // The timestamp is deliberately fresh: the writer being gone is enough on its own.
  const workspace = scratchWorkspace('lock-dead-holder');
  const deadProcessId = await processIdOfAnExitedProcess();
  writeFileSync(workspace.lockFilePath, JSON.stringify({ acquiredAt: new Date().toISOString(), processId: deadProcessId }));

  const startedAt = Date.now();
  expect(await withLock(workspace, () => 'taken over', realClock)).toBe('taken over');
  expect(Date.now() - startedAt, 'the takeover did not wait out the retry budget').toBeLessThan(LOCK_RETRY_COUNT * LOCK_RETRY_INTERVAL_MILLISECONDS);
  expect(existsSync(workspace.lockFilePath)).toBe(false);
});

test('a lock older than the stale threshold is taken over even when its writer is alive', async () => {
  const workspace = scratchWorkspace('lock-old-holder');
  writeFileSync(workspace.lockFilePath, JSON.stringify({ acquiredAt: '2026-09-18T20:11:03+02:00', processId: process.pid }));
  const longAfterwards = (): Date => new Date(Date.parse('2026-09-18T21:11:03+02:00'));
  expect(await withLock(workspace, () => 'taken over', longAfterwards)).toBe('taken over');
});

test('an unparseable lock file is taken over only once it is older than the threshold', async () => {
  const workspace = scratchWorkspace('lock-unparseable-old');
  writeFileSync(workspace.lockFilePath, 'this is not JSON');
  const anHourAgoInSeconds = Date.now() / 1000 - 3600;
  utimesSync(workspace.lockFilePath, anHourAgoInSeconds, anHourAgoInSeconds);
  expect(await withLock(workspace, () => 'taken over', realClock)).toBe('taken over');
});

test('a freshly written unparseable lock is waited for and then refused, rather than assumed free', async () => {
  const workspace = scratchWorkspace('lock-unparseable-fresh');
  writeFileSync(workspace.lockFilePath, '');

  let caught: unknown = null;
  try {
    await withLock(workspace, () => 'must not run', realClock);
  } catch (error) {
    caught = error;
  }

  expect(refusalIsOperationRefusal(caught)).toBe(true);
  expect(refusalIsOperationRefusal(caught) ? caught.status : null).toBe('unrepaired');
  expect(refusalIsOperationRefusal(caught) ? caught.message : '').toContain(workspace.lockFilePath);
  expect(readFileSync(workspace.lockFilePath, 'utf8'), 'the lock it refused to take is left exactly as it was').toBe('');
}, REFUSAL_TEST_TIMEOUT_MILLISECONDS);

test('a lock path that is a directory refuses the same way, and the message does not call it a file', async () => {
  const workspace = scratchWorkspace('lock-directory');
  mkdirSync(workspace.lockFilePath);

  let caught: unknown = null;
  try {
    await withLock(workspace, () => 'must not run', realClock);
  } catch (error) {
    caught = error;
  }

  expect(refusalIsOperationRefusal(caught)).toBe(true);
  const message = refusalIsOperationRefusal(caught) ? caught.message : '';
  expect(message).toContain(workspace.lockFilePath);
  expect(message).toContain('remove that path');
  expect(message, 'there is no file here to delete').not.toContain('that file');
}, REFUSAL_TEST_TIMEOUT_MILLISECONDS);

test('a lock whose payload carries an impossible process id is never signalled with it', async () => {
  // `process.kill(0, …)` would signal the caller's whole process group, so a non-positive id never reaches it.
  const workspace = scratchWorkspace('lock-impossible-process-id');
  writeFileSync(workspace.lockFilePath, JSON.stringify({ acquiredAt: '2026-09-18T20:11:03+02:00', processId: 0 }));
  const longAfterwards = (): Date => new Date(Date.parse('2026-09-18T21:11:03+02:00'));
  expect(await withLock(workspace, () => 'taken over', longAfterwards)).toBe('taken over');
});

test('of two waiters that both judged one lock stale, the later taker restores the earlier one\'s fresh lock and does not acquire', async () => {
  // Replays the race step by step: B judges the dead holder's lock stale, A takes it over and acquires, and only then does B rename.
  const { acquired, lockIsStale, tookOverStaleLock } = LockTakeoverSteps;
  const workspace = scratchWorkspace('lock-takeover-race');
  const { lockFilePath } = workspace;
  writeFileSync(lockFilePath, JSON.stringify({ acquiredAt: new Date().toISOString(), processId: await processIdOfAnExitedProcess() }));
  const firstWaiterPayload = { acquiredAt: '2026-09-24T15:00:00+02:00', processId: process.pid };
  const secondWaiterPayload = { acquiredAt: '2026-09-24T15:00:01+02:00', processId: process.pid };
  const nowMilliseconds = Date.parse('2026-09-24T15:00:02+02:00');

  expect(lockIsStale(lockFilePath, nowMilliseconds), 'the second waiter judges the dead holder\'s lock stale').toBe(true);
  expect(lockIsStale(lockFilePath, nowMilliseconds)).toBe(true);
  expect(tookOverStaleLock(lockFilePath, nowMilliseconds)).toBe(true);
  expect(acquired(lockFilePath, firstWaiterPayload), 'the first waiter holds the lock').toBe(true);

  const secondWaiterTookOver = tookOverStaleLock(lockFilePath, nowMilliseconds);
  const secondWaiterAcquired = secondWaiterTookOver && acquired(lockFilePath, secondWaiterPayload);

  expect(secondWaiterTookOver, 'the first waiter\'s fresh lock is not stale').toBe(false);
  expect(secondWaiterAcquired).toBe(false);
  expect(JSON.parse(readFileSync(lockFilePath, 'utf8'))).toEqual(firstWaiterPayload);
  expect(readdirSync(workspace.trackerDirectory).filter((name) => name.includes('.stale.')), 'the restored lock leaves no copy aside').toEqual([]);
});

interface ThreeWaiterRace {
  lockFilePath:        string;
  firstWaiterPayload:  { acquiredAt: string; processId: number };
  secondWaiterPayload: { acquiredAt: string; processId: number };
  nowMilliseconds:     number;
}

// The first waiter has taken over a dead holder's lock and acquired it; the second judged that dead lock stale before it did.
async function raceWhereTheFirstWaiterHoldsTheLock(prefix: string): Promise<ThreeWaiterRace> {
  const { acquired, lockIsStale, tookOverStaleLock } = LockTakeoverSteps;
  const { lockFilePath } = scratchWorkspace(prefix);
  writeFileSync(lockFilePath, JSON.stringify({ acquiredAt: new Date().toISOString(), processId: await processIdOfAnExitedProcess() }));
  const race = {
    firstWaiterPayload:  { acquiredAt: '2026-09-24T15:00:00+02:00', processId: process.pid },
    lockFilePath,
    nowMilliseconds:     Date.parse('2026-09-24T15:00:02+02:00'),
    secondWaiterPayload: { acquiredAt: '2026-09-24T15:00:01+02:00', processId: process.pid },
  };
  expect(lockIsStale(lockFilePath, race.nowMilliseconds), 'the second waiter judges the dead holder\'s lock stale').toBe(true);
  expect(tookOverStaleLock(lockFilePath, race.nowMilliseconds)).toBe(true);
  expect(acquired(lockFilePath, race.firstWaiterPayload), 'the first waiter holds the lock').toBe(true);
  return race;
}

// The interleaving is driven by the takeover's own step callback: a third waiter's acquire runs at one step boundary per case, every boundary covered.
test('while the second waiter takes over, a third waiter acquiring at any step never makes two holders', async () => {
  const { acquired, takeoverSteps, tookOverStaleLock } = LockTakeoverSteps;
  expect(takeoverSteps.length).toBeGreaterThan(0);
  for (const intrusionStep of takeoverSteps) {
    const race = await raceWhereTheFirstWaiterHoldsTheLock('lock-three-waiters');
    const thirdWaiterPayload = { acquiredAt: '2026-09-24T15:00:01+02:00', processId: process.pid + 1 };
    let thirdWaiterAcquired = false;
    const secondWaiterTookOver = tookOverStaleLock(race.lockFilePath, race.nowMilliseconds, (step) => {
      if (step === intrusionStep) thirdWaiterAcquired = acquired(race.lockFilePath, thirdWaiterPayload);
    });
    const secondWaiterAcquired = secondWaiterTookOver && acquired(race.lockFilePath, race.secondWaiterPayload);

    const waitersHoldingTheLock = [true, thirdWaiterAcquired, secondWaiterAcquired].filter(Boolean).length;
    expect(waitersHoldingTheLock, `waiters holding the lock with the third acquiring at ${intrusionStep}`).toBe(1);
    expect(JSON.parse(readFileSync(race.lockFilePath, 'utf8'))).toEqual(race.firstWaiterPayload);
  }
});

test('a lock its holder released during the second waiter\'s takeover is never put back', async () => {
  const { releaseIfStillOurs, takeoverSteps, tookOverStaleLock } = LockTakeoverSteps;
  let releasesMade = 0;
  for (const releaseStep of takeoverSteps) {
    const race = await raceWhereTheFirstWaiterHoldsTheLock('lock-released-aside');
    let firstWaiterReleased = false;
    tookOverStaleLock(race.lockFilePath, race.nowMilliseconds, (step) => {
      if (step !== releaseStep) return;
      releaseIfStillOurs(race.lockFilePath, race.firstWaiterPayload);
      firstWaiterReleased = true;
    });
    if (firstWaiterReleased) releasesMade++;
    const firstWaiterLockIsInPlace = existsSync(race.lockFilePath) && Bun.deepEquals(JSON.parse(readFileSync(race.lockFilePath, 'utf8')), race.firstWaiterPayload);
    expect(firstWaiterLockIsInPlace, `the first waiter's lock with its release at ${releaseStep}`).toBe(!firstWaiterReleased);
  }
  expect(releasesMade, 'a step boundary the takeover reaches ran the release').toBeGreaterThan(0);
});

test('a takeover marker left by a taker that died is removed, and the stale lock is then taken', async () => {
  const { takeoverMarkerPathFor } = LockTakeoverSteps;
  const workspace = scratchWorkspace('lock-dead-taker');
  const markerPath = takeoverMarkerPathFor(workspace.lockFilePath);
  writeFileSync(workspace.lockFilePath, JSON.stringify({ acquiredAt: new Date().toISOString(), processId: await processIdOfAnExitedProcess() }));
  writeFileSync(markerPath, JSON.stringify({ acquiredAt: new Date().toISOString(), processId: await processIdOfAnExitedProcess() }));

  expect(await withLock(workspace, () => 'taken over', realClock)).toBe('taken over');
  expect(existsSync(markerPath), 'the dead taker\'s marker is gone').toBe(false);
  expect(readdirSync(workspace.trackerDirectory).filter((name) => name.includes('.stale.'))).toEqual([]);
});

// Fail closed: an empty marker is also what a marker being written at this instant looks like.
test('a freshly written unreadable takeover marker blocks the takeover and is left in place', async () => {
  const { takeoverMarkerPathFor, tookOverStaleLock } = LockTakeoverSteps;
  const { lockFilePath } = scratchWorkspace('lock-unreadable-marker');
  const markerPath = takeoverMarkerPathFor(lockFilePath);
  writeFileSync(lockFilePath, JSON.stringify({ acquiredAt: new Date().toISOString(), processId: await processIdOfAnExitedProcess() }));
  writeFileSync(markerPath, '');

  expect(tookOverStaleLock(lockFilePath, Date.now())).toBe(false);
  expect(readFileSync(markerPath, 'utf8')).toBe('');
  expect(existsSync(lockFilePath), 'the stale lock waits for the marker\'s holder').toBe(true);
});

test('the action\'s return value is handed back, including when it is not a promise', async () => {
  const workspace = scratchWorkspace('lock-return-value');
  expect(await withLock(workspace, () => ({ id: 18, name: 'Review pass' }), realClock)).toEqual({ id: 18, name: 'Review pass' });
});

/**
 * The things `withLock` promises: serialisation, takeover of a lock whose holder is gone, exactly one
 * winner when two waiters race for the same stale lock, and the fail-closed direction — a fresh
 * unreadable lock is waited for and refused, never assumed free.
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

test('the action\'s return value is handed back, including when it is not a promise', async () => {
  const workspace = scratchWorkspace('lock-return-value');
  expect(await withLock(workspace, () => ({ id: 18, name: 'Review pass' }), realClock)).toEqual({ id: 18, name: 'Review pass' });
});

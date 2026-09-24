/**
 * The things `withLock` promises: serialisation, takeover of a lock whose holder is gone or overran, at
 * most one holder when acquirers and releasers interleave at any step of an acquire, a holder that was
 * taken over never releasing its successor, and the fail-closed direction — a fresh unreadable record
 * or a path that is not the lock directory is waited for, never assumed free.
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
import { LockGenerationSteps, withLock }                      from './Lock';
import { refusalIsOperationRefusal }                          from './OperationRefusal';
import { workspacePathsFor }                                  from './Workspace';
import type { Workspace }                                     from './Workspace';

const {
  acquireSteps,
  attemptedAcquire,
  generationPathFor,
  generationsIn,
  released
} = LockGenerationSteps;

const REFUSAL_TEST_TIMEOUT_MILLISECONDS = LOCK_RETRY_COUNT * LOCK_RETRY_INTERVAL_MILLISECONDS * 3;

const HELD_ACTION_MILLISECONDS = LOCK_RETRY_INTERVAL_MILLISECONDS * 4;

const OVERRUN_HOLDER_ACQUIRED_AT = '2026-09-18T20:11:03+02:00';

const LONG_AFTER_THE_OVERRUN_MILLISECONDS = Date.parse('2026-09-18T21:11:03+02:00');

const RACE_MOMENT_MILLISECONDS = Date.parse('2026-09-24T15:00:30+02:00');

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

function writeGeneration(lockDirectoryPath: string, generation: number, content: string): void {
  mkdirSync(lockDirectoryPath, { recursive: true });
  writeFileSync(generationPathFor(lockDirectoryPath, generation), content);
}

function newestRecordIn(lockDirectoryPath: string): unknown {
  const newest = (generationsIn(lockDirectoryPath) ?? []).at(-1);
  return newest === undefined ? null : JSON.parse(readFileSync(generationPathFor(lockDirectoryPath, newest), 'utf8'));
}

// Every waiter in a replayed race is this live process, told apart by its stamp, so none of them can be judged gone.
function payloadOf(secondsPastTheHour: number): { processId: number; acquiredAt: string } {
  return { acquiredAt: `2026-09-24T15:00:${String(secondsPastTheHour).padStart(2, '0')}+02:00`, processId: process.pid };
}

function deadHolderRecord(deadProcessId: number): string {
  return JSON.stringify({ acquiredAt: new Date().toISOString(), processId: deadProcessId, state: 'held' });
}

function overrunHolderRecord(processId: number): string {
  return JSON.stringify({ acquiredAt: OVERRUN_HOLDER_ACQUIRED_AT, processId, state: 'held' });
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

test('once the action has finished the newest record is a release, and it is the only record left', async () => {
  const workspace = scratchWorkspace('lock-released');
  await withLock(workspace, () => 'done', realClock);
  await withLock(workspace, () => 'done again', realClock);
  expect(newestRecordIn(workspace.lockDirectoryPath)).toMatchObject({ processId: process.pid, state: 'released' });
  expect(readdirSync(workspace.lockDirectoryPath), 'generations do not pile up, and no pending file is left').toEqual(['generation-4']);
});

test('an action that throws still gives the lock back', async () => {
  const workspace = scratchWorkspace('lock-released-on-throw');
  await expect(withLock(workspace, () => {
    throw new Error('the action failed');
  }, realClock)).rejects.toThrow('the action failed');
  expect(newestRecordIn(workspace.lockDirectoryPath)).toMatchObject({ state: 'released' });
  expect(await withLock(workspace, () => 'the next command still works', realClock)).toBe('the next command still works');
});

test('the held record names the process holding it and when it took it', async () => {
  const workspace = scratchWorkspace('lock-payload');
  const recordWhileHeld = await withLock(workspace, () => newestRecordIn(workspace.lockDirectoryPath) as { processId: number; acquiredAt: string; state: string }, realClock);
  expect(recordWhileHeld.processId).toBe(process.pid);
  expect(recordWhileHeld.state).toBe('held');
  expect(recordWhileHeld.acquiredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  expect(Number.isNaN(Date.parse(recordWhileHeld.acquiredAt))).toBe(false);
});

test('a lock left behind by a process that no longer exists is taken over at once', async () => {
  // The timestamp is deliberately fresh: the writer being gone is enough on its own.
  const workspace = scratchWorkspace('lock-dead-holder');
  writeGeneration(workspace.lockDirectoryPath, 1, deadHolderRecord(await processIdOfAnExitedProcess()));

  const startedAt = Date.now();
  expect(await withLock(workspace, () => 'taken over', realClock)).toBe('taken over');
  expect(Date.now() - startedAt, 'the takeover did not wait out the retry budget').toBeLessThan(LOCK_RETRY_COUNT * LOCK_RETRY_INTERVAL_MILLISECONDS);
  expect(newestRecordIn(workspace.lockDirectoryPath)).toMatchObject({ processId: process.pid, state: 'released' });
});

test('a lock older than the stale threshold is taken over even when its writer is alive', async () => {
  const workspace = scratchWorkspace('lock-old-holder');
  writeGeneration(workspace.lockDirectoryPath, 1, overrunHolderRecord(process.pid));
  const longAfterwards = (): Date => new Date(LONG_AFTER_THE_OVERRUN_MILLISECONDS);
  expect(await withLock(workspace, () => 'taken over', longAfterwards)).toBe('taken over');
});

test('an unparseable record is taken over only once it is older than the threshold', async () => {
  const workspace = scratchWorkspace('lock-unparseable-old');
  writeGeneration(workspace.lockDirectoryPath, 1, 'this is not JSON');
  const anHourAgoInSeconds = Date.now() / 1000 - 3600;
  utimesSync(generationPathFor(workspace.lockDirectoryPath, 1), anHourAgoInSeconds, anHourAgoInSeconds);
  expect(await withLock(workspace, () => 'taken over', realClock)).toBe('taken over');
});

test('a freshly written unparseable record is waited for and then refused, rather than assumed free', async () => {
  const workspace = scratchWorkspace('lock-unparseable-fresh');
  writeGeneration(workspace.lockDirectoryPath, 1, '');

  let caught: unknown = null;
  try {
    await withLock(workspace, () => 'must not run', realClock);
  } catch (error) {
    caught = error;
  }

  expect(refusalIsOperationRefusal(caught)).toBe(true);
  expect(refusalIsOperationRefusal(caught) ? caught.status : null).toBe('unrepaired');
  expect(refusalIsOperationRefusal(caught) ? caught.message : '').toContain(workspace.lockDirectoryPath);
  expect(readFileSync(generationPathFor(workspace.lockDirectoryPath, 1), 'utf8'), 'the record it refused to take is left exactly as it was').toBe('');
}, REFUSAL_TEST_TIMEOUT_MILLISECONDS);

// An older version wrote the lock as a plain file at this path; one still held must never be treated as free.
test('a lock path that is a plain file refuses the same way, and the message does not call it a file', async () => {
  const workspace = scratchWorkspace('lock-plain-file');
  writeFileSync(workspace.lockDirectoryPath, '');

  let caught: unknown = null;
  try {
    await withLock(workspace, () => 'must not run', realClock);
  } catch (error) {
    caught = error;
  }

  expect(refusalIsOperationRefusal(caught)).toBe(true);
  const message = refusalIsOperationRefusal(caught) ? caught.message : '';
  expect(message).toContain(workspace.lockDirectoryPath);
  expect(message).toContain('remove that path');
  expect(message, 'the path is not necessarily a file').not.toContain('that file');
  expect(readFileSync(workspace.lockDirectoryPath, 'utf8')).toBe('');
}, REFUSAL_TEST_TIMEOUT_MILLISECONDS);

test('a record whose payload carries an impossible process id is never signalled with it', async () => {
  // `process.kill(0, …)` would signal the caller's whole process group, so a non-positive id never reaches it.
  const workspace = scratchWorkspace('lock-impossible-process-id');
  writeGeneration(workspace.lockDirectoryPath, 1, overrunHolderRecord(0));
  const longAfterwards = (): Date => new Date(LONG_AFTER_THE_OVERRUN_MILLISECONDS);
  expect(await withLock(workspace, () => 'taken over', longAfterwards)).toBe('taken over');
});

// The window #076 names: a taker judges an overrunning live holder stale, the holder releases, and a plain acquirer takes the lock
// before the taker acts. Under the old rename-aside takeover a fourth acquirer could then take the path the rename emptied.
test('a holder that releases after a taker judged it stale, followed by a plain acquirer, still leaves exactly one holder', () => {
  const { lockDirectoryPath } = scratchWorkspace('lock-release-during-takeover');
  writeGeneration(lockDirectoryPath, 1, overrunHolderRecord(process.pid));
  const plainAcquirer = payloadOf(1);
  let plainAcquirerVerdict = '';

  const takerAttempt = attemptedAcquire(lockDirectoryPath, payloadOf(2), RACE_MOMENT_MILLISECONDS, (step) => {
    if (step !== 'newest-judged-free') return;
    released(lockDirectoryPath, 1, payloadOf(3));
    plainAcquirerVerdict = attemptedAcquire(lockDirectoryPath, plainAcquirer, RACE_MOMENT_MILLISECONDS).verdict;
  });
  const fourthAcquirerVerdict = attemptedAcquire(lockDirectoryPath, payloadOf(4), RACE_MOMENT_MILLISECONDS).verdict;

  expect(plainAcquirerVerdict).toBe('acquired');
  expect(takerAttempt.verdict, 'the taker finds the generation it judged already moved past').toBe('contended');
  expect(fourthAcquirerVerdict, 'the plain acquirer\'s fresh lock is waited for').toBe('held');
  expect(newestRecordIn(lockDirectoryPath)).toEqual({ ...plainAcquirer, state: 'held' });
});

// Every step boundary of one acquire, with a second acquirer running whole inside it: the claim is one holder whatever the interleaving.
test('while a waiter takes over a dead holder\'s lock, another acquiring at any step leaves exactly one holder', async () => {
  expect(acquireSteps.length).toBeGreaterThan(0);
  const stepsReached = new Set<string>();
  for (const intrusionStep of acquireSteps) {
    const { lockDirectoryPath } = scratchWorkspace('lock-dead-holder-intrusion');
    writeGeneration(lockDirectoryPath, 1, deadHolderRecord(await processIdOfAnExitedProcess()));
    let intruderVerdict = '';
    const takerAttempt = attemptedAcquire(lockDirectoryPath, payloadOf(1), RACE_MOMENT_MILLISECONDS, (step) => {
      stepsReached.add(step);
      if (step === intrusionStep) intruderVerdict = attemptedAcquire(lockDirectoryPath, payloadOf(2), RACE_MOMENT_MILLISECONDS).verdict;
    });

    expect([intruderVerdict, takerAttempt.verdict].filter((verdict) => verdict === 'acquired').length, `holders with the intruder acquiring at ${intrusionStep}`).toBe(1);
  }
  expect([...stepsReached].sort(), 'every step boundary ran its intrusion').toEqual([...acquireSteps].sort());
});

// A slow acquirer can judge a generation that the holders after it have since removed, recreate it, and must then see the newer one.
test('an acquirer that recreates a generation removed while it was judging finds the newer one and does not hold', () => {
  const { lockDirectoryPath } = scratchWorkspace('lock-recreated-generation');
  const firstHolder = payloadOf(1);
  const secondHolder = payloadOf(2);
  let secondHolderGeneration = 0;

  const slowAttempt = attemptedAcquire(lockDirectoryPath, payloadOf(3), RACE_MOMENT_MILLISECONDS, (step) => {
    if (step !== 'newest-judged-free') return;
    const firstAttempt = attemptedAcquire(lockDirectoryPath, firstHolder, RACE_MOMENT_MILLISECONDS);
    if (firstAttempt.verdict === 'acquired') released(lockDirectoryPath, firstAttempt.generation, firstHolder);
    const secondAttempt = attemptedAcquire(lockDirectoryPath, secondHolder, RACE_MOMENT_MILLISECONDS);
    if (secondAttempt.verdict === 'acquired') secondHolderGeneration = secondAttempt.generation;
  });

  expect(secondHolderGeneration, 'the generation the slow acquirer judged was removed under it').toBe(3);
  expect(slowAttempt.verdict).toBe('contended');
  expect(newestRecordIn(lockDirectoryPath)).toEqual({ ...secondHolder, state: 'held' });
});

test('a holder taken over as stale releases nothing, and its successor keeps the lock', () => {
  const { lockDirectoryPath } = scratchWorkspace('lock-release-after-takeover');
  writeGeneration(lockDirectoryPath, 1, overrunHolderRecord(process.pid));
  const successor = payloadOf(1);

  expect(attemptedAcquire(lockDirectoryPath, successor, RACE_MOMENT_MILLISECONDS).verdict).toBe('acquired');
  released(lockDirectoryPath, 1, payloadOf(2));

  expect(newestRecordIn(lockDirectoryPath)).toEqual({ ...successor, state: 'held' });
  expect(attemptedAcquire(lockDirectoryPath, payloadOf(3), RACE_MOMENT_MILLISECONDS).verdict).toBe('held');
});

// A generation past the largest safe integer is invisible to every listing, so claiming one would let a second acquirer start again at 1.
test('a free record at the largest safe generation is never moved past, so at most one acquirer holds', async () => {
  const { lockDirectoryPath } = scratchWorkspace('lock-largest-generation');
  writeGeneration(lockDirectoryPath, Number.MAX_SAFE_INTEGER, deadHolderRecord(await processIdOfAnExitedProcess()));

  const verdicts = [payloadOf(1), payloadOf(2)].map((payload) => attemptedAcquire(lockDirectoryPath, payload, RACE_MOMENT_MILLISECONDS).verdict);

  expect(verdicts.filter((verdict) => verdict === 'acquired').length, 'holders after two acquirers').toBeLessThanOrEqual(1);
  expect(verdicts).toEqual(['held', 'held']);
  expect(generationsIn(lockDirectoryPath)).toEqual([Number.MAX_SAFE_INTEGER]);
});

test('a holder at the largest safe generation releases nothing it could not list, and its record stays the newest', () => {
  const { lockDirectoryPath } = scratchWorkspace('lock-largest-generation-release');
  const holder = payloadOf(1);
  writeGeneration(lockDirectoryPath, Number.MAX_SAFE_INTEGER, JSON.stringify({ ...holder, state: 'held' }));

  released(lockDirectoryPath, Number.MAX_SAFE_INTEGER, payloadOf(2));

  expect(readdirSync(lockDirectoryPath)).toEqual([`generation-${Number.MAX_SAFE_INTEGER}`]);
  expect(attemptedAcquire(lockDirectoryPath, payloadOf(3), RACE_MOMENT_MILLISECONDS).verdict).toBe('held');
});

test('a released lock is taken by the next acquirer, whose record is complete the moment it exists', () => {
  const { lockDirectoryPath } = scratchWorkspace('lock-complete-record');
  const holder = payloadOf(1);
  let recordAtCreation: unknown = null;
  attemptedAcquire(lockDirectoryPath, holder, RACE_MOMENT_MILLISECONDS, (step) => {
    if (step === 'generation-created') recordAtCreation = newestRecordIn(lockDirectoryPath);
  });
  expect(recordAtCreation).toEqual({ ...holder, state: 'held' });
  expect(existsSync(lockDirectoryPath)).toBe(true);
});

test('the action\'s return value is handed back, including when it is not a promise', async () => {
  const workspace = scratchWorkspace('lock-return-value');
  expect(await withLock(workspace, () => ({ id: 18, name: 'Review pass' }), realClock)).toEqual({ id: 18, name: 'Review pass' });
});

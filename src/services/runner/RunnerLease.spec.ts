/**
 * The lease's generations in one process: what matters is that a live newest generation refuses, a dead one is followed by the next, the
 * holder removes only the generations below its own, a newer generation makes the holder's effect-batch check refuse `lease-taken-over`
 * as unrepaired, and a release never unlinks a generation the releaser does not hold. Two starters racing are `cli/runner/RunCommand.spec.ts`'s.
 */
import { writeFileSync } from 'node:fs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { identityOf }                                     from '../../lib/process-identity/ProcessIdentity.ts';
import { OperationRefusal }                               from '../../shared/OperationRefusal.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { RunnerLease, type RunnerLeaseRecord }            from './RunnerLease.ts';

let runnerDirectory = '';

function recordOf(startEpochSeconds: number): RunnerLeaseRecord {
  const ownIdentity = identityOf(process.pid);
  if (ownIdentity === null) throw new Error('this process has no readable identity');
  return {
    processId:                process.pid,
    processStartEpochSeconds: startEpochSeconds,
    bootIdentity:             ownIdentity.bootIdentity,
    port:                     4930,
    url:                      'http://127.0.0.1:4930/',
    tokenFile:                `${runnerDirectory}/token`,
    codeVersion:              'code-example',
    installVersion:           17,
    hostProtocolVersion:      1,
  };
}

function liveRecord(): RunnerLeaseRecord {
  return recordOf(identityOf(process.pid)?.startEpochSeconds ?? 0);
}

/** This process's pid under a start it never had: dead, whatever pids the machine has free. */
function deadRecord(): RunnerLeaseRecord {
  return recordOf(1);
}

function plant(generation: number, record: RunnerLeaseRecord): void {
  writeFileSync(RunnerLease.leaseFilePathFor(runnerDirectory, generation), JSON.stringify(record));
}

beforeEach(() => {
  runnerDirectory = createScratchDirectory('runner-lease');
});

afterEach(() => {
  removeScratchDirectory(runnerDirectory);
});

describe('RunnerLease.acquire', () => {
  test('an empty folder gives generation 1, and a live newest generation then refuses already-running with its record', () => {
    expect(RunnerLease.acquire(runnerDirectory, liveRecord())).toEqual({ verdict: 'acquired', generation: 1 });
    expect(RunnerLease.acquire(runnerDirectory, liveRecord())).toEqual({ verdict: 'already-running', generation: 1, record: liveRecord() });
    expect(RunnerLease.newestLeaseOf(runnerDirectory)).toEqual({ verdict: 'live', generation: 1, record: liveRecord() });
  });

  test('a dead newest generation, or an unreadable one, is followed by the next, which removes every older one', () => {
    plant(2, deadRecord());
    writeFileSync(RunnerLease.leaseFilePathFor(runnerDirectory, 5), '{ not a lease');
    expect(RunnerLease.newestLeaseOf(runnerDirectory)).toEqual({ verdict: 'dead', generation: 5, record: null });
    expect(RunnerLease.acquire(runnerDirectory, liveRecord())).toEqual({ verdict: 'acquired', generation: 6 });
    expect(RunnerLease.leaseGenerationsIn(runnerDirectory)).toEqual([6]);
  });
});

describe('the holder', () => {
  test('passes its effect-batch check while newest, and is refused lease-taken-over, unrepaired, once a newer generation exists', () => {
    RunnerLease.acquire(runnerDirectory, liveRecord());
    expect(() => RunnerLease.requireNewestGeneration(runnerDirectory, 1)).not.toThrow();
    plant(2, deadRecord());
    let refusal: unknown = null;
    try {
      RunnerLease.requireNewestGeneration(runnerDirectory, 1);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(OperationRefusal);
    expect((refusal as OperationRefusal).status).toBe('unrepaired');
    expect((refusal as OperationRefusal).detail).toEqual({ kind: 'lease-taken-over', leaseFilePath: RunnerLease.leaseFilePathFor(runnerDirectory, 1) });
  });

  test('releases its own generation, and once overtaken unlinks nothing at all', () => {
    RunnerLease.acquire(runnerDirectory, liveRecord());
    RunnerLease.release(runnerDirectory, 1);
    expect(RunnerLease.newestLeaseOf(runnerDirectory)).toEqual({ verdict: 'none' });

    expect(RunnerLease.acquire(runnerDirectory, liveRecord())).toEqual({ verdict: 'acquired', generation: 1 });
    plant(2, deadRecord());
    RunnerLease.release(runnerDirectory, 1);
    expect(RunnerLease.leaseGenerationsIn(runnerDirectory)).toEqual([1, 2]);
  });
});

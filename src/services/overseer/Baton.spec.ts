/**
 * The Baton's generations in one process: what matters is that a live newest generation refuses, a dead one is followed by the next, the
 * holder removes only the generations below its own, a newer generation makes the holder's effect-batch check refuse `baton-taken`
 * as unrepaired, and a release never unlinks a generation the releaser does not hold. Two starters racing are `cli/overseer/OverseerCommand.spec.ts`'s.
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
import { Baton, type BatonRecord }                        from './Baton.ts';

let overseerDirectory = '';

function recordOf(startEpochSeconds: number): BatonRecord {
  const ownIdentity = identityOf(process.pid);
  if (ownIdentity === null) throw new Error('this process has no readable identity');
  return {
    processId:                process.pid,
    processStartEpochSeconds: startEpochSeconds,
    bootIdentity:             ownIdentity.bootIdentity,
    port:                     4930,
    url:                      'http://127.0.0.1:4930/',
    tokenFile:                `${overseerDirectory}/token`,
    codeVersion:              'code-example',
    installVersion:           17,
    watcherProtocolVersion:   1,
  };
}

function liveRecord(): BatonRecord {
  return recordOf(identityOf(process.pid)?.startEpochSeconds ?? 0);
}

/** This process's pid under a start it never had: dead, whatever pids the machine has free. */
function deadRecord(): BatonRecord {
  return recordOf(1);
}

function plant(generation: number, record: BatonRecord): void {
  writeFileSync(Baton.batonFilePathFor(overseerDirectory, generation), JSON.stringify(record));
}

beforeEach(() => {
  overseerDirectory = createScratchDirectory('overseer-baton');
});

afterEach(() => {
  removeScratchDirectory(overseerDirectory);
});

describe('Baton.acquire', () => {
  test('an empty folder gives generation 1, and a live newest generation then refuses already-running with its record', () => {
    expect(Baton.acquire(overseerDirectory, liveRecord())).toEqual({ verdict: 'acquired', generation: 1 });
    expect(Baton.acquire(overseerDirectory, liveRecord())).toEqual({ verdict: 'already-running', generation: 1, record: liveRecord() });
    expect(Baton.newestBatonOf(overseerDirectory)).toEqual({ verdict: 'live', generation: 1, record: liveRecord() });
  });

  test('a dead newest generation, or an unreadable one, is followed by the next, which removes every older one', () => {
    plant(2, deadRecord());
    writeFileSync(Baton.batonFilePathFor(overseerDirectory, 5), '{ not a baton');
    expect(Baton.newestBatonOf(overseerDirectory)).toEqual({ verdict: 'dead', generation: 5, record: null });
    expect(Baton.acquire(overseerDirectory, liveRecord())).toEqual({ verdict: 'acquired', generation: 6 });
    expect(Baton.batonGenerationsIn(overseerDirectory)).toEqual([6]);
  });
});

describe('the holder', () => {
  test('passes its effect-batch check while newest, and is refused baton-taken, unrepaired, once a newer generation exists', () => {
    Baton.acquire(overseerDirectory, liveRecord());
    expect(() => Baton.requireNewestGeneration(overseerDirectory, 1)).not.toThrow();
    plant(2, deadRecord());
    let refusal: unknown = null;
    try {
      Baton.requireNewestGeneration(overseerDirectory, 1);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(OperationRefusal);
    expect((refusal as OperationRefusal).status).toBe('unrepaired');
    expect((refusal as OperationRefusal).detail).toEqual({ kind: 'baton-taken', batonFilePath: Baton.batonFilePathFor(overseerDirectory, 1) });
  });

  test('releases its own generation, and once overtaken unlinks nothing at all', () => {
    Baton.acquire(overseerDirectory, liveRecord());
    Baton.release(overseerDirectory, 1);
    expect(Baton.newestBatonOf(overseerDirectory)).toEqual({ verdict: 'none' });

    expect(Baton.acquire(overseerDirectory, liveRecord())).toEqual({ verdict: 'acquired', generation: 1 });
    plant(2, deadRecord());
    Baton.release(overseerDirectory, 1);
    expect(Baton.batonGenerationsIn(overseerDirectory)).toEqual([1, 2]);
  });
});

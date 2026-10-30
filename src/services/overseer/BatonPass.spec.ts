/**
 * The checked Baton pass decides whether a board keeps an Overseer through an update, so each way a successor can fail is planted here, and
 * what matters is which side drives afterwards: a failure before `released` leaves the old Overseer driving and never releases it, one after
 * it hands the board back for generation n+2, a silent successor is killed (only while it is still that process), and every failure is
 * recorded before the final `failed` is left in the file, which is what `run restart` and `update` read. The crash rows "the old Overseer
 * dies during a baton-pass" and "a Baton pass's successor fails" are held here; the whole Baton pass between two real Overseers is held by
 * `cli/overseer/OverseerCommand.spec.ts`, and the agent that keeps running across it by `src/services/overseer/CrashMatrix.spec.ts`.
 */
import { mkdirSync } from 'node:fs';
import { join }      from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { identityOf, sameProcess, type ProcessIdentity }  from '../../lib/process-identity/ProcessIdentity.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { Baton, type BatonRecord }                        from './Baton.ts';
import {
  type BatonPassFailure,
  type BatonPassStep,
  type BatonPassStepRun,
  BatonPass
} from './BatonPass.ts';

const SCHEDULE = { readyTries: 40, releaseTries: 40, intervalMilliseconds: 10 };
const PREPARATION_STEPS: readonly BatonPassStep[] = ['build-bundles', 'read-board', 'read-jobs', 'read-watcher-files', 'install-version'];
const AFTER_RELEASE_STEPS: readonly BatonPassStep[] = ['bind-port', 'take-baton', 'regroup'];
const SUCCESSOR_CODE = 'code-successor';

let overseerDirectory = '';
let batonPassFilePath = '';

beforeEach(() => {
  overseerDirectory = createScratchDirectory('baton-pass');
  mkdirSync(overseerDirectory, { recursive: true });
  batonPassFilePath = BatonPass.batonPassFilePathOf(overseerDirectory, 1);
  BatonPass.writeBatonPass(batonPassFilePath, { state: 'requested' });
});

afterEach(() => {
  removeScratchDirectory(overseerDirectory);
});

function ownIdentity(): ProcessIdentity {
  const identity = identityOf(process.pid);
  if (identity === null) throw new Error('the spec process has no readable identity');
  return identity;
}

function stepsFailingAt(failing: BatonPassStep | null, ran: BatonPassStep[]): BatonPassStepRun[] {
  return PREPARATION_STEPS.map((step) => ({
    step,
    run: () => {
      ran.push(step);
      if (step === failing) throw new Error(`Example failure at ${step}`);
    },
  }));
}

/** The old Overseer's side against an in-process successor; what it released and recorded, and its outcome. */
async function handOverAgainst(successor: () => Promise<void>, successorIdentity: ProcessIdentity | null = ownIdentity()) {
  const recorded: BatonPassFailure[] = [];
  let released = 0;
  const [outcome] = await Promise.all([
    BatonPass.handOver({
      batonPassFilePath,
      successor:            successorIdentity,
      successorCodeVersion: SUCCESSOR_CODE,
      release:              () => {
        released += 1;
        return Promise.resolve();
      },
      recordFailure: (failure) => {
        // The file still holds the successor's own report while the failure is recorded.
        expect(BatonPass.readBatonPass(batonPassFilePath)?.state).not.toBe('failed');
        recorded.push(failure);
        return Promise.resolve();
      },
      schedule: SCHEDULE,
    }),
    successor(),
  ]);
  return { outcome, recorded, released };
}

function successorRequest(predecessorIsLive: () => boolean = () => true) {
  return {
    batonPassFilePath, codeVersion: SUCCESSOR_CODE, predecessorIsLive, schedule: SCHEDULE
  };
}

describe('a successor failing before released', () => {
  test.each(PREPARATION_STEPS.map((step) => [step]))('at %s: no later step runs, the old Overseer never releases, keeps driving and records it', async (failing) => {
    const ran: BatonPassStep[] = [];
    let admission = '';
    const { outcome, recorded, released } = await handOverAgainst(async () => {
      admission = await BatonPass.prepareAndAwaitRelease(successorRequest(), stepsFailingAt(failing, ran));
    });
    expect(admission).toBe('failed');
    expect(ran.at(-1)).toBe(failing);
    expect(released).toBe(0);
    const failure = { successorCodeVersion: SUCCESSOR_CODE, step: failing, error: `Example failure at ${failing}` };
    expect(outcome).toEqual({ verdict: 'kept-driving', failure });
    expect(recorded).toEqual([failure]);
    expect(BatonPass.readBatonPass(batonPassFilePath)).toEqual({ state: 'failed', ...failure, afterRelease: false });
  });

  test('a successor that reports nothing within the ready tries is killed and counted as failed before released', async () => {
    const silent = Bun.spawn(['sleep', '30'], {
      detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore'
    });
    const silentIdentity = identityOf(silent.pid);
    const { outcome, released } = await handOverAgainst(() => Promise.resolve(), silentIdentity);
    expect(outcome).toMatchObject({ verdict: 'kept-driving', failure: { step: 'report-ready', successorCodeVersion: SUCCESSOR_CODE } });
    expect(released).toBe(0);
    await silent.exited;
    const after = identityOf(silent.pid);
    expect(after !== null && silentIdentity !== null && sameProcess(after, silentIdentity)).toBe(false);
  });

  test('a successor that exits without a report fails at once, and one never started fails at spawn', async () => {
    const exited = Bun.spawn(['true']);
    const exitedIdentity = identityOf(exited.pid) ?? { ...ownIdentity(), processId: exited.pid, startEpochSeconds: 0 };
    await exited.exited;
    expect((await handOverAgainst(() => Promise.resolve(), exitedIdentity)).outcome).toMatchObject({ verdict: 'kept-driving', failure: { step: 'report-ready' } });
    BatonPass.writeBatonPass(batonPassFilePath, { state: 'requested' });
    expect((await handOverAgainst(() => Promise.resolve(), null)).outcome).toMatchObject({ verdict: 'kept-driving', failure: { step: 'spawn' } });
  });
});

describe('a successor failing after released', () => {
  test.each(AFTER_RELEASE_STEPS.map((step) => [step]))('at %s: the old Overseer released once and takes the board back, recording it', async (failing) => {
    const { outcome, recorded, released } = await handOverAgainst(async () => {
      expect(await BatonPass.prepareAndAwaitRelease(successorRequest(), stepsFailingAt(null, []))).toBe('released');
      BatonPass.reportFailure({ batonPassFilePath, codeVersion: SUCCESSOR_CODE }, failing, new Error('Example failure'), true);
    });
    expect(released).toBe(1);
    expect(outcome).toEqual({ verdict: 'taken-back', failure: { successorCodeVersion: SUCCESSOR_CODE, step: failing, error: 'Example failure' } });
    expect(recorded.length).toBe(1);
    expect(BatonPass.readBatonPass(batonPassFilePath)).toMatchObject({ state: 'failed', step: failing, afterRelease: true });
  });

  test('a successor that serves hands the board over, recording nothing', async () => {
    const { outcome, recorded, released } = await handOverAgainst(async () => {
      await BatonPass.prepareAndAwaitRelease(successorRequest(), stepsFailingAt(null, []));
      BatonPass.reportServing({ batonPassFilePath, codeVersion: SUCCESSOR_CODE }, 2, 'http://127.0.0.1:4930/');
    });
    expect(outcome).toEqual({
      verdict: 'handed-over', successorCodeVersion: SUCCESSOR_CODE, generation: 2, url: 'http://127.0.0.1:4930/'
    });
    expect([recorded, released]).toEqual([[], 1]);
  });
});

describe('the old Overseer rebinding its port after taking a Baton pass back', () => {
  const PORT_HOLDER_SOURCE = 'const server = Bun.serve({ hostname: \'127.0.0.1\', port: 0, reusePort: false, fetch: () => new Response(\'\') }); '
    + 'console.log(server.port); setInterval(() => undefined, 1000);';

  /** Spawned in the spec's own process group, so the Baton pass's group kill is refused and it outlives that first signal. */
  async function portHoldingSuccessor() {
    const holder = Bun.spawn([process.execPath, '-e', PORT_HOLDER_SOURCE], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const reader = holder.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    const identity = identityOf(holder.pid);
    if (identity === null) throw new Error('the port holder has no readable identity');
    return { holder, identity, port: Number(new TextDecoder().decode(value).trim()) };
  }

  function servingOn(port: number) {
    return Bun.serve({
      hostname: '127.0.0.1', port, reusePort: false, fetch: () => new Response('')
    });
  }

  test('a silent successor still holding the port after its kill is waited for, and the old Overseer then serves again on that port', async () => {
    const { holder, identity, port } = await portHoldingSuccessor();
    try {
      const { outcome } = await handOverAgainst(async () => {
        await BatonPass.prepareAndAwaitRelease(successorRequest(), stepsFailingAt(null, []));
      }, identity);
      expect(outcome).toMatchObject({ verdict: 'taken-back', failure: { step: 'serve' } });
      setTimeout(() => holder.kill('SIGKILL'), SCHEDULE.intervalMilliseconds * 5);
      let binds = 0;
      const rebound = await BatonPass.rebindAfterTakeBack({
        successor:            identity,
        tries:                SCHEDULE.releaseTries,
        intervalMilliseconds: SCHEDULE.intervalMilliseconds,
        bind:                 () => {
          binds += 1;
          return Promise.resolve(servingOn(port));
        },
      });
      expect(rebound.verdict).toBe('bound');
      if (rebound.verdict === 'bound') {
        expect(rebound.bound.port).toBe(port);
        await rebound.bound.stop(true);
      }
      expect(binds).toBe(1);
    } finally {
      holder.kill('SIGKILL');
    }
  });

  test('a successor outliving the tries is never bound over; a port still held fails each try; a refused bind is tried again until it holds', async () => {
    const { holder, identity, port } = await portHoldingSuccessor();
    let binds = 0;
    const bind = () => {
      binds += 1;
      return Promise.resolve(servingOn(port));
    };
    const rebindOver = (successor: ProcessIdentity | null, bindOnce: typeof bind) => BatonPass.rebindAfterTakeBack({
      successor, tries: 3, intervalMilliseconds: SCHEDULE.intervalMilliseconds, bind: bindOnce
    });
    try {
      expect(await rebindOver(identity, bind)).toEqual({ verdict: 'successor-live' });
      expect(binds).toBe(0);
      expect(await rebindOver(null, bind)).toMatchObject({ verdict: 'bind-failed' });
      expect(binds).toBe(3);
    } finally {
      holder.kill('SIGKILL');
      await holder.exited;
    }
    binds = 0;
    const refusedOnce = () => (binds === 0 ? (binds += 1, Promise.reject(new Error('Example bind refusal'))) : bind());
    const rebound = await rebindOver(null, refusedOnce);
    expect(rebound.verdict).toBe('bound');
    if (rebound.verdict === 'bound') await rebound.bound.stop(true);
    expect(binds).toBe(2);
  });
});

describe('the old Overseer dies during a baton-pass', () => {
  test('its successor, ready and waiting, reads it as gone and starts as after a crash', async () => {
    let predecessorLive = true;
    const waiting = BatonPass.prepareAndAwaitRelease(successorRequest(() => predecessorLive), stepsFailingAt(null, []));
    await Bun.sleep(SCHEDULE.intervalMilliseconds * 3);
    predecessorLive = false;
    expect(await waiting).toBe('predecessor-gone');
  });
});

describe('the Baton generations a Baton pass takes', () => {
  function recordNaming(identity: ProcessIdentity): BatonRecord {
    return {
      processId:                identity.processId,
      processStartEpochSeconds: identity.startEpochSeconds,
      bootIdentity:             identity.bootIdentity,
      port:                     1,
      url:                      'http://127.0.0.1:1/',
      tokenFile:                join(overseerDirectory, 'token'),
      codeVersion:              'code-example',
      installVersion:           1,
      watcherProtocolVersion:   1,
    };
  }

  test('the successor takes n+1 beside the live n; the old Overseer, its successor gone, takes n+2; anything newer is contended', () => {
    const record = recordNaming(ownIdentity());
    expect(Baton.acquire(overseerDirectory, record)).toEqual({ verdict: 'acquired', generation: 1 });
    expect(Baton.acquire(overseerDirectory, record).verdict).toBe('already-running');
    expect(Baton.acquireAbove(overseerDirectory, record, 1)).toEqual({ verdict: 'acquired', generation: 2 });
    Baton.release(overseerDirectory, 2);
    expect(Baton.acquireAbove(overseerDirectory, record, 1 + 1)).toEqual({ verdict: 'acquired', generation: 3 });
    expect(Baton.batonGenerationsIn(overseerDirectory)).toEqual([3]);
    expect(Baton.acquireAbove(overseerDirectory, record, 1)).toEqual({ verdict: 'contended' });
  });
});

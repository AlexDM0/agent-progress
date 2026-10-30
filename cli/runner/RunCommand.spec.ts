/**
 * The runner's start, lease and stop, end to end through real child processes, since a runner holds its process until it is stopped.
 * What matters: two starters at once leave exactly one runner serving; a lease naming a dead process is taken over as after a crash; a
 * runner whose generation was overtaken stops at exit 2 touching nothing; `run --detach`, `run status`, `run restart` and `run stop`
 * agree with the lease; `run pause|resume` write the drain flag with no runner up, which the Bridge header's board state and `run status`
 * read alike; and a spec-spawned runner resolves the fake agent,
 * never the vendor's adapter. Every runner binds `--port 0`.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { hostFilesOf }                                    from '../../src/lib/agent-host/HostFiles.ts';
import { CodeVersion }                                    from '../../src/services/runner/CodeVersion.ts';
import { requireWorkspace }                               from '../../src/services/tracker/Workspace.ts';
import { fakeAgentVariableOf }                            from '../../src/shared/Environment.ts';
import { PRODUCT_NAMES }                                  from '../../src/shared/constants/ProductNames.ts';
import { FAKE_AGENT_VENDOR }                              from '../../src/testing/FakeAgentAdapter.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { runCommandLine }                                 from '../Main.ts';
import { INSTALL_VERSION }                                from '../constants/InstallVersion.ts';
import { createCapturedCommandContext }                   from '../testing/CapturedCommandContext.ts';
import { runAgentProgress, startAgentProgress }           from '../testing/CliProcess.ts';
import { createInitializedScratchRepository }             from '../testing/InitializedScratchRepository.ts';
import { readBoardState }                                 from './routes/BoardStateReader.ts';

const SPEC_CLOCK = (): Date => new Date('2026-09-18T20:11:03Z');

const OWNER_ONLY_FILE_MODE = 0o600;
const PERMISSION_BITS      = 0o777;
const RUNNER_TEST_TIMEOUT_MILLISECONDS = 30_000;
const HOST_WAIT_TRIES = 100;
const HOST_WAIT_MILLISECONDS = 50;

let repositoryDirectory = '';
let homeDirectory       = '';

function runnerDirectory(): string {
  return join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'runner');
}

function leaseFileNames(): string[] {
  return existsSync(runnerDirectory()) ? readdirSync(runnerDirectory()).filter((fileName) => fileName.startsWith('lease-')).sort() : [];
}

function leaseOf(fileName: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(runnerDirectory(), fileName), 'utf8')) as Record<string, unknown>;
}

function runnerLogText(): string {
  const logFilePath = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'runner.log');
  return existsSync(logFilePath) ? readFileSync(logFilePath, 'utf8') : '';
}

function storedLogKindsOf(repository: string): string[] {
  return readFileSync(join(repository, PRODUCT_NAMES.DATA_FOLDER, 'log.jsonl'), 'utf8').split('\n').filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

/** This process's pid with a start no process ever had: a lease that reads as dead without depending on a pid being free. */
function plantDeadLease(generation: number): void {
  mkdirSync(runnerDirectory(), { recursive: true });
  writeFileSync(join(runnerDirectory(), `lease-${generation}.json`), JSON.stringify({
    processId:                process.pid,
    processStartEpochSeconds: 1,
    bootIdentity:             'example-boot',
    port:                     1,
    url:                      'http://127.0.0.1:1/',
    tokenFile:                join(runnerDirectory(), 'token'),
    codeVersion:              'code-example',
    installVersion:           1,
    hostProtocolVersion:      1,
  }));
}

function startRunner() {
  return startAgentProgress(['run', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory });
}

async function stopRunner(): Promise<void> {
  const stopped = await runAgentProgress(['run', 'stop'], { currentDirectory: repositoryDirectory, homeDirectory });
  expect(stopped.exitCode, stopped.standardError).toBe(0);
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('runner', ['--project', 'Example Agency', '--no-hooks'], SPEC_CLOCK);
  homeDirectory       = createScratchDirectory('runner-home');
});

afterEach(async () => {
  await runAgentProgress(['run', 'stop'], { currentDirectory: repositoryDirectory, homeDirectory });
  removeScratchDirectory(repositoryDirectory);
  removeScratchDirectory(homeDirectory);
});

describe('run in the foreground', () => {
  test('two starters at once leave exactly one runner serving; the other refuses already-running or contended at exit 1', async () => {
    const starters = [startRunner(), startRunner()];
    const firstLines = await Promise.all(starters.map((starter) => Promise.race([starter.firstOutputLine, starter.finished.then(() => null)])));
    const servingIndex = firstLines.findIndex((line) => line !== null);
    expect(servingIndex).toBeGreaterThanOrEqual(0);
    const refused = await (starters[1 - servingIndex]?.finished ?? Promise.reject(new Error('no second starter')));
    expect(refused.exitCode, refused.standardError).toBe(1);
    expect(refused.standardError).toMatch(/A runner already serves this board at http:\/\/127\.0\.0\.1:\d+\/|Another runner started/);

    const url = firstLines[servingIndex] ?? '';
    expect(leaseFileNames()).toEqual(['lease-1.json']);
    const lease = leaseOf('lease-1.json');
    expect(lease).toMatchObject({ processId: starters[servingIndex]?.processId, url, codeVersion: CodeVersion.onDisk() });
    expect(Object.keys(lease)).toEqual([
      'processId', 'processStartEpochSeconds', 'bootIdentity', 'port', 'url', 'tokenFile', 'codeVersion', 'installVersion', 'hostProtocolVersion',
    ]);
    expect(statSync(join(runnerDirectory(), 'token')).mode & PERMISSION_BITS).toBe(OWNER_ONLY_FILE_MODE);
    const identity = await (await fetch(new URL('api/identity', url))).json() as Record<string, unknown>;
    expect(identity).toMatchObject({ application: PRODUCT_NAMES.PROGRAM, project: 'Example Agency', processId: lease['processId'] });

    await stopRunner();
    expect((await starters[servingIndex]?.finished)?.exitCode).toBe(0);
    expect(leaseFileNames()).toEqual([]);
  }, RUNNER_TEST_TIMEOUT_MILLISECONDS);

  test('a lease naming a dead process is replaced by the next generation, which removes the older one', async () => {
    plantDeadLease(3);
    const runner = startRunner();
    expect(await runner.firstOutputLine).toStartWith('http://127.0.0.1:');
    expect(leaseFileNames()).toEqual(['lease-4.json']);
    await stopRunner();
    expect((await runner.finished).exitCode).toBe(0);
  }, RUNNER_TEST_TIMEOUT_MILLISECONDS);

  test('a runner whose generation a newer lease overtook stops lease-taken-over at exit 2 and unlinks nothing', async () => {
    const runner = startRunner();
    expect(await runner.firstOutputLine).toStartWith('http://127.0.0.1:');
    plantDeadLease(2);
    const finished = await runner.finished;
    expect(finished.exitCode).toBe(2);
    expect(finished.standardError).toContain('A newer runner took this board over');
    expect(leaseFileNames()).toEqual(['lease-1.json', 'lease-2.json']);
  }, RUNNER_TEST_TIMEOUT_MILLISECONDS);
});

/** The vendor a runner announced in its log since `fromOffset`: the adapter its process resolved. */
function announcedVendorSince(fromOffset: number): string | null {
  const logText = readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'runner.log'), 'utf8').slice(fromOffset);
  return /, agents ([\w-]+)\)\./.exec(logText)?.[1] ?? null;
}

describe('the agent adapter of a spec-spawned runner', () => {
  test('is the fake agent by default, and stays the fake agent when a spec\'s environment plants the fake-agent switch off', async () => {
    const runner = startRunner();
    expect(await runner.firstOutputLine).toStartWith('http://127.0.0.1:');
    expect(announcedVendorSince(0)).toBe(FAKE_AGENT_VENDOR);
    await stopRunner();
    expect((await runner.finished).exitCode).toBe(0);

    const logLength = readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'runner.log'), 'utf8').length;
    const switchedOff = { [fakeAgentVariableOf(PRODUCT_NAMES)]: '0' };
    const planted     = startAgentProgress(['run', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory, environment: switchedOff });
    expect(await planted.firstOutputLine).toStartWith('http://127.0.0.1:');
    expect(announcedVendorSince(logLength)).toBe(FAKE_AGENT_VENDOR);
    await stopRunner();
    expect((await planted.finished).exitCode).toBe(0);
  }, RUNNER_TEST_TIMEOUT_MILLISECONDS);
});

describe('run --detach, status, restart and stop', () => {
  test('a detached runner prints its URL once it answers; status reports it serving; restart keeps its port under a new process', async () => {
    const detached = await runAgentProgress(['run', '--detach', '--port', '0', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(detached.exitCode, detached.standardError).toBe(0);
    const { url } = JSON.parse(detached.standardOutput) as { url: string };

    const status = await runAgentProgress(['run', 'status', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(status.standardOutput)).toMatchObject({
      state: 'serving', paused: true, url, codeVersionOnDisk: CodeVersion.onDisk(), codeVersionInMemory: CodeVersion.onDisk(),
    });

    const processBefore = leaseOf(leaseFileNames()[0] ?? '')['processId'];
    const restarted = await runAgentProgress(['run', 'restart', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(restarted.exitCode, `${restarted.standardError}\n${runnerLogText()}`).toBe(0);
    expect(JSON.parse(restarted.standardOutput)).toEqual({ outcome: 'done', url, codeVersion: CodeVersion.onDisk() });
    expect(leaseFileNames()).toEqual(['lease-2.json']);
    expect(leaseOf(leaseFileNames()[0] ?? '')['processId']).not.toBe(processBefore);
    expect(storedLogKindsOf(repositoryDirectory).filter((kind) => kind.startsWith('runner-'))).toEqual(['runner-started', 'runner-stopped', 'runner-started']);

    const stopped = await runAgentProgress(['run', 'stop', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(stopped.standardOutput)).toEqual({ outcome: 'done' });
    expect(leaseFileNames()).toEqual([]);
    const statusAfter = await runAgentProgress(['run', 'status', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(statusAfter.standardOutput)).toMatchObject({ state: 'down', url: null });
  }, RUNNER_TEST_TIMEOUT_MILLISECONDS);

  test('a second restart while a handover runs leaves the successor\'s ready report standing, and the first handover completes', async () => {
    const detached = await runAgentProgress(['run', '--detach', '--port', '0', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(detached.exitCode, detached.standardError).toBe(0);
    const { url } = JSON.parse(detached.standardOutput) as { url: string };
    const handoverFilePath = join(runnerDirectory(), 'handover-1.json');
    const handoverState = (): string | null => {
      try {
        return (JSON.parse(readFileSync(handoverFilePath, 'utf8')) as { state: string }).state;
      } catch {
        return null;
      }
    };

    const restarting = runAgentProgress(['run', 'restart', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    // The old runner looks for `ready` only every interval, so a second command sent the moment it appears arrives before that look.
    for (let attempt = 0; attempt < 20_000 && handoverState() !== 'ready'; attempt++) await Bun.sleep(1);
    expect(handoverState()).toBe('ready');
    const token = readFileSync(join(runnerDirectory(), 'token'), 'utf8').trim();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const body    = JSON.stringify({ kind: 'runner-restart', now: false });
    await fetch(new URL('api/commands', url), { method: 'POST', headers, body }).catch(() => null);
    expect(handoverState()).not.toBe('requested');

    const restarted = await restarting;
    expect(restarted.exitCode, `${restarted.standardError}\n${runnerLogText()}`).toBe(0);
    expect(leaseFileNames()).toEqual(['lease-2.json']);
    await stopRunner();
  }, RUNNER_TEST_TIMEOUT_MILLISECONDS);

  test('a successor that fails a step exits; restart exits 1 runner-handover-failed and the old runner keeps driving, logging it and warning', async () => {
    const detached = await runAgentProgress(['run', '--detach', '--port', '0', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(detached.exitCode, detached.standardError).toBe(0);
    const { url } = JSON.parse(detached.standardOutput) as { url: string };
    const leaseBefore = leaseOf('lease-1.json');
    // The successor reads every claimed host's event log before it reports ready: a malformed line in the orchestrator's fails that step.
    const { eventLogPath } = hostFilesOf(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'jobs', 'J1'), 1);
    for (let attempt = 0; attempt < HOST_WAIT_TRIES && !existsSync(eventLogPath); attempt++) await Bun.sleep(HOST_WAIT_MILLISECONDS);
    appendFileSync(eventLogPath, 'not an event\n');

    const restarted = await runAgentProgress(['run', 'restart', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(restarted.exitCode, `${restarted.standardError}\n${runnerLogText()}`).toBe(1);
    expect(`${restarted.standardOutput}${restarted.standardError}`).toContain('failed at read-host-files');
    expect(leaseFileNames()).toEqual(['lease-1.json']);
    expect(leaseOf('lease-1.json')).toEqual(leaseBefore);
    expect(storedLogKindsOf(repositoryDirectory)).toContain('runner-handover-failed');

    const status = await runAgentProgress(['run', 'status', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(status.standardOutput)).toMatchObject({ url, handoverWarning: { step: 'read-host-files' } });
    expect((await runAgentProgress(['run', 'status'], { currentDirectory: repositoryDirectory, homeDirectory })).standardOutput)
      .toContain('warning: the handover to code');
    await stopRunner();
  }, RUNNER_TEST_TIMEOUT_MILLISECONDS);

  test('update ends by handing a live runner on other code to the code on disk; a failed handover exits 1, its install writes standing', async () => {
    const withNoRunner = await runAgentProgress(['update'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(withNoRunner.exitCode, withNoRunner.standardError).toBe(0);
    expect(withNoRunner.standardOutput).not.toContain('Handing the runner');

    const detached = await runAgentProgress(['run', '--detach', '--port', '0', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(detached.exitCode, detached.standardError).toBe(0);
    const onTheSameCode = await runAgentProgress(['update'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(onTheSameCode.standardOutput).not.toContain('Handing the runner');

    // The live runner's lease says it runs older code, as after a pull into the checkout the binary links to.
    writeFileSync(join(runnerDirectory(), 'lease-1.json'), `${JSON.stringify({ ...leaseOf('lease-1.json'), codeVersion: 'code-older' })}\n`);
    const updated = await runAgentProgress(['update'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(updated.exitCode, `${updated.standardError}\n${runnerLogText()}`).toBe(0);
    expect(updated.standardOutput).toContain(`Runner handed over to code ${CodeVersion.onDisk()}`);
    expect(leaseFileNames()).toEqual(['lease-2.json']);

    writeFileSync(join(runnerDirectory(), 'lease-2.json'), `${JSON.stringify({ ...leaseOf('lease-2.json'), codeVersion: 'code-older' })}\n`);
    const { eventLogPath } = hostFilesOf(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'jobs', 'J1'), 1);
    for (let attempt = 0; attempt < HOST_WAIT_TRIES && !existsSync(eventLogPath); attempt++) await Bun.sleep(HOST_WAIT_MILLISECONDS);
    appendFileSync(eventLogPath, 'not an event\n');
    const manifestPath = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'version.json');
    rmSync(manifestPath);
    const failed = await runAgentProgress(['update'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(failed.exitCode, failed.standardError).toBe(1);
    expect(failed.standardError).toContain('failed at read-host-files');
    expect(existsSync(manifestPath)).toBe(true);
    expect(leaseFileNames()).toEqual(['lease-2.json']);
    await stopRunner();
  }, RUNNER_TEST_TIMEOUT_MILLISECONDS);

  test('stop with no runner live has nothing to do', async () => {
    const stopped = await runAgentProgress(['run', 'stop'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(stopped.exitCode).toBe(0);
    expect(stopped.standardOutput.trim()).toBe('No runner is live; nothing to stop.');
  });
});

describe('run pause and resume', () => {
  test('write the stored drain flag through the write pipeline with no runner up', async () => {
    const paused = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['run', 'resume', '--json'], paused), paused.errorText()).toBe(0);
    expect(JSON.parse(paused.outputText())).toEqual({ dispatcherState: 'running', previousState: 'stopped' });
    const resumed = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['run', 'pause', '--json'], resumed), resumed.errorText()).toBe(0);
    expect(JSON.parse(resumed.outputText())).toEqual({ dispatcherState: 'stopped', previousState: 'running' });
    const progress = JSON.parse(readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json'), 'utf8')) as Record<string, unknown>;
    expect(progress['dispatcherState']).toBe('stopped');
  });

  test('the board state the Bridge header reads agrees with run status after a resume and after a pause', async () => {
    const pausedFlagsAfter = async (subcommand: 'resume' | 'pause'): Promise<{ header: boolean; runStatus: unknown }> => {
      const moved = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
      expect(await runCommandLine(['run', subcommand], moved), moved.errorText()).toBe(0);
      const statusContext = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
      expect(await runCommandLine(['run', 'status', '--json'], statusContext), statusContext.errorText()).toBe(0);
      const boardState = readBoardState({
        context:   createCapturedCommandContext({ currentDirectory: repositoryDirectory }),
        workspace: requireWorkspace(repositoryDirectory),
        notices:   () => [],
        overseer:  () => ({
          state: 'serving', url: null, generation: null, codeVersion: 'example', installVersion: INSTALL_VERSION, handoverWarning: null
        }),
      }).state;
      return { header: boardState.overseer.paused, runStatus: (JSON.parse(statusContext.outputText()) as Record<string, unknown>)['paused'] };
    };
    expect(await pausedFlagsAfter('resume')).toEqual({ header: false, runStatus: false });
    expect(await pausedFlagsAfter('pause')).toEqual({ header: true, runStatus: true });
  });
});

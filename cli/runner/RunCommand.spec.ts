/**
 * The runner's start, lease and stop, end to end through real child processes, since a runner holds its process until it is stopped.
 * What matters: two starters at once leave exactly one runner serving; a lease naming a dead process is taken over as after a crash; a
 * runner whose generation was overtaken stops at exit 2 touching nothing; `run --detach`, `run status`, `run restart` and `run stop`
 * agree with the lease; `run pause|resume` write the drain flag with no runner up; and a spec-spawned runner resolves the fake agent,
 * never the vendor's adapter. Every runner binds `--port 0`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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

import { CodeVersion }                                    from '../../src/services/runner/CodeVersion.ts';
import { fakeAgentVariableOf }                            from '../../src/shared/Environment.ts';
import { PRODUCT_NAMES }                                  from '../../src/shared/constants/ProductNames.ts';
import { FAKE_AGENT_VENDOR }                              from '../../src/testing/FakeAgentAdapter.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { runCommandLine }                                 from '../Main.ts';
import { createCapturedCommandContext }                   from '../testing/CapturedCommandContext.ts';
import { runAgentProgress, startAgentProgress }           from '../testing/CliProcess.ts';
import { createInitializedScratchRepository }             from '../testing/InitializedScratchRepository.ts';

const SPEC_CLOCK = (): Date => new Date('2026-09-18T20:11:03Z');

const OWNER_ONLY_FILE_MODE = 0o600;
const PERMISSION_BITS      = 0o777;
const RUNNER_TEST_TIMEOUT_MILLISECONDS = 30_000;

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
  repositoryDirectory = await createInitializedScratchRepository('runner', ['--project', 'Example Agency', '--no-claude-md', '--no-hooks'], SPEC_CLOCK);
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
  test('is the fake agent by default, and the guard reads the vendor\'s once the fake-agent switch is planted off', async () => {
    const runner = startRunner();
    expect(await runner.firstOutputLine).toStartWith('http://127.0.0.1:');
    expect(announcedVendorSince(0)).toBe(FAKE_AGENT_VENDOR);
    await stopRunner();
    expect((await runner.finished).exitCode).toBe(0);

    const logLength = readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'runner.log'), 'utf8').length;
    const switchedOff = { [fakeAgentVariableOf(PRODUCT_NAMES)]: '0' };
    const planted     = startAgentProgress(['run', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory, environment: switchedOff });
    expect(await planted.firstOutputLine).toStartWith('http://127.0.0.1:');
    expect(announcedVendorSince(logLength)).toBe('claude-code');
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
    expect(restarted.exitCode, restarted.standardError).toBe(0);
    expect(JSON.parse(restarted.standardOutput)).toEqual({ outcome: 'done', url });
    expect(leaseOf(leaseFileNames()[0] ?? '')['processId']).not.toBe(processBefore);

    const stopped = await runAgentProgress(['run', 'stop', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(stopped.standardOutput)).toEqual({ outcome: 'done' });
    expect(leaseFileNames()).toEqual([]);
    const statusAfter = await runAgentProgress(['run', 'status', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(statusAfter.standardOutput)).toMatchObject({ state: 'down', url: null });
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
});

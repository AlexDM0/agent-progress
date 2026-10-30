/**
 * The Overseer's start, Baton and stop, end to end through real child processes, since an Overseer holds its process until it is stopped.
 * What matters: two starters at once leave exactly one Overseer serving; a Baton naming a dead process is taken over as after a crash; a
 * Overseer whose generation was overtaken stops at exit 2 touching nothing; `oversee --detach`, `oversee status`, `oversee restart` and `oversee stop`
 * agree with the Baton; `oversee stop --now` stops a live process Watcher, which a plain stop leaves running; `oversee pause|resume` write the
 * drain flag with no Overseer up, which the Bridge header's board state and `oversee status` read alike; and a spec-spawned Overseer resolves
 * the fake agent, never the vendor's adapter. Every Overseer binds `--port 0`.
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

import { processIsGone }                                  from '../../src/lib/process-identity/ProcessIdentity.ts';
import { watcherFilesOf }                                 from '../../src/lib/watcher/WatcherFiles.ts';
import { CodeVersion }                                    from '../../src/services/overseer/CodeVersion.ts';
import { WatcherFleet }                                   from '../../src/services/overseer/WatcherFleet.ts';
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
const OVERSEER_TEST_TIMEOUT_MILLISECONDS = 30_000;
const WATCHER_WAIT_TRIES = 100;
const WATCHER_WAIT_MILLISECONDS = 50;
const WATCHER_BINARY_PATH = new URL('../../watcher.ts', import.meta.url).pathname;

let repositoryDirectory = '';
let homeDirectory       = '';

function overseerDirectory(): string {
  return join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'overseer');
}

function batonFileNames(): string[] {
  return existsSync(overseerDirectory()) ? readdirSync(overseerDirectory()).filter((fileName) => /^baton-\d+\.json$/.test(fileName)).sort() : [];
}

function batonOf(fileName: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(overseerDirectory(), fileName), 'utf8')) as Record<string, unknown>;
}

function overseerLogText(): string {
  const logFilePath = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'overseer.log');
  return existsSync(logFilePath) ? readFileSync(logFilePath, 'utf8') : '';
}

function storedLogKindsOf(repository: string): string[] {
  return readFileSync(join(repository, PRODUCT_NAMES.DATA_FOLDER, 'log.jsonl'), 'utf8').split('\n').filter((line) => line !== '')
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

/** This process's pid with a start no process ever had: a Baton that reads as dead without depending on a pid being free. */
function plantDeadBaton(generation: number): void {
  mkdirSync(overseerDirectory(), { recursive: true });
  writeFileSync(join(overseerDirectory(), `baton-${generation}.json`), JSON.stringify({
    processId:                process.pid,
    processStartEpochSeconds: 1,
    bootIdentity:             'example-boot',
    port:                     1,
    url:                      'http://127.0.0.1:1/',
    tokenFile:                join(overseerDirectory(), 'token'),
    codeVersion:              'code-example',
    installVersion:           1,
    watcherProtocolVersion:   1,
  }));
}

function startOverseer() {
  return startAgentProgress(['oversee', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory });
}

async function stopOverseer(): Promise<void> {
  const stopped = await runAgentProgress(['oversee', 'stop'], { currentDirectory: repositoryDirectory, homeDirectory });
  expect(stopped.exitCode, stopped.standardError).toBe(0);
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('overseer', ['--project', 'Example Agency', '--no-hooks'], SPEC_CLOCK);
  homeDirectory       = createScratchDirectory('overseer-home');
});

afterEach(async () => {
  await runAgentProgress(['oversee', 'stop'], { currentDirectory: repositoryDirectory, homeDirectory });
  removeScratchDirectory(repositoryDirectory);
  removeScratchDirectory(homeDirectory);
});

describe('run in the foreground', () => {
  test('two starters at once leave exactly one Overseer serving; the other refuses already-running or contended at exit 1', async () => {
    const starters = [startOverseer(), startOverseer()];
    const firstLines = await Promise.all(starters.map((starter) => Promise.race([starter.firstOutputLine, starter.finished.then(() => null)])));
    const servingIndex = firstLines.findIndex((line) => line !== null);
    expect(servingIndex).toBeGreaterThanOrEqual(0);
    const refused = await (starters[1 - servingIndex]?.finished ?? Promise.reject(new Error('no second starter')));
    expect(refused.exitCode, refused.standardError).toBe(1);
    expect(refused.standardError).toMatch(/An Overseer already serves this board at http:\/\/127\.0\.0\.1:\d+\/|Another Overseer started/);

    const url = firstLines[servingIndex] ?? '';
    expect(batonFileNames()).toEqual(['baton-1.json']);
    const baton = batonOf('baton-1.json');
    expect(baton).toMatchObject({ processId: starters[servingIndex]?.processId, url, codeVersion: CodeVersion.onDisk() });
    expect(Object.keys(baton)).toEqual([
      'processId', 'processStartEpochSeconds', 'bootIdentity', 'port', 'url', 'tokenFile', 'codeVersion', 'installVersion', 'watcherProtocolVersion',
    ]);
    expect(statSync(join(overseerDirectory(), 'token')).mode & PERMISSION_BITS).toBe(OWNER_ONLY_FILE_MODE);
    const identity = await (await fetch(new URL('api/identity', url))).json() as Record<string, unknown>;
    expect(identity).toMatchObject({ application: PRODUCT_NAMES.PROGRAM, project: 'Example Agency', processId: baton['processId'] });

    await stopOverseer();
    expect((await starters[servingIndex]?.finished)?.exitCode).toBe(0);
    expect(batonFileNames()).toEqual([]);
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);

  test('a Baton naming a dead process is replaced by the next generation, which removes the older one', async () => {
    plantDeadBaton(3);
    const overseer = startOverseer();
    expect(await overseer.firstOutputLine).toStartWith('http://127.0.0.1:');
    expect(batonFileNames()).toEqual(['baton-4.json']);
    await stopOverseer();
    expect((await overseer.finished).exitCode).toBe(0);
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);

  test('an Overseer whose generation a newer Baton overtook stops baton-taken at exit 2 and unlinks nothing', async () => {
    const overseer = startOverseer();
    expect(await overseer.firstOutputLine).toStartWith('http://127.0.0.1:');
    plantDeadBaton(2);
    const finished = await overseer.finished;
    expect(finished.exitCode).toBe(2);
    expect(finished.standardError).toContain('A newer Overseer took this board over');
    expect(batonFileNames()).toEqual(['baton-1.json', 'baton-2.json']);
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);
});

/** The vendor an Overseer announced in its log since `fromOffset`: the adapter its process resolved. */
function announcedVendorSince(fromOffset: number): string | null {
  const logText = readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'overseer.log'), 'utf8').slice(fromOffset);
  return /, agents ([\w-]+)\)\./.exec(logText)?.[1] ?? null;
}

describe('the agent adapter of a spec-spawned overseer', () => {
  test('is the fake agent by default, and stays the fake agent when a spec\'s environment plants the fake-agent switch off', async () => {
    const overseer = startOverseer();
    expect(await overseer.firstOutputLine).toStartWith('http://127.0.0.1:');
    expect(announcedVendorSince(0)).toBe(FAKE_AGENT_VENDOR);
    await stopOverseer();
    expect((await overseer.finished).exitCode).toBe(0);

    const logLength = readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'overseer.log'), 'utf8').length;
    const switchedOff = { [fakeAgentVariableOf(PRODUCT_NAMES)]: '0' };
    const planted     = startAgentProgress(['oversee', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory, environment: switchedOff });
    expect(await planted.firstOutputLine).toStartWith('http://127.0.0.1:');
    expect(announcedVendorSince(logLength)).toBe(FAKE_AGENT_VENDOR);
    await stopOverseer();
    expect((await planted.finished).exitCode).toBe(0);
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);
});

describe('run --detach, status, restart and stop', () => {
  test('a detached Overseer prints its URL once it answers; status reports it serving; restart keeps its port under a new process', async () => {
    const detached = await runAgentProgress(['oversee', '--detach', '--port', '0', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(detached.exitCode, detached.standardError).toBe(0);
    const { url } = JSON.parse(detached.standardOutput) as { url: string };

    const status = await runAgentProgress(['oversee', 'status', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(status.standardOutput)).toMatchObject({
      state: 'serving', paused: true, url, codeVersionOnDisk: CodeVersion.onDisk(), codeVersionInMemory: CodeVersion.onDisk(),
    });

    const processBefore = batonOf(batonFileNames()[0] ?? '')['processId'];
    const restarted = await runAgentProgress(['oversee', 'restart', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(restarted.exitCode, `${restarted.standardError}\n${overseerLogText()}`).toBe(0);
    expect(JSON.parse(restarted.standardOutput)).toEqual({ outcome: 'done', url, codeVersion: CodeVersion.onDisk() });
    expect(batonFileNames()).toEqual(['baton-2.json']);
    expect(batonOf(batonFileNames()[0] ?? '')['processId']).not.toBe(processBefore);
    expect(storedLogKindsOf(repositoryDirectory).filter((kind) => kind.startsWith('overseer-'))).toEqual(['overseer-started', 'overseer-stopped', 'overseer-started']);

    const stopped = await runAgentProgress(['oversee', 'stop', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(stopped.standardOutput)).toEqual({ outcome: 'done' });
    expect(batonFileNames()).toEqual([]);
    const statusAfter = await runAgentProgress(['oversee', 'status', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(statusAfter.standardOutput)).toMatchObject({ state: 'down', url: null });
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);

  test('a second restart while a Baton pass runs leaves the successor\'s ready report standing, and the first Baton pass completes', async () => {
    const detached = await runAgentProgress(['oversee', '--detach', '--port', '0', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(detached.exitCode, detached.standardError).toBe(0);
    const { url } = JSON.parse(detached.standardOutput) as { url: string };
    const batonPassFilePath = join(overseerDirectory(), 'baton-pass-1.json');
    const batonPassState = (): string | null => {
      try {
        return (JSON.parse(readFileSync(batonPassFilePath, 'utf8')) as { state: string }).state;
      } catch {
        return null;
      }
    };

    const restarting = runAgentProgress(['oversee', 'restart', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    // The old Overseer looks for `ready` only every interval, so a second command sent the moment it appears arrives before that look.
    for (let attempt = 0; attempt < 20_000 && batonPassState() !== 'ready'; attempt++) await Bun.sleep(1);
    expect(batonPassState()).toBe('ready');
    const token = readFileSync(join(overseerDirectory(), 'token'), 'utf8').trim();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const body    = JSON.stringify({ kind: 'overseer-restart', now: false });
    await fetch(new URL('api/commands', url), { method: 'POST', headers, body }).catch(() => null);
    expect(batonPassState()).not.toBe('requested');

    const restarted = await restarting;
    expect(restarted.exitCode, `${restarted.standardError}\n${overseerLogText()}`).toBe(0);
    expect(batonFileNames()).toEqual(['baton-2.json']);
    await stopOverseer();
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);

  test('a successor that fails a step exits; restart exits 1 baton-pass-failed and the old Overseer keeps driving, logging it and warning', async () => {
    const detached = await runAgentProgress(['oversee', '--detach', '--port', '0', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(detached.exitCode, detached.standardError).toBe(0);
    const { url } = JSON.parse(detached.standardOutput) as { url: string };
    const batonBefore = batonOf('baton-1.json');
    // The successor reads every claimed Watcher's event log before it reports ready: a malformed line in the orchestrator's fails that step.
    const { eventLogPath } = watcherFilesOf(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'jobs', 'J1'), 1);
    for (let attempt = 0; attempt < WATCHER_WAIT_TRIES && !existsSync(eventLogPath); attempt++) await Bun.sleep(WATCHER_WAIT_MILLISECONDS);
    appendFileSync(eventLogPath, 'not an event\n');

    const restarted = await runAgentProgress(['oversee', 'restart', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(restarted.exitCode, `${restarted.standardError}\n${overseerLogText()}`).toBe(1);
    expect(`${restarted.standardOutput}${restarted.standardError}`).toContain('failed at read-watcher-files');
    expect(batonFileNames()).toEqual(['baton-1.json']);
    expect(batonOf('baton-1.json')).toEqual(batonBefore);
    expect(storedLogKindsOf(repositoryDirectory)).toContain('baton-pass-failed');

    const status = await runAgentProgress(['oversee', 'status', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(JSON.parse(status.standardOutput)).toMatchObject({ url, batonPassWarning: { step: 'read-watcher-files' } });
    expect((await runAgentProgress(['oversee', 'status'], { currentDirectory: repositoryDirectory, homeDirectory })).standardOutput)
      .toContain('warning: the Baton pass to code');
    await stopOverseer();
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);

  test('update ends by handing a live Overseer on other code to the code on disk; a failed Baton pass exits 1, its install writes standing', async () => {
    const withNoOverseer = await runAgentProgress(['update'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(withNoOverseer.exitCode, withNoOverseer.standardError).toBe(0);
    expect(withNoOverseer.standardOutput).not.toContain('Handing the overseer');

    const detached = await runAgentProgress(['oversee', '--detach', '--port', '0', '--json'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(detached.exitCode, detached.standardError).toBe(0);
    const onTheSameCode = await runAgentProgress(['update'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(onTheSameCode.standardOutput).not.toContain('Handing the overseer');

    // The live Overseer's Baton says it runs older code, as after a pull into the checkout the binary links to.
    writeFileSync(join(overseerDirectory(), 'baton-1.json'), `${JSON.stringify({ ...batonOf('baton-1.json'), codeVersion: 'code-older' })}\n`);
    const updated = await runAgentProgress(['update'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(updated.exitCode, `${updated.standardError}\n${overseerLogText()}`).toBe(0);
    expect(updated.standardOutput).toContain(`Overseer handed over to code ${CodeVersion.onDisk()}`);
    expect(batonFileNames()).toEqual(['baton-2.json']);

    writeFileSync(join(overseerDirectory(), 'baton-2.json'), `${JSON.stringify({ ...batonOf('baton-2.json'), codeVersion: 'code-older' })}\n`);
    const { eventLogPath } = watcherFilesOf(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'jobs', 'J1'), 1);
    for (let attempt = 0; attempt < WATCHER_WAIT_TRIES && !existsSync(eventLogPath); attempt++) await Bun.sleep(WATCHER_WAIT_MILLISECONDS);
    appendFileSync(eventLogPath, 'not an event\n');
    const manifestPath = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'version.json');
    rmSync(manifestPath);
    const failed = await runAgentProgress(['update'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(failed.exitCode, failed.standardError).toBe(1);
    expect(failed.standardError).toContain('failed at read-watcher-files');
    expect(existsSync(manifestPath)).toBe(true);
    expect(batonFileNames()).toEqual(['baton-2.json']);
    await stopOverseer();
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);

  test('stop --now stops a live install Watcher before the Overseer exits; a plain stop leaves it running', async () => {
    const monitorFolder = createScratchDirectory('h');
    const trackerDirectory = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER);
    try {
      const watcherFolder = join(trackerDirectory, 'jobs', 'J-example', 'install-1');
      WatcherFleet.writeProcessLaunchFile({
        watcherFolder,
        instance:           1,
        jobId:              'J-example',
        socketName:         'J-example/install-1',
        trackerId:          'tracker-example',
        monitorFolder,
        watcherCodeVersion: 'code-example',
        workingDirectory:   watcherFolder,
        argv:               [process.execPath, '-e', 'setInterval(() => undefined, 1000);'],
        environment:        {},
      });
      const watcherProcessId = WatcherFleet.spawnWatcher({ bundlePath: WATCHER_BINARY_PATH, jobFolder: watcherFolder, instance: 1 });
      if (watcherProcessId === undefined) throw new Error('the install Watcher did not spawn');
      for (let attempt = 0; attempt < WATCHER_WAIT_TRIES && WatcherFleet.livenessOf(watcherFolder, 1).verdict !== 'live'; attempt += 1) await Bun.sleep(WATCHER_WAIT_MILLISECONDS);
      expect(WatcherFleet.livenessOf(watcherFolder, 1).verdict).toBe('live');

      const startOverseerDetached = async (): Promise<void> => {
        const detached = await runAgentProgress(['oversee', '--detach', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory });
        expect(detached.exitCode, detached.standardError).toBe(0);
      };
      await startOverseerDetached();
      await stopOverseer();
      expect(WatcherFleet.livenessOf(watcherFolder, 1).verdict).toBe('live');

      await startOverseerDetached();
      const stoppedNow = await runAgentProgress(['oversee', 'stop', '--now'], { currentDirectory: repositoryDirectory, homeDirectory });
      expect(stoppedNow.exitCode, stoppedNow.standardError).toBe(0);
      expect(WatcherFleet.livenessOf(watcherFolder, 1)).toMatchObject({ verdict: 'ended' });
      for (let attempt = 0; attempt < WATCHER_WAIT_TRIES && !processIsGone(watcherProcessId); attempt += 1) await Bun.sleep(WATCHER_WAIT_MILLISECONDS);
      expect(processIsGone(watcherProcessId), overseerLogText()).toBe(true);
    } finally {
      // A failed assertion would otherwise leave the Watcher and its child running past the scratch repository.
      await WatcherFleet.stopLiveProcessWatchers(trackerDirectory);
      await WatcherFleet.reapEndedWatchers(trackerDirectory);
      removeScratchDirectory(monitorFolder);
    }
  }, OVERSEER_TEST_TIMEOUT_MILLISECONDS);

  test('stop with no Overseer live has nothing to do', async () => {
    const stopped = await runAgentProgress(['oversee', 'stop'], { currentDirectory: repositoryDirectory, homeDirectory });
    expect(stopped.exitCode).toBe(0);
    expect(stopped.standardOutput.trim()).toBe('No Overseer is live; nothing to stop.');
  });
});

describe('run pause and resume', () => {
  test('write the stored drain flag through the write pipeline with no Overseer up', async () => {
    const paused = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['oversee', 'resume', '--json'], paused), paused.errorText()).toBe(0);
    expect(JSON.parse(paused.outputText())).toEqual({ overseerState: 'running', previousState: 'paused' });
    const resumed = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['oversee', 'pause', '--json'], resumed), resumed.errorText()).toBe(0);
    expect(JSON.parse(resumed.outputText())).toEqual({ overseerState: 'paused', previousState: 'running' });
    const progress = JSON.parse(readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json'), 'utf8')) as Record<string, unknown>;
    expect(progress['overseerState']).toBe('paused');
  });

  test('the board state the Bridge header reads agrees with oversee status after a resume and after a pause', async () => {
    const pausedFlagsAfter = async (commandLine: readonly string[]): Promise<{ header: boolean; runStatus: unknown }> => {
      const moved = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
      expect(await runCommandLine([...commandLine], moved), moved.errorText()).toBe(0);
      const statusContext = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
      expect(await runCommandLine(['oversee', 'status', '--json'], statusContext), statusContext.errorText()).toBe(0);
      const boardState = readBoardState({
        context:   createCapturedCommandContext({ currentDirectory: repositoryDirectory }),
        workspace: requireWorkspace(repositoryDirectory),
        notices:   () => [],
        overseer:  () => ({
          state: 'serving', url: null, generation: null, codeVersion: 'example', installVersion: INSTALL_VERSION, batonPassWarning: null
        }),
      }).state;
      return { header: boardState.overseer.paused, runStatus: (JSON.parse(statusContext.outputText()) as Record<string, unknown>)['paused'] };
    };
    expect(await pausedFlagsAfter(['oversee', 'resume'])).toEqual({ header: false, runStatus: false });
    expect(await pausedFlagsAfter(['oversee', 'pause'])).toEqual({ header: true, runStatus: true });
  });
});

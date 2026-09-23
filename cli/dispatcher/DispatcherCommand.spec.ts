/**
 * Where the user left the dispatcher, which has to outlive the orchestrator's context: a tracker that never set it reads `finished` and
 * is not rewritten by the read, each state is read back from the file rather than from anything the process kept, an unknown word
 * leaves the file byte-identical, and the Next line and `status --json` carry what the state means.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import type { DispatcherState, ProgressFile }                                 from '../../lib/constants/Types';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-23T20:11:03Z');

let repositoryDirectory = '';

function progressFilePath(): string {
  return join(repositoryDirectory, '.agent-progress', 'progress.json');
}

function storedProgress(): ProgressFile {
  return JSON.parse(readFileSync(progressFilePath(), 'utf8')) as ProgressFile;
}

async function runWithExitCode(commandLineArguments: readonly string[]): Promise<{ exitCode: number; context: ReturnType<typeof createCapturedCommandContext> }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, context };
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const { context, exitCode } = await runWithExitCode(commandLineArguments);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

async function statusNextLine(): Promise<string | undefined> {
  return (await run(['status'])).outputText().split('\n').at(-1);
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('dispatcher-command');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the dispatcher state', () => {
  // Every tracker written before the field existed lacks it; reading it must neither fail nor add the field.
  test('a tracker without the field reads finished, and the read leaves the file byte-identical', async () => {
    const progress = storedProgress();
    delete progress.dispatcherState;
    const writtenWithoutState = JSON.stringify(progress);
    writeFileSync(progressFilePath(), writtenWithoutState);

    expect((await run(['dispatcher'])).outputText()).toBe('finished');
    expect(JSON.parse((await run(['dispatcher', '--json'])).outputText())).toEqual({ dispatcherState: 'finished' });
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(writtenWithoutState);
  });

  test.each<[DispatcherState]>([['running'], ['stopped'], ['finished']])('"%s" is stored in the progress file with one log line and read back', async (state) => {
    await run(['dispatcher', state]);

    expect(storedProgress().dispatcherState).toBe(state);
    expect(storedProgress().log.at(-1)?.text).toBe(`Dispatcher set to ${state}`);
    expect((await run(['dispatcher'])).outputText()).toBe(state);
  });

  test('setting a state names the one it replaced', async () => {
    await run(['dispatcher', 'running']);

    expect((await run(['dispatcher', 'stopped'])).outputText()).toBe('Dispatcher set to stopped (was running).');
  });

  test.each([['paused'], ['Running'], ['constructor']])('"%s" is refused at exit 1 and the progress file is left byte-identical', async (written) => {
    const before = readFileSync(progressFilePath(), 'utf8');

    const { exitCode } = await runWithExitCode(['dispatcher', written]);

    expect(exitCode).toBe(1);
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
  });

  test('a stored state that is not one of the three makes the progress file unreadable rather than guessed at', async () => {
    writeFileSync(progressFilePath(), JSON.stringify({ ...storedProgress(), dispatcherState: 'paused' }));

    const { exitCode, context } = await runWithExitCode(['dispatcher']);

    expect(exitCode).toBe(2);
    expect(context.errorText()).toContain('dispatcherState');
  });

  test('status --json carries the state in its concurrency block', async () => {
    await run(['dispatcher', 'stopped']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as { concurrency: { dispatcherState: string } };
    expect(document.concurrency.dispatcherState).toBe('stopped');
  });
});

describe.skipIf(!gitIsAvailable())('the advice the Next line gives', () => {
  beforeEach(async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
  });

  test('a finished dispatcher with a ticket ready is to be launched', async () => {
    expect(await statusNextLine()).toBe('Next: 2 of 2 slots free; ready: #001; launch the dispatcher');
  });

  test('a stopped dispatcher is to be left alone until the user permits it', async () => {
    await run(['dispatcher', 'stopped']);

    expect(await statusNextLine()).toBe('Next: 2 of 2 slots free; ready: #001; dispatcher stopped by the user: wait for permission');
  });

  test('a running dispatcher needs no advice', async () => {
    await run(['dispatcher', 'running']);

    expect(await statusNextLine()).toBe('Next: 2 of 2 slots free; ready: #001');
  });
});

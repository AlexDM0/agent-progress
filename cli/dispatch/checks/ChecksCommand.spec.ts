/**
 * The check command the tracker holds for `release`: a tracker that never set one reads none and keeps its file byte-identical, a stored
 * one is what a later command reads, clearing it removes the key, and every refusal leaves the progress file and the log as they were.
 */
import { readFileSync } from 'node:fs';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
import { workspacePathsFor }                  from '../../../src/services/tracker/Workspace.ts';
import { removeScratchDirectory }             from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../../Main.ts';
import { createCapturedCommandContext }       from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';
import { storedLogEntriesOf }                 from '../../testing/StoredLogEntries.ts';
import { storedLogTextOf }                    from '../../testing/StoredLogText.ts';
import { storedProgressOf }                   from '../../testing/StoredProgress.ts';

const FROZEN_NOW = new Date('2026-10-06T09:00:00Z');

const EXAMPLE_CHECK_COMMAND = 'bun run typecheck && bun test';

let repositoryDirectory = '';

function progressFilePath(): string {
  return workspacePathsFor(repositoryDirectory).progressFilePath;
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

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('checks-command', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the check command', () => {
  test('a fresh tracker reads none, says how to set one, and the read leaves the file byte-identical', async () => {
    const before = readFileSync(progressFilePath(), 'utf8');

    expect((await run(['checks'])).outputText()).toContain('No check command is set');
    expect(JSON.parse((await run(['checks', '--json'])).outputText())).toEqual({ checkCommand: null });
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
  });

  test('a stored command is what a later command reads, verbatim, and setting it logs one line naming it', async () => {
    const setting = JSON.parse((await run(['checks', EXAMPLE_CHECK_COMMAND, '--json'])).outputText()) as unknown;

    expect(setting).toEqual({ checkCommand: EXAMPLE_CHECK_COMMAND, previousCheckCommand: null });
    expect((await run(['checks'])).outputText()).toBe(EXAMPLE_CHECK_COMMAND);
    expect(storedProgressOf(repositoryDirectory).checkCommand).toBe(EXAMPLE_CHECK_COMMAND);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toBe(`Check command set to ${EXAMPLE_CHECK_COMMAND}`);
  });

  test('a second command replaces the first, and the change names the one it replaced', async () => {
    await run(['checks', 'bun test']);

    const replacing = await run(['checks', EXAMPLE_CHECK_COMMAND]);

    expect(replacing.outputText()).toBe(`Check command set to ${EXAMPLE_CHECK_COMMAND} (was bun test).`);
    expect(storedProgressOf(repositoryDirectory).checkCommand).toBe(EXAMPLE_CHECK_COMMAND);
  });

  // A cleared setting has to read exactly like one never set, or a release would still look for a command.
  test('--clear removes the key from the progress file and logs one line', async () => {
    await run(['checks', EXAMPLE_CHECK_COMMAND]);

    const clearing = JSON.parse((await run(['checks', '--clear', '--json'])).outputText()) as unknown;

    expect(clearing).toEqual({ checkCommand: null, previousCheckCommand: EXAMPLE_CHECK_COMMAND });
    expect(Object.hasOwn(storedProgressOf(repositoryDirectory), 'checkCommand')).toBe(false);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toBe('Check command cleared');
  });

  test.each([
    ['a blank command', ['checks', '  ']],
    ['a command beside --clear', ['checks', EXAMPLE_CHECK_COMMAND, '--clear']],
    ['--clear with none stored', ['checks', '--clear']],
    ['a command given as two arguments', ['checks', 'bun', 'test']],
    ['an option it does not know', ['checks', EXAMPLE_CHECK_COMMAND, '--worktree', '.']],
  ])('%s is refused at exit 1, and the progress file and the log are left byte-identical', async (_case, commandLineArguments) => {
    const before    = readFileSync(progressFilePath(), 'utf8');
    const logBefore = storedLogTextOf(repositoryDirectory);

    const { exitCode } = await runWithExitCode(commandLineArguments);

    expect(exitCode).toBe(1);
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });
});

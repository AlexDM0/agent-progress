/**
 * The limit the board holds: the default a tracker that never set one reads (a tracker from before the field existed included), a stored
 * value read back by a later command, the refusals that must leave the file byte-identical, and a lowered limit that takes nothing back.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { workspacePathsFor }                  from '../../../src/services/tracker/Workspace.ts';
import { removeScratchDirectory }             from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../../Main.ts';
import { createCapturedCommandContext }       from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';
import { storedLogEntriesOf }                 from '../../testing/StoredLogEntries.ts';
import { storedLogTextOf }                    from '../../testing/StoredLogText.ts';
import { storedProgressOf }                   from '../../testing/StoredProgress.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

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
  repositoryDirectory = await createInitializedScratchRepository('concurrency-command', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the concurrency limit', () => {
  test('a fresh tracker reads 2', async () => {
    expect((await run(['concurrency'])).outputText()).toBe('2');
  });

  // Every tracker written before the field existed lacks it, and an unreadable progress file would stop every command in that repository.
  test('a tracker whose progress file has no limit at all still reads, as 2, and the read leaves the file byte-identical', async () => {
    const progress = storedProgressOf(repositoryDirectory);
    delete progress.concurrencyLimit;
    const writtenWithoutLimit = JSON.stringify(progress);
    writeFileSync(progressFilePath(), writtenWithoutLimit);

    expect((await run(['concurrency'])).outputText()).toBe('2');
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(writtenWithoutLimit);
  });

  test('a stored limit is what a later command reads, and setting it logs one line', async () => {
    await run(['concurrency', '3']);

    expect((await run(['concurrency'])).outputText()).toBe('3');
    expect(storedProgressOf(repositoryDirectory).concurrencyLimit).toBe(3);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toBe('Concurrency limit set to 3');
  });

  test.each([['0'], ['-1'], ['x'], ['2.5'], ['11']])('"%s" is refused at exit 1 and the progress file is left byte-identical', async (written) => {
    const before    = readFileSync(progressFilePath(), 'utf8');
    const logBefore = storedLogTextOf(repositoryDirectory);

    const { exitCode } = await runWithExitCode(['concurrency', written]);

    expect(exitCode).toBe(1);
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });

  // The ceiling itself is a limit the user may set; one more is not.
  test('10 is accepted as the ceiling and read back', async () => {
    await run(['concurrency', '10']);

    expect((await run(['concurrency'])).outputText()).toBe('10');
  });

  // A tracker written before the ceiling existed may hold more; it must still read, and must never let more than 10 agents start.
  test('a hand-built tracker holding 12 reports 10, in the command and in status, and the read leaves the file byte-identical', async () => {
    const progress = storedProgressOf(repositoryDirectory);
    progress.concurrencyLimit = 12;
    const writtenAboveTheCeiling = JSON.stringify(progress);
    writeFileSync(progressFilePath(), writtenAboveTheCeiling);

    expect((await run(['concurrency'])).outputText()).toBe('10');
    const document = JSON.parse((await run(['status', '--json'])).outputText()) as { concurrency: { limit: number; freeSlots: number } };
    expect(document.concurrency).toMatchObject({ limit: 10, freeSlots: 10 });
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(writtenAboveTheCeiling);
  });

  // The user lowers the limit when the session is running out; the agents already at work are not stopped, only no new one may start.
  test('a limit below the rows already running is accepted, and status then reports no free slot', async () => {
    await run(['task', 'add', 'Review pass one', '--start']);
    await run(['task', 'add', 'Review pass two', '--start']);

    await run(['concurrency', '1']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as { concurrency: { limit: number; agentsInFlight: number; freeSlots: number } };
    expect(document.concurrency).toMatchObject({ limit: 1, agentsInFlight: 2, freeSlots: 0 });
  });
});

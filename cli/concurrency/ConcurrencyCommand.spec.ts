/**
 * The limit the board holds: the default a tracker that never set one reads (a tracker from before the field existed included), a stored
 * value read back by a later command, the refusals that must leave the file byte-identical, and a lowered limit that takes nothing back.
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
import type { ProgressFile }                                                  from '../../lib/constants/Types';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

let repositoryDirectory = '';

function progressFilePath(): string {
  return join(repositoryDirectory, '.agent-progress', 'progress.json');
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
  repositoryDirectory = createScratchGitRepository('concurrency-command');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the concurrency limit', () => {
  test('a fresh tracker reads 2', async () => {
    expect((await run(['concurrency'])).outputText()).toBe('2');
  });

  // Every tracker written before the field existed lacks it, and an unreadable progress file would stop every command in that repository.
  test('a tracker whose progress file has no limit at all still reads, as 2', async () => {
    const progress = JSON.parse(readFileSync(progressFilePath(), 'utf8')) as ProgressFile;
    delete progress.concurrencyLimit;
    writeFileSync(progressFilePath(), JSON.stringify(progress));

    expect((await run(['concurrency'])).outputText()).toBe('2');
  });

  test('a stored limit is what a later command reads, and setting it logs one line', async () => {
    await run(['concurrency', '3']);

    expect((await run(['concurrency'])).outputText()).toBe('3');
    const progress = JSON.parse(readFileSync(progressFilePath(), 'utf8')) as ProgressFile;
    expect(progress.concurrencyLimit).toBe(3);
    expect(progress.log.at(-1)?.text).toBe('Concurrency limit set to 3');
  });

  test.each([['0'], ['-1'], ['x'], ['2.5']])('"%s" is refused at exit 1 and the progress file is left byte-identical', async (written) => {
    const before = readFileSync(progressFilePath(), 'utf8');

    const { exitCode } = await runWithExitCode(['concurrency', written]);

    expect(exitCode).toBe(1);
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
  });

  // The user lowers the limit when the session is running out; the agents already at work are not stopped, only no new one may start.
  test('a limit below the rows already running is accepted, and status then reports no free slot', async () => {
    await run(['task', 'add', 'Review pass one', '--start']);
    await run(['task', 'add', 'Review pass two', '--start']);

    await run(['concurrency', '1']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as { concurrency: { limit: number; inFlight: number; freeSlots: number } };
    expect(document.concurrency).toMatchObject({ limit: 1, inFlight: 2, freeSlots: 0 });
  });
});

/**
 * The log line and the two ways a caller writes one: an unquoted line is recorded whole, and `--at` backfills the stamp.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

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

const FIVE_MINUTES_IN_MILLISECONDS = 5 * 60 * 1000;

let repositoryDirectory = '';

function contextHere(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

function storedProgress(): ProgressFile {
  return JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as ProgressFile;
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('log-command');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('appending to the log', () => {
  test('records a quoted line and confirms it', async () => {
    const context = await run(['log', 'Halfway through the role editor']);

    expect(storedProgress().log.at(-1)?.text).toBe('Halfway through the role editor');
    expect(context.outputText()).toContain('Logged: Halfway through the role editor');
  });

  test('records every positional, so an unquoted line is not truncated to its first word', async () => {
    await run(['log', 'fixed', 'the', 'axis']);

    expect(storedProgress().log.at(-1)?.text).toBe('fixed the axis');
  });

  test('--at backfills the stamp to the moment it names', async () => {
    await run(['log', 'Halfway through the role editor', '--at', '-5m']);

    const entry = storedProgress().log.at(-1);
    expect(Date.parse(entry?.at ?? '')).toBe(FROZEN_NOW.getTime() - FIVE_MINUTES_IN_MILLISECONDS);
  });

  test('--json prints the entry, which is the shape an orchestrator reads back', async () => {
    const context = await run(['log', 'Halfway through the role editor', '--json']);

    const printed = JSON.parse(context.outputText()) as { at: string; text: string };
    expect(printed.text).toBe('Halfway through the role editor');
  });

  test('a log with nothing to record is refused rather than appending a blank line', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['log'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('needs something to record');
    expect(storedProgress().log).toEqual([]);
  });
});

describe.skipIf(!gitIsAvailable())('an empty line', () => {
  test('a line that is nothing but whitespace is refused, like an absent one', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['log', '   '], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('needs something to record');
  });
});

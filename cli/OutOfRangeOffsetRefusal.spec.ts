/**
 * A signed offset whose result no stamp can hold is refused at exit 1 by every command that reads one, `--at`, `usage --since` and
 * `range`, and leaves the tracker's files byte for byte as they were; a reachable offset still goes through.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { createScratchGitRepository, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from './Main.ts';
import { createCapturedCommandContext }                       from './testing/CapturedCommandContext.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const OUT_OF_RANGE_OFFSET      = '+99999999d';
const OUT_OF_RANGE_PAST_OFFSET = '-99999999d';

const TRACKER_FILE_NAMES = ['progress.json', 'log.jsonl'];

let repositoryDirectory = '';

async function exitCodeAndErrorOf(commandLineArguments: readonly string[]): Promise<{ exitCode: number; errorText: string }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, errorText: context.errorText() };
}

function trackerFileContents(): string[] {
  return TRACKER_FILE_NAMES.map((fileName) => readFileSync(join(repositoryDirectory, '.agent-progress', fileName), 'utf8'));
}

async function expectRefusedWithoutAWrite(commandLineArguments: readonly string[], refusedOptionText: string, writtenOffset = OUT_OF_RANGE_OFFSET): Promise<void> {
  const contentsBefore = trackerFileContents();
  const { exitCode, errorText } = await exitCodeAndErrorOf(commandLineArguments);
  expect(exitCode).toBe(1);
  expect(errorText).toContain(`${refusedOptionText} "${writtenOffset}"`);
  expect(errorText).not.toContain('NaN');
  expect(trackerFileContents()).toEqual(contentsBefore);
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('out-of-range-offset');
  const { exitCode, errorText } = await exitCodeAndErrorOf(['init', '--project', 'Example Agency']);
  expect(exitCode, errorText).toBe(0);
  await exitCodeAndErrorOf(['log', 'Tracker ready']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('an offset past every writable date', () => {
  test('log --at refuses it and writes nothing', async () => {
    await expectRefusedWithoutAWrite(['log', 'Example note', '--at', OUT_OF_RANGE_OFFSET], '--at');
  });

  test('task add --start --at refuses it and writes nothing', async () => {
    await expectRefusedWithoutAWrite(['task', 'add', 'Example task', '--start', '--at', OUT_OF_RANGE_OFFSET], '--at');
  });

  test('usage --since refuses it', async () => {
    await expectRefusedWithoutAWrite(['usage', '--since', OUT_OF_RANGE_OFFSET], '--since');
  });

  test('range refuses it as either bound and writes nothing', async () => {
    await expectRefusedWithoutAWrite(['range', '--from', '-2h', '--to', OUT_OF_RANGE_OFFSET], '--to');
    await expectRefusedWithoutAWrite(['range', '--from', OUT_OF_RANGE_PAST_OFFSET, '--to', 'now'], '--from', OUT_OF_RANGE_PAST_OFFSET);
  });

  test('a reachable offset is still stored as before', async () => {
    const logged = await exitCodeAndErrorOf(['log', 'Example note', '--at', '-5m']);
    expect(logged.exitCode, logged.errorText).toBe(0);
    const ranged = await exitCodeAndErrorOf(['range', '--from', '-2h', '--to', '+30m']);
    expect(ranged.exitCode, ranged.errorText).toBe(0);
    const [progressText = '', logText = ''] = trackerFileContents();
    expect(JSON.parse(progressText).view).toEqual({
      kind:        'relative',
      from:        '-2h',
      to:          '+30m',
      tickMinutes: null,
    });
    expect(logText).toContain('"at":"');
    expect(logText).not.toContain('NaN');
  });
});

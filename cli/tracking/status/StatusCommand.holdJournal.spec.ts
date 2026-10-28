/**
 * `status` beside a hold journal. It takes no lock, so it never replays one: a malformed journal is a verdict reported on standard error
 * while both documents still answer, and a readable one leaves every file as it stands.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                    from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';
import { PRODUCT_NAMES }                      from '../../../src/shared/constants/ProductNames.ts';
import { removeScratchDirectory }             from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../../Main.ts';
import { createCapturedCommandContext }       from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

let repositoryDirectory = '';

const dataFilePath = (fileName: string): string => join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, fileName);

async function statusJson(): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(['status', '--json'], context);
  expect(exitCode, context.errorText()).toBe(0);
  return context;
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('status-hold-journal', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('status beside a hold journal', () => {
  test('a malformed one is reported on standard error, never thrown, and stays where it is', async () => {
    writeFileSync(dataFilePath('hold-journal.json'), '{"version":1,"files":[{"path":"../outside.txt","contents":"x"}]}\n');

    const context = await statusJson();

    expect(context.errorText()).toMatch(/^Hold journal unreadable: \S+\/hold-journal\.json: files\[0\]\.path is not a path inside the data folder\./);
    expect(JSON.parse(context.outputText())).toHaveProperty('concurrency');
    expect(readFileSync(dataFilePath('hold-journal.json'), 'utf8')).toContain('outside.txt');
  });

  test('a readable one is not replayed: the files are read as they stand', async () => {
    const progressBefore = readFileSync(dataFilePath('progress.json'), 'utf8');
    writeFileSync(dataFilePath('hold-journal.json'), `${JSON.stringify({ version: 1, files: [{ path: 'progress.json', contents: '{}\n' }] })}\n`);

    const context = await statusJson();

    expect(context.errorText()).not.toContain('Hold journal');
    expect(readFileSync(dataFilePath('progress.json'), 'utf8')).toBe(progressBefore);
    expect(existsSync(dataFilePath('hold-journal.json'))).toBe(true);
  });
});

/**
 * The update command's seam to the older-files rewrite, seen from the current side: on a tracker already in the current format, `update` with
 * each current option leaves every tracker file byte for byte and prints the refresh lines. The heading is worded in `cli/legacy/`, so it is not
 * asserted. It imports nothing from `cli/legacy/`, so it still holds once that folder and its seam lines are dropped.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join }                                from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace';
import { runCommandLine }                                                     from '../../Main';
import { createCapturedCommandContext }                                       from '../../testing/CapturedCommandContext';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const REFRESH_LINE_PATTERNS = [
  /^ {2}CLAUDE\.md: {3}unchanged$/m,
  /^ {2}brief: {7}unchanged \(\S+\/\.agent-progress\/agent-brief\.md\)$/m,
  /^ {2}hooks: {7}\S+\/\.claude\/settings\.local\.json \(unchanged\)$/m,
  /^ {2}workflow: {4}unchanged \(\S+\/\.claude\/workflows\/agent-progress-dispatch\.js\)$/m,
  /^ {2}agent: {7}unchanged \(\S+\/\.claude\/agents\/agent-progress-worker\.md\)$/m,
  /^ {2}dashboard: {3}\S+\/\.agent-progress\/progress\.html$/m,
];

let repositoryDirectory = '';

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

/** Every file under the tracker directory but the lock's records, which every lock hold writes. */
function storedTrackerFiles(): Record<string, string> {
  const trackerDirectory = join(repositoryDirectory, '.agent-progress');
  const contents: Record<string, string> = {};
  for (const fileName of readdirSync(trackerDirectory, { recursive: true, encoding: 'utf8' })) {
    const filePath = join(trackerDirectory, fileName);
    if (fileName.startsWith('.lock') || statSync(filePath).isDirectory()) continue;
    contents[fileName] = readFileSync(filePath, 'utf8');
  }
  return contents;
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('update-command-legacy-seam');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Example importer', '--type', 'change', '--at', '2026-09-18T09:00:00+02:00']);
  await run(['task', 'add', 'Example page', '--at', '2026-09-18T09:05:00+02:00']);
  await run(['log', 'Example note', '--at', '2026-09-18T09:10:00+02:00']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('update on a tracker in the current format', () => {
  test('leaves every tracker file byte for byte and prints each refresh line', async () => {
    const filesBefore = storedTrackerFiles();

    const context = await run(['update']);

    expect(storedTrackerFiles()).toEqual(filesBefore);
    for (const refreshLinePattern of REFRESH_LINE_PATTERNS) expect(context.outputText()).toMatch(refreshLinePattern);
    expect(context.errorText()).toBe('');
  });

  test('takes every current option, each leaving its own file alone and the tracker byte for byte', async () => {
    const filesBefore = storedTrackerFiles();
    const optionsWithTheirLines: Array<[optionName: string, line: string]> = [
      ['--no-claude-md', '  CLAUDE.md:   left alone (--no-claude-md)'],
      ['--no-hooks', '  hooks:       left alone (--no-hooks)'],
      ['--no-workflow', '  workflow:    left alone (--no-workflow)'],
      ['--no-agent-definition', '  agent:       left alone (--no-agent-definition)'],
    ];

    for (const [optionName, line] of optionsWithTheirLines) {
      const context = await run(['update', optionName]);
      expect(context.outputText(), optionName).toContain(line);
    }
    const everyOption = await run(['update', ...optionsWithTheirLines.map(([optionName]) => optionName)]);
    for (const [, line] of optionsWithTheirLines) expect(everyOption.outputText()).toContain(line);
    expect(storedTrackerFiles()).toEqual(filesBefore);
  });
});

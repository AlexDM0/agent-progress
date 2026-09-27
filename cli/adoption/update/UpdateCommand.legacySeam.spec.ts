/**
 * The update command's seam to the older-files rewrite, seen from the current side: on a tracker already in the current format, `update` with
 * each current option leaves every tracker file byte for byte and prints the refresh lines. The heading is worded in `cli/legacy/`, so it is not
 * asserted. It imports nothing from `cli/legacy/`, so it still holds once that folder and its seam lines are dropped.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { workspacePathsFor }                                                  from '../../../src/services/tracker/Workspace.ts';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { storedFileContentsOf }                                               from '../../../src/testing/TrackerFileFixtures.ts';
import { runCommandLine }                                                     from '../../Main.ts';
import { createCapturedCommandContext }                                       from '../../testing/CapturedCommandContext.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const REFRESH_LINE_PATTERNS = [
  /^ {2}CLAUDE\.md: {3}unchanged$/m,
  /^ {2}brief: {7}unchanged \(\S+\/\.agent-progress\/agent-brief\.md\)$/m,
  /^ {2}hooks: {7}\S+\/\.claude\/settings\.local\.json \(unchanged\)$/m,
  /^ {2}workflow: {4}unchanged \(\S+\/\.agent-progress\/agent-progress-dispatch\.js\)$/m,
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
    const filesBefore = storedFileContentsOf(workspacePathsFor(repositoryDirectory));

    const context = await run(['update']);

    expect(storedFileContentsOf(workspacePathsFor(repositoryDirectory))).toEqual(filesBefore);
    for (const refreshLinePattern of REFRESH_LINE_PATTERNS) expect(context.outputText()).toMatch(refreshLinePattern);
    expect(context.errorText()).toBe('');
  });

  test('takes every current option, each leaving its own file alone and the tracker byte for byte', async () => {
    const filesBefore = storedFileContentsOf(workspacePathsFor(repositoryDirectory));
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
    expect(storedFileContentsOf(workspacePathsFor(repositoryDirectory))).toEqual(filesBefore);
  });
});

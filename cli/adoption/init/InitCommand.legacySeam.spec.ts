/**
 * The init command's seam to the older-files rewrite, seen from the current side: on an existing tracker already in the current format, `init`
 * with each current option leaves every tracker file byte for byte and prints the refresh lines with no tracker line. It imports nothing from
 * `cli/legacy/`, so it still holds once that folder and its seam lines are dropped.
 */
import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { workspacePathsFor }                                  from '../../../src/services/tracker/Workspace.ts';
import { createScratchGitRepository, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../../../src/testing/ToolGuard.ts';
import { storedFileContentsOf }                               from '../../../src/testing/TrackerFileFixtures.ts';
import { runCommandLine }                                     from '../../Main.ts';
import { createCapturedCommandContext }                       from '../../testing/CapturedCommandContext.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const REFRESH_LINE_PATTERNS = [
  /^agent-progress is already initialised in \S+\.$/m,
  /^ {2}CLAUDE\.md: {3}unchanged$/m,
  /^ {2}brief: {7}unchanged \(\S+\/\.agent-progress\/agent-brief\.md\)$/m,
  /^ {2}hooks: {7}\S+\/\.claude\/settings\.local\.json \(unchanged\)$/m,
  /^ {2}workflow: {4}unchanged \(\S+\/\.agent-progress\/agent-progress-dispatch\.js\)$/m,
  /^ {2}agent: {7}unchanged \(\S+\/\.claude\/agents\/agent-progress-worker\.md\)$/m,
  /^ {2}dashboard: {3}\S+\/\.agent-progress\/progress\.html$/m,
  /^ {2}`agent-progress update` is the command for this refresh; `init` only creates a tracker\.$/m,
];

let repositoryDirectory = '';

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('init-command-legacy-seam');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Example importer', '--type', 'change', '--at', '2026-09-18T09:00:00+02:00']);
  await run(['task', 'add', 'Example page', '--at', '2026-09-18T09:05:00+02:00']);
  await run(['log', 'Example note', '--at', '2026-09-18T09:10:00+02:00']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('init on an existing tracker in the current format', () => {
  test('leaves every tracker file byte for byte and prints each refresh line, with no tracker line', async () => {
    const filesBefore = storedFileContentsOf(workspacePathsFor(repositoryDirectory));

    const context = await run(['init']);

    expect(storedFileContentsOf(workspacePathsFor(repositoryDirectory))).toEqual(filesBefore);
    for (const refreshLinePattern of REFRESH_LINE_PATTERNS) expect(context.outputText()).toMatch(refreshLinePattern);
    expect(context.outputText()).not.toContain('  tracker:     ');
    expect(context.errorText()).toBe('');
  });

  test('takes every current option, each leaving its own file alone and the tracker byte for byte', async () => {
    const filesBefore = storedFileContentsOf(workspacePathsFor(repositoryDirectory));
    const optionsWithTheirLines: Array<[optionArguments: string[], line: string]> = [
      [['--project', 'Example Other'], 'agent-progress is already initialised in '],
      [['--root', repositoryDirectory], 'agent-progress is already initialised in '],
      [['--no-claude-md'], '  CLAUDE.md:   left alone (--no-claude-md)'],
      [['--no-hooks'], '  hooks:       left alone (--no-hooks)'],
      [['--no-workflow'], '  workflow:    left alone (--no-workflow)'],
      [['--no-agent-definition'], '  agent:       left alone (--no-agent-definition)'],
    ];

    for (const [optionArguments, line] of optionsWithTheirLines) {
      const context = await run(['init', ...optionArguments]);
      expect(context.outputText(), optionArguments.join(' ')).toContain(line);
      expect(context.outputText(), optionArguments.join(' ')).not.toContain('  tracker:     ');
    }
    expect(storedFileContentsOf(workspacePathsFor(repositoryDirectory))).toEqual(filesBefore);
  });
});

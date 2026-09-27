/**
 * A tracker an earlier release wrote in a format this one no longer reads is refused, never rewritten: a version 1 progress.json, and a row
 * in a retired status word, stop a command at exit 2 with the sentence telling the reader to run `update` with a release that still reads
 * it, and leave the file byte for byte. What `status` makes of such a tracker is its own report, so these run commands that write.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                             from 'bun:test';
import { workspacePathsFor }                                  from '../src/services/tracker/Workspace.ts';
import { LIMITS }                                             from '../src/shared/constants/Limits.ts';
import { createScratchGitRepository, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from './Main.ts';
import { createCapturedCommandContext }                       from './testing/CapturedCommandContext.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const UPDATE_SENTENCE = 'run `agent-progress update` with a release that still reads it, then use this one';

let repositoryDirectory = '';

async function run(commandLineArguments: readonly string[]): Promise<{ exitCode: number; errorText: string }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, errorText: context.errorText() };
}

function rewriteProgressFile(change: (stored: Record<string, unknown>) => Record<string, unknown>): string {
  const { progressFilePath } = workspacePathsFor(repositoryDirectory);
  const stored               = JSON.parse(readFileSync(progressFilePath, 'utf8')) as Record<string, unknown>;
  const olderText            = `${JSON.stringify(change(stored), null, LIMITS.JSON_INDENT_SPACES)}\n`;
  writeFileSync(progressFilePath, olderText);
  return olderText;
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('older-tracker-refusal');
  expect((await run(['init', '--project', 'Example Agency'])).exitCode).toBe(0);
  expect((await run(['task', 'add', 'Example page', '--at', '2026-09-18T09:05:00+02:00'])).exitCode).toBe(0);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('a tracker in a format an earlier release wrote', () => {
  test('a version 1 progress.json with its own log is refused at exit 2 with the update sentence, and left as it was', async () => {
    const olderText = rewriteProgressFile((stored) => ({ ...stored, version: 1, log: [{ at: '2026-09-18T09:00:00+02:00', text: 'Example note' }] }));

    const refused = await run(['log', 'Example note after the upgrade']);

    expect(refused.exitCode).toBe(2);
    expect(refused.errorText).toContain('version is 1, and this build of agent-progress reads version 2');
    expect(refused.errorText).toContain(UPDATE_SENTENCE);
    expect(readFileSync(workspacePathsFor(repositoryDirectory).progressFilePath, 'utf8')).toBe(olderText);
  });

  test('a row in a retired status word is refused at exit 2 with the update sentence', async () => {
    rewriteProgressFile((stored) => ({
      ...stored,
      tasks: (stored['tasks'] as Record<string, unknown>[]).map((task) => ({ ...task, status: 'running' })),
    }));

    const refused = await run(['task', 'start', '1']);

    expect(refused.exitCode).toBe(2);
    expect(refused.errorText).toContain('tasks[0].status is "running"');
    expect(refused.errorText).toContain(UPDATE_SENTENCE);
  });
});

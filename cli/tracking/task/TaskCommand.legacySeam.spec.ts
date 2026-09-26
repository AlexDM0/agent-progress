/**
 * The task command's seams to the retired verbs and status words, seen from the current side: every current verb reaches its own handler and
 * every current status is taken by `task update --status`, so none is ever answered as a retired word. It imports nothing from `cli/legacy/`,
 * so it still holds once that folder and its seam lines are dropped.
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
import type { ProgressFile }                                                  from '../../../src/lib/tracker-model/@types/ProgressFile';
import { TASK_STATUSES }                                                      from '../../../src/lib/tracker-model/constants/Statuses';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace';
import { runCommandLine }                                                     from '../../Main';
import { createCapturedCommandContext }                                       from '../../testing/CapturedCommandContext';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const RETIRED_WORD_ANSWER_PATTERN = /was renamed|old name/;

let repositoryDirectory = '';

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  expect(context.errorText(), commandLineArguments.join(' ')).not.toMatch(RETIRED_WORD_ANSWER_PATTERN);
  return context;
}

function storedProgress(): ProgressFile {
  return JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as ProgressFile;
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('task-command-legacy-seam');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the task command with current words only', () => {
  test('every current verb reaches its own handler, which says what it did', async () => {
    const verbsWithTheirAnswers: Array<[commandLineArguments: string[], answer: string]> = [
      [['task', 'add', 'Review pass'], 'Task #1 added: Review pass'],
      [['task', 'start', '1'], 'Task #1 started: Review pass'],
      [['task', 'pause', '1'], 'Task #1 paused: Review pass'],
      [['task', 'start', '1'], 'Task #1 started: Review pass'],
      [['task', 'finish', '1'], 'Task #1 in review: Review pass'],
      [['task', 'rereview', '1'], 'Task #1 under review again: Review pass'],
      [['task', 'approve', '1'], 'Task #1 reviewed: Review pass'],
      [['task', 'deliver', '1'], 'Task #1 delivered: Review pass'],
      [['task', 'update', '1', '--name', 'Review pass, again'], 'Task #1 updated: Review pass, again'],
      [['task', 'remove', '1'], 'Task #1 removed: Review pass, again'],
    ];

    for (const [commandLineArguments, answer] of verbsWithTheirAnswers) {
      const context = await run(commandLineArguments);
      expect(context.outputText(), commandLineArguments.join(' ')).toContain(answer);
    }
  });

  test('every current status is taken by task update --status and stored as written', async () => {
    await run(['task', 'add', 'Review pass']);

    for (const status of TASK_STATUSES) {
      await run(['task', 'update', '1', '--status', status, '--force']);
      expect(storedProgress().tasks[0]?.status, status).toBe(status);
    }
  });
});

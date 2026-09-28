/**
 * The task command's vocabulary: every current verb reaches its own handler and every current status is taken by `task update --status`;
 * a row filed without `--review-of` is stored with no review link whatever its name, and a rename never moves or drops a stored link.
 */

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { TASK_STATUSES }                      from '../../../src/lib/tracker-model/constants/Statuses.ts';
import { removeScratchDirectory }             from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../../Main.ts';
import { createCapturedCommandContext }       from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';
import { storedProgressOf }                   from '../../testing/StoredProgress.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

let repositoryDirectory = '';

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('task-command-vocabulary', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the task command with current words only', () => {
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

  test('a plain name, a review-shaped name, and one filed with --ticket, are all stored with no review link', async () => {
    await run(['ticket', 'add', 'Example work']);
    await run(['task', 'add', 'Draft the example page']);
    await run(['task', 'add', 'Review 2 #001 — Example work']);
    await run(['task', 'add', 'Review 1 #1 — Example work', '--ticket', '1', '--force']);

    for (const task of storedProgressOf(repositoryDirectory).tasks) {
      expect(task, task.name).not.toHaveProperty('reviewOf');
      expect(task, task.name).not.toHaveProperty('reviewBarRound');
    }
  });

  test('a rename never moves or drops a stored review link, whatever the new name', async () => {
    await run(['ticket', 'add', 'Example work']);
    await run(['ticket', 'add', 'Other work']);
    await run(['task', 'add', 'Review 1 #001', '--review-of', '1']);
    const reviewRowId = storedProgressOf(repositoryDirectory).tasks.find((task) => task.name === 'Review 1 #001')?.id;

    for (const newName of ['A plain name', 'Review 1 #002']) {
      await run(['task', 'update', String(reviewRowId), '--name', newName]);
      expect(storedProgressOf(repositoryDirectory).tasks.find((task) => task.id === reviewRowId), newName).toMatchObject({ reviewOf: '001', reviewBarRound: 1 });
    }
  });

  test('every current status is taken by task update --status and stored as written', async () => {
    await run(['task', 'add', 'Review pass']);

    for (const status of TASK_STATUSES) {
      await run(['task', 'update', '1', '--status', status, '--force']);
      expect(storedProgressOf(repositoryDirectory).tasks[0]?.status, status).toBe(status);
    }
  });
});

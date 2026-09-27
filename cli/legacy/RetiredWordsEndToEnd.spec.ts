/**
 * The verbs and status words the rename retired, typed at the `ticket` and `task` commands: each is refused at exit 1 naming the word that
 * replaced it, and nothing is written.
 * It answers the older habit `cli/legacy/` exists for, and is deleted with that folder.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { createScratchGitRepository, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../Main.ts';
import { createCapturedCommandContext }                       from '../testing/CapturedCommandContext.ts';
import { storedLogTextOf }                                    from '../testing/StoredLogText.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const FIRST_TICKET_FILE_NAME = '001-double-click-a-role-to-edit-it.md';

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

function storedTicketText(fileName = FIRST_TICKET_FILE_NAME): string {
  return readFileSync(join(repositoryDirectory, '.agent-progress', 'tickets', fileName), 'utf8');
}

function progressFileText(): string {
  return readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8');
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('retired-words');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the retired ticket verbs and status words', () => {
  function trackerFilesText(): string {
    return `${progressFileText()}\n${storedTicketText()}`;
  }

  async function refusalOf(commandLineArguments: readonly string[]): Promise<string> {
    const trackerBefore = trackerFilesText();
    const context       = contextHere();
    const exitCode      = await runCommandLine(commandLineArguments, context);

    expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` exits 1`).toBe(1);
    expect(trackerFilesText(), 'a refused retired word writes nothing').toBe(trackerBefore);
    return context.errorText();
  }

  beforeEach(async () => {
    await run(['ticket', 'add', 'Double-click a role to edit it']);
    await run(['ticket', 'start', '1']);
  });

  // A builder still briefed with the old verb must be told the new one, including that its --start-review still works there.
  test('ticket review is refused naming ticket finish, with or without --start-review', async () => {
    expect(await refusalOf(['ticket', 'review', '1'])).toContain('agent-progress ticket finish 1');

    const withTheReviewBar = await refusalOf(['ticket', 'review', '1', '--start-review']);
    expect(withTheReviewBar).toContain('agent-progress ticket finish 1');
    expect(withTheReviewBar).toContain('--start-review');
  });

  // `done` was a verb and a status at once; the verb that moves to reviewed is now `approve`.
  test('ticket done is refused naming ticket approve', async () => {
    expect(await refusalOf(['ticket', 'done', '1'])).toContain('agent-progress ticket approve 1');
  });

  // An old status word given as a value is named with its replacement, never taken as a typo of some other status.
  test('ticket status with open or done is refused naming pending or reviewed', async () => {
    expect(await refusalOf(['ticket', 'status', '1', 'open'])).toContain('"open" is the old name of the ticket status pending');
    expect(await refusalOf(['ticket', 'status', '1', 'done'])).toContain('"done" is the old name of the ticket status reviewed');
  });

  test('ticket list --status done is refused naming reviewed', async () => {
    const refusal = await refusalOf(['ticket', 'list', '--status', 'done']);
    expect(refusal).toContain('"done" is the old name of the ticket status reviewed');
    expect(refusal).toContain('--status reviewed');
  });
});

describeWhenGitIsPresent('the retired task verb and status words', () => {
  // A caller still on the old verb must learn the new one, not be told `review` is unknown, and must move nothing.
  test('task review is refused at exit 1 naming task approve, and the progress file stays byte-identical', async () => {
    await run(['task', 'add', 'Review pass', '--start']);
    const progressBefore = progressFileText();
    const logBefore      = storedLogTextOf(repositoryDirectory);

    const context  = contextHere();
    const exitCode = await runCommandLine(['task', 'review', '1'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('agent-progress task approve 1');
    expect(progressFileText()).toBe(progressBefore);
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });

  // `running` is still a word agents type from habit, so the refusal says which word replaced it.
  test('task update --status running is refused at exit 1 naming in-progress, and nothing is written', async () => {
    await run(['task', 'add', 'Review pass']);
    const progressBefore = progressFileText();
    const logBefore      = storedLogTextOf(repositoryDirectory);

    const context  = contextHere();
    const exitCode = await runCommandLine(['task', 'update', '1', '--status', 'running'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('"running" is the old name of the task status in-progress');
    expect(context.errorText()).toContain('--status in-progress');
    expect(progressFileText()).toBe(progressBefore);
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });
});

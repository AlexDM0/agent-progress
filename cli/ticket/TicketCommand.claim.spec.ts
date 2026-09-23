/**
 * `ticket claim`, the one start that refuses: every refusal must leave both files byte-identical, because an agent that was refused
 * goes on to do nothing, and a half-written claim would hold a slot nobody works in. The race is the case the verb exists for.
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

const FIRST_TICKET_FILE_NAME = '001-double-click-a-role-to-edit-it.md';

let repositoryDirectory = '';

async function runWithExitCode(commandLineArguments: readonly string[]): Promise<{ exitCode: number; context: ReturnType<typeof createCapturedCommandContext> }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, context };
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const { context, exitCode } = await runWithExitCode(commandLineArguments);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

function progressText(): string {
  return readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8');
}

function storedProgress(): ProgressFile {
  return JSON.parse(progressText()) as ProgressFile;
}

function ticketText(fileName = FIRST_TICKET_FILE_NAME): string {
  return readFileSync(join(repositoryDirectory, '.agent-progress', 'tickets', fileName), 'utf8');
}

async function expectRefusedWithNothingWritten(commandLineArguments: readonly string[]): Promise<string> {
  const progressBefore = progressText();
  const ticketBefore   = ticketText();

  const { context, exitCode } = await runWithExitCode(commandLineArguments);

  expect(exitCode).toBe(1);
  expect(progressText()).toBe(progressBefore);
  expect(ticketText()).toBe(ticketBefore);
  return context.errorText();
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('ticket-claim');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Double-click a role to edit it']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('claiming a ticket', () => {
  test('a ready open ticket with a slot free is started, its row running with the owner and note, and one line logged', async () => {
    await run(['task', 'add', 'Review pass', '--start']);
    const logLengthBefore = storedProgress().log.length;

    await run(['ticket', 'claim', '1', '--owner', 'Alex Example', '--note', 'role editor']);

    const progress = storedProgress();
    const row      = progress.tasks.find((task) => task.ticket === '001');
    expect(ticketText()).toContain('status: "in-progress"');
    expect(row?.status).toBe('running');
    expect(row?.owner).toBe('Alex Example');
    expect(row?.note).toBe('role editor');
    expect(progress.log.length).toBe(logLengthBefore + 1);
    expect(progress.log.at(-1)?.text).toBe('Ticket #001 started');
  });

  // A review bar has no ticket, and it is an agent at work all the same: leaving it out is how a board ends up with four agents on two slots.
  test('a running free-standing row counts toward the limit, and the refusal names the limit and the count', async () => {
    await run(['task', 'add', 'Review pass one', '--start']);
    await run(['task', 'add', 'Review pass two', '--start']);

    const message = await expectRefusedWithNothingWritten(['ticket', 'claim', '1']);

    expect(message).toContain('2 rows are running');
    expect(message).toContain('the concurrency limit is 2');
  });

  test('a ticket waiting on one that is not done yet is refused with nothing written', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'depends', '1', '2']);

    const message = await expectRefusedWithNothingWritten(['ticket', 'claim', '1']);

    expect(message).toContain('waiting on #002');
  });

  test('a ticket already in progress is refused with nothing written', async () => {
    await run(['ticket', 'start', '1']);

    const message = await expectRefusedWithNothingWritten(['ticket', 'claim', '1']);

    expect(message).toContain('is in-progress');
  });

  // The whole point of one lock hold: two agents dispatched together must not both get the last slot.
  test('of two claims racing for the one remaining slot, exactly one succeeds', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['task', 'add', 'Review pass', '--start']);

    const outcomes = await Promise.all([
      runWithExitCode(['ticket', 'claim', '1', '--owner', 'first agent']),
      runWithExitCode(['ticket', 'claim', '2', '--owner', 'second agent']),
    ]);

    expect(outcomes.map((outcome) => outcome.exitCode).sort()).toEqual([0, 1]);
    expect(storedProgress().tasks.filter((task) => task.status === 'running')).toHaveLength(2);
  });
});

/**
 * The check command the tracker holds for `release`: a tracker that never set one reads none and keeps its file byte-identical, a stored
 * one is what a later command reads, clearing it removes the key, and every refusal leaves the progress file and the log as they were.
 */
import { existsSync, readFileSync } from 'node:fs';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
import { workspacePathsFor }                  from '../../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }                      from '../../../src/shared/constants/ProductNames.ts';
import { removeScratchDirectory }             from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../../Main.ts';
import { createCapturedCommandContext }       from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';
import { fileReadyTicket }                    from '../../testing/ReadyTicketFiling.ts';
import { storedLogEntriesOf }                 from '../../testing/StoredLogEntries.ts';
import { storedLogTextOf }                    from '../../testing/StoredLogText.ts';
import { storedProgressOf }                   from '../../testing/StoredProgress.ts';

const FROZEN_NOW = new Date('2026-10-06T09:00:00Z');

/** Every line set here is tried in the scratch repository first, so it has to pass there. */
const EXAMPLE_CHECK_COMMAND = `test -d ${PRODUCT_NAMES.DATA_FOLDER} && echo "example checks passed"`;

let repositoryDirectory = '';

function progressFilePath(): string {
  return workspacePathsFor(repositoryDirectory).progressFilePath;
}

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

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('checks-command', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the check command', () => {
  test('a fresh tracker reads none, says how to set one, and the read leaves the file byte-identical', async () => {
    const before = readFileSync(progressFilePath(), 'utf8');

    expect((await run(['checks'])).outputText()).toContain('No check command is set');
    expect(JSON.parse((await run(['checks', '--json'])).outputText())).toEqual({ checkCommand: null });
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
  });

  test('a stored command is what a later command reads, verbatim, and setting it logs one line naming it', async () => {
    const setting = JSON.parse((await run(['checks', EXAMPLE_CHECK_COMMAND, '--json'])).outputText()) as unknown;

    expect(setting).toEqual({ checkCommand: EXAMPLE_CHECK_COMMAND, previousCheckCommand: null, restampedTicketIds: [] });
    expect((await run(['checks'])).outputText()).toBe(EXAMPLE_CHECK_COMMAND);
    expect(storedProgressOf(repositoryDirectory).checkCommand).toBe(EXAMPLE_CHECK_COMMAND);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toBe(`Check command set to ${EXAMPLE_CHECK_COMMAND}`);
  });

  test('a second command replaces the first, and the change names the one it replaced', async () => {
    await run(['checks', 'true']);

    const replacing = await run(['checks', EXAMPLE_CHECK_COMMAND]);

    expect(replacing.outputText()).toBe(`Check command set to ${EXAMPLE_CHECK_COMMAND} (was true).`);
    expect(storedProgressOf(repositoryDirectory).checkCommand).toBe(EXAMPLE_CHECK_COMMAND);
  });

  // A cleared setting has to read exactly like one never set, or a release would still look for a command.
  test('--clear removes the key from the progress file and logs one line', async () => {
    await run(['checks', EXAMPLE_CHECK_COMMAND]);

    const clearing = JSON.parse((await run(['checks', '--clear', '--json'])).outputText()) as unknown;

    expect(clearing).toEqual({ checkCommand: null, previousCheckCommand: EXAMPLE_CHECK_COMMAND, restampedTicketIds: [] });
    expect(Object.hasOwn(storedProgressOf(repositoryDirectory), 'checkCommand')).toBe(false);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toBe('Check command cleared');
  });

  test.each([
    ['a blank command', ['checks', '  ']],
    ['a command beside --clear', ['checks', EXAMPLE_CHECK_COMMAND, '--clear']],
    ['--clear with none stored', ['checks', '--clear']],
    ['a command given as two arguments', ['checks', 'bun', 'test']],
    ['an option it does not know', ['checks', EXAMPLE_CHECK_COMMAND, '--worktree', '.']],
    ['--restamp with neither a command nor --clear', ['checks', '--restamp']],
  ])('%s is refused at exit 1, and the progress file and the log are left byte-identical', async (_case, commandLineArguments) => {
    const before    = readFileSync(progressFilePath(), 'utf8');
    const logBefore = storedLogTextOf(repositoryDirectory);

    const { exitCode } = await runWithExitCode(commandLineArguments);

    expect(exitCode).toBe(1);
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });

  test('--clear with none stored says so and ends with the usage line, as every other refusal of the command does', async () => {
    const { exitCode, context } = await runWithExitCode(['checks', '--clear']);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('No check command is set, so there is none to clear.\n  Usage: ');
  });
});

describeWhenGitIsPresent('a line tried in the main checkout before it is stored', () => {
  // A typo stored would fail every release until someone noticed; refusing it here is the one place it costs nothing.
  test.each([
    ['a typo', 'cd bun rin tests', 'exited 1'],
    ['a failing line', 'for i in $(seq 1 30); do echo "check line $i"; done; exit 3', 'check line 30'],
  ])('%s is refused at exit 1 with its output tail, and nothing is stored or logged', async (_case, checkCommand, named) => {
    await run(['checks', 'true']);
    const before    = readFileSync(progressFilePath(), 'utf8');
    const logBefore = storedLogTextOf(repositoryDirectory);

    const { exitCode, context } = await runWithExitCode(['checks', checkCommand]);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain(named);
    expect(context.errorText()).not.toContain('check line 10\n');
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
    expect(JSON.parse((await run(['checks', '--json'])).outputText())).toEqual({ checkCommand: 'true' });
  });
});

describeWhenGitIsPresent('changing the line with tickets in flight', () => {
  async function ticketsInProgressAndInReview(): Promise<string[]> {
    const ticketIds: string[] = [];
    for (const title of ['Example checkout page', 'Example cart']) {
      const added = JSON.parse((await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', title, '--json'])).outputText()) as { id: string };
      await run(['ticket', 'start', added.id]);
      ticketIds.push(added.id);
    }
    await run(['ticket', 'finish', ticketIds[1] ?? '']);
    return ticketIds;
  }

  function stampsOf(ticketIds: readonly string[]): (string | undefined)[] {
    return ticketIds.map((ticketId) => storedProgressOf(repositoryDirectory).tasks.find((task) => task.ticket === ticketId)?.checkCommand);
  }

  test('a start stamps the stored line on the row', async () => {
    await run(['checks', 'true']);
    const ticketIds = await ticketsInProgressAndInReview();
    expect(stampsOf(ticketIds)).toEqual(['true', 'true']);
  });

  test.each([
    ['setting a new line', ['checks', EXAMPLE_CHECK_COMMAND]],
    ['clearing it', ['checks', '--clear']],
  ])('%s is refused at exit 1 without --restamp, naming the tickets, and writes nothing', async (_case, commandLineArguments) => {
    await run(['checks', 'true']);
    await ticketsInProgressAndInReview();
    const before    = readFileSync(progressFilePath(), 'utf8');
    const logBefore = storedLogTextOf(repositoryDirectory);

    const { exitCode, context } = await runWithExitCode(commandLineArguments);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('--restamp');
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(before);
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });

  // A full suite tried first would cost minutes only to be refused under the lock.
  test('a new line without --restamp is refused before it is tried, naming the tickets as the lock\'s refusal does', async () => {
    await run(['checks', 'true']);
    const ticketIds  = await ticketsInProgressAndInReview();
    const markerPath = `${repositoryDirectory}/example-check-ran`;

    const { exitCode, context } = await runWithExitCode(['checks', `touch ${markerPath}`]);

    expect(exitCode).toBe(1);
    expect(existsSync(markerPath)).toBe(false);
    expect(context.errorText()).not.toContain('Trying the check command');
    for (const ticketId of ticketIds) expect(context.errorText()).toContain(`#${ticketId}`);
    expect(context.errorText()).toContain('--restamp');
  });

  test('with --restamp every in-progress and in-review row carries the new line, and the change and each restamp are logged', async () => {
    await run(['checks', 'true']);
    const ticketIds = await ticketsInProgressAndInReview();

    const restamping = JSON.parse((await run(['checks', EXAMPLE_CHECK_COMMAND, '--restamp', '--json'])).outputText()) as unknown;

    expect(restamping).toEqual({ checkCommand: EXAMPLE_CHECK_COMMAND, previousCheckCommand: 'true', restampedTicketIds: ticketIds });
    expect(stampsOf(ticketIds)).toEqual([EXAMPLE_CHECK_COMMAND, EXAMPLE_CHECK_COMMAND]);
    expect(storedLogEntriesOf(repositoryDirectory).slice(-3).map((entry) => entry.text)).toEqual([
      `Check command set to ${EXAMPLE_CHECK_COMMAND}`,
      ...ticketIds.map((ticketId) => `Ticket #${ticketId} restamped with the check command ${EXAMPLE_CHECK_COMMAND}`),
    ]);
  });
});

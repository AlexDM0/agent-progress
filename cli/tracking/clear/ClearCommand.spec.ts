/**
 * Starting a new session in an existing tracker: the rows are re-seeded from each surviving ticket's own frontmatter and ids are never wound back.
 */
import { chmodSync, readFileSync, readdirSync } from 'node:fs';
import { join }                                 from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { runCommandLine }                                                     from '../../Main.ts';
import { createCapturedCommandContext }                                       from '../../testing/CapturedCommandContext.ts';
import { storedLogEntriesOf }                                                 from '../../testing/StoredLogEntries.ts';
import { storedProgressOf }                                                   from '../../testing/StoredProgress.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const TICKETS_DIRECTORY = ['.agent-progress', 'tickets'];

const READ_AND_ENTER_ONLY_MODE = 0o555;
const OWNER_FULL_ACCESS_MODE   = 0o755;

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

function ticketFileNames(): string[] {
  return readdirSync(join(repositoryDirectory, ...TICKETS_DIRECTORY)).filter((name) => name.endsWith('.md')).sort();
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('clear-command');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Double-click a role to edit it']);
  await run(['ticket', 'start', '1', '--at', '-2h']);
  await run(['ticket', 'approve', '1', '--at', '-1h']);
  await run(['task', 'add', 'Review pass', '--start']);
  await run(['log', 'Halfway through the role editor']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('clearing while keeping the tickets', () => {
  test('re-seeds a bar per surviving ticket from the frontmatter it recorded', async () => {
    const trackerIdBefore = storedProgressOf(repositoryDirectory).trackerId;

    const context = await run(['clear', '--yes']);

    const progress = storedProgressOf(repositoryDirectory);
    expect(progress.tasks).toHaveLength(1);
    const [seeded] = progress.tasks;
    expect(seeded).toMatchObject({ id: 3, status: 'reviewed', ticket: '001' });
    expect(Date.parse(seeded?.start ?? '')).toBe(FROZEN_NOW.getTime() - 2 * 60 * 60 * 1000);
    expect(Date.parse(seeded?.end ?? '')).toBe(FROZEN_NOW.getTime() - 60 * 60 * 1000);

    expect(readFileSync(join(repositoryDirectory, ...TICKETS_DIRECTORY, ticketFileNames()[0] ?? ''), 'utf8')).toContain('task: 3');

    expect(progress.trackerId).toBe(trackerIdBefore);
    expect(progress.project).toBe('Example Agency');
    expect(progress.view).toEqual({ kind: 'auto' });
    expect(context.outputText()).toContain('re-seeded');
  });

  /**
   * A re-seeded row did not live through the phases the ticket records, and a list derived from the ticket's stamps
   * would be indistinguishable from one the tool watched — so the row comes back knowing only the state it came back in.
   */
  test('a re-seeded row carries the one phase it was re-seeded into, not a history read off the ticket', async () => {
    expect(storedProgressOf(repositoryDirectory).tasks[0]?.history?.map((phase) => phase.status), 'the row before the clear').toEqual(['pending', 'in-progress', 'reviewed']);

    await run(['clear', '--yes']);

    const [seeded] = storedProgressOf(repositoryDirectory).tasks;
    expect(seeded?.history).toEqual([{ status: 'reviewed', at: seeded?.end ?? '' }]);
  });

  test('the log restarts with one line saying why it is empty', async () => {
    await run(['clear', '--yes']);

    expect(storedLogEntriesOf(repositoryDirectory).map((entry) => entry.text)).toEqual(['Tracker cleared']);
  });
});

describe.skipIf(!gitIsAvailable())('clearing everything', () => {
  test('--all deletes the tickets and lets their ids restart at 001', async () => {
    await run(['clear', '--all', '--yes']);

    expect(ticketFileNames()).toEqual([]);
    expect(storedProgressOf(repositoryDirectory).tasks).toEqual([]);

    await run(['ticket', 'add', 'Fix the axis', '--type', 'bug']);
    expect(ticketFileNames()).toEqual(['001-fix-the-axis.md']);
  });

  /** The progress file is written before any ticket file changes, so a write that fails cannot leave rows naming tickets that are gone. */
  test('--all whose progress file cannot be written deletes no ticket', async () => {
    const trackerDirectory = join(repositoryDirectory, '.agent-progress');
    const progressBefore   = readFileSync(join(trackerDirectory, 'progress.json'), 'utf8');
    chmodSync(trackerDirectory, READ_AND_ENTER_ONLY_MODE);
    try {
      const context = contextHere();
      expect(await runCommandLine(['clear', '--all', '--yes'], context)).toBe(2);
    } finally {
      chmodSync(trackerDirectory, OWNER_FULL_ACCESS_MODE);
    }
    expect(ticketFileNames()).toEqual(['001-double-click-a-role-to-edit-it.md']);
    expect(readFileSync(join(trackerDirectory, 'progress.json'), 'utf8')).toBe(progressBefore);
  });

  test('--json still counts the tickets --all deleted', async () => {
    const context = await run(['clear', '--all', '--yes', '--json']);
    expect(JSON.parse(context.outputText())).toMatchObject({ deletedTicketCount: 1, reseededTicketCount: 0 });
  });
});

describe.skipIf(!gitIsAvailable())('the confirmation', () => {
  /** A prompt written to a stream nobody is reading is a hang in a subprocess an agent is waiting on. */
  test('a non-terminal standard input without --yes refuses and changes nothing', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['clear'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('--yes');
    expect(storedProgressOf(repositoryDirectory).tasks).toHaveLength(2);
  });

  test('on a terminal it asks, and a no leaves the tracker exactly as it was, at exit 0', async () => {
    const context = createCapturedCommandContext({
      currentDirectory:        repositoryDirectory,
      now:                     () => FROZEN_NOW,
      standardInputIsTerminal: true,
      confirmAnswer:           false,
    });

    expect(await runCommandLine(['clear'], context)).toBe(0);

    expect(context.questionsAsked()).toHaveLength(1);
    expect(context.outputText()).toContain('Nothing was cleared.');
    expect(storedProgressOf(repositoryDirectory).tasks).toHaveLength(2);
  });

  test('on a terminal a yes clears, and the question names what --all would additionally delete', async () => {
    const context = createCapturedCommandContext({
      currentDirectory:        repositoryDirectory,
      now:                     () => FROZEN_NOW,
      standardInputIsTerminal: true,
      confirmAnswer:           true,
    });

    expect(await runCommandLine(['clear', '--all'], context)).toBe(0);

    expect(context.questionsAsked()[0]).toContain('every ticket');
    expect(ticketFileNames()).toEqual([]);
  });
});

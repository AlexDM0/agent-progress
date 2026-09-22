/**
 * Starting a new session in an existing tracker: the rows are re-seeded from each surviving ticket's own frontmatter and ids are never wound back.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join }                      from 'node:path';

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

const TICKETS_DIRECTORY = ['.agent-progress', 'tickets'];

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

function storedProgress(): ProgressFile {
  return JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as ProgressFile;
}

function ticketFileNames(): string[] {
  return readdirSync(join(repositoryDirectory, ...TICKETS_DIRECTORY)).filter((name) => name.endsWith('.md')).sort();
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('clear-command');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Double-click a role to edit it']);
  await run(['ticket', 'start', '1', '--at', '-2h']);
  await run(['ticket', 'done', '1', '--at', '-1h']);
  await run(['task', 'add', 'Review pass', '--start']);
  await run(['log', 'Halfway through the role editor']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('clearing while keeping the tickets', () => {
  test('re-seeds a bar per surviving ticket from the frontmatter it recorded', async () => {
    const trackerIdBefore = storedProgress().trackerId;

    const context = await run(['clear', '--yes']);

    const progress = storedProgress();
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
    expect(storedProgress().tasks[0]?.history?.map((phase) => phase.status), 'the row before the clear').toEqual(['running', 'reviewed']);

    await run(['clear', '--yes']);

    const [seeded] = storedProgress().tasks;
    expect(seeded?.history).toEqual([{ status: 'reviewed', at: seeded?.end ?? '' }]);
  });

  test('the log restarts with one line saying why it is empty', async () => {
    await run(['clear', '--yes']);

    expect(storedProgress().log.map((entry) => entry.text)).toEqual(['Tracker cleared']);
  });
});

describe.skipIf(!gitIsAvailable())('clearing everything', () => {
  test('--all deletes the tickets and lets their ids restart at 001', async () => {
    await run(['clear', '--all', '--yes']);

    expect(ticketFileNames()).toEqual([]);
    expect(storedProgress().tasks).toEqual([]);

    await run(['ticket', 'add', 'Fix the axis', '--type', 'bug']);
    expect(ticketFileNames()).toEqual(['001-fix-the-axis.md']);
  });
});

describe.skipIf(!gitIsAvailable())('the confirmation', () => {
  /** A prompt written to a stream nobody is reading is a hang in a subprocess an agent is waiting on. */
  test('a non-terminal standard input without --yes refuses and changes nothing', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['clear'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('--yes');
    expect(storedProgress().tasks).toHaveLength(2);
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
    expect(storedProgress().tasks).toHaveLength(2);
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

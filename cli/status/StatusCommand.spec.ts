/**
 * What `agent-progress status` tells its two readers. The `--json` working view leaves settled work and the old log out and counts what it
 * left out; `--full` is the whole progress file plus the tickets. Both documents are the agent's contract, and both carry the concurrency block.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import type { ProgressFile, TicketFrontmatter }                               from '../../lib/constants/Types';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

type StatusDocument = ProgressFile & {
  tickets:     Array<TicketFrontmatter & { filePath: string }>;
  omitted?:    { settledTasks: number; settledTickets: number; olderLogEntries: number };
  concurrency: {
    limit:          number;
    agentsInFlight: number;
    freeSlots:      number;
    readyTicketIds: string[];
  };
};

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

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('status-command');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Double-click a role to edit it']);
  await run(['ticket', 'start', '1']);
  await run(['task', 'add', 'Review pass', '--start', '--owner', 'Alex Example']);
  await run(['log', 'Halfway through the role editor']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the human listing', () => {
  test('hides delivered rows behind a count, and --full lists them', async () => {
    await run(['task', 'deliver', '2']);

    const trimmed = (await run(['status'])).outputText();
    const full    = (await run(['status', '--full'])).outputText();

    expect(trimmed).not.toContain('Review pass');
    expect(trimmed).toContain('1 delivered or abandoned rows not shown');
    expect(full).toContain('Review pass');
    expect(full).not.toContain('not shown');
  });

  test('names the project, counts both ladders, lists every row and ends with the log', async () => {
    const context = await run(['status']);
    const printed = context.outputText();

    expect(printed).toContain('Example Agency');
    expect(printed).toContain('2 running');
    expect(printed).toContain('1 in-progress');
    expect(printed).toContain('#001 Double-click a role to edit it');
    expect(printed).toContain('Review pass');
    expect(printed).toContain('Alex Example');
    expect(printed).toContain('Halfway through the role editor');
  });
});

describe.skipIf(!gitIsAvailable())('the --json --full document', () => {
  test('is the progress file itself, so an agent could write the document it read back', async () => {
    const context  = await run(['status', '--json', '--full']);
    const document = JSON.parse(context.outputText()) as StatusDocument;

    expect(document.version).toBe(1);
    expect(document.trackerId.length).toBeGreaterThan(0);
    expect(document.nextTaskId).toBe(3);
  });

  test('carries the project, the view, every row, every ticket\'s frontmatter and the log', async () => {
    const context  = await run(['status', '--json', '--full']);
    const document = JSON.parse(context.outputText()) as StatusDocument;

    expect(document.project).toBe('Example Agency');
    expect(document.view).toEqual({ kind: 'auto' });
    expect(document.startedAt.length).toBeGreaterThan(0);

    expect(document.tasks.map((task) => task.name)).toEqual(['#001 Double-click a role to edit it', 'Review pass']);
    expect(document.tasks[1]).toMatchObject({ status: 'running', owner: 'Alex Example', ticket: null });

    expect(document.tickets).toHaveLength(1);
    expect(document.tickets[0]).toMatchObject({ id: '001', status: 'in-progress', task: 1 });
    expect(document.tickets[0]?.filePath).toContain('001-double-click-a-role-to-edit-it.md');

    expect(document.log.map((entry) => entry.text)).toContain('Halfway through the role editor');
    expect(document.omitted).toBeUndefined();
  });

  test('keeps delivered work and the whole log', async () => {
    await run(['task', 'deliver', '2']);
    for (let i = 0; i < 12; i++) await run(['log', `Milestone ${i}`]);

    const document = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;

    expect(document.tasks).toHaveLength(2);
    expect(document.log.length).toBeGreaterThan(12);
  });
});

describe.skipIf(!gitIsAvailable())('the --json working view', () => {
  // The document an agent reads at every session start; it has to stay small however long the project runs.
  test('leaves delivered and abandoned rows and tickets out, and counts them', async () => {
    await run(['ticket', 'add', 'Rename the export button']);
    await run(['ticket', 'abandon', '2', '--reason', 'Out of scope']);
    await run(['task', 'deliver', '2']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.tasks.map((task) => task.name)).toEqual(['#001 Double-click a role to edit it']);
    expect(document.tickets.map((ticket) => ticket.id)).toEqual(['001']);
    expect(document.omitted).toEqual({ settledTasks: 2, settledTickets: 1, olderLogEntries: 0 });
  });

  test('keeps finished and reviewed rows, which still wait on the orchestrator', async () => {
    await run(['task', 'finish', '2']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.tasks[1]).toMatchObject({ name: 'Review pass', status: 'finished' });
  });

  test('carries the last 10 log entries newest first by their stamp, and counts the older ones', async () => {
    for (let i = 0; i < 12; i++) await run(['log', `Milestone ${i}`, '--at', `-${12 - i}m`]);
    await run(['log', 'Backfilled from a day ago', '--at', '-1d']);

    const document     = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    const fullDocument = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;
    const logTexts     = document.log.map((entry) => entry.text);

    expect(logTexts).toHaveLength(10);
    expect(logTexts[0]).toBe('Halfway through the role editor');
    expect(logTexts).not.toContain('Backfilled from a day ago');
    expect(document.omitted?.olderLogEntries).toBe(fullDocument.log.length - 10);
  });

  test('still carries the header fields an agent keys on', async () => {
    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.project).toBe('Example Agency');
    expect(document.nextTaskId).toBe(3);
    expect(document.trackerId.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!gitIsAvailable())('when a ticket file will not parse', () => {
  test('it is reported on standard error and both forms still answer', async () => {
    writeFileSync(join(repositoryDirectory, '.agent-progress', 'tickets', '004-broken.md'), 'no frontmatter at all\n');

    const context  = await run(['status', '--json']);
    const document = JSON.parse(context.outputText()) as StatusDocument;

    expect(context.errorText()).toContain('004-broken.md');
    expect(document.tickets).toHaveLength(1);
  });
});

describe.skipIf(!gitIsAvailable())('token counts', () => {
  test('a reported row shows its count, an unreported one shows a dash, and the total names both numbers', async () => {
    await run(['task', 'finish', '2', '--tokens', '12.3k']);

    const printed = (await run(['status'])).outputText();

    expect(printed).toContain('12.3k');
    expect(printed).toContain('Tokens:  12.3k reported across 1 of 2 rows');
    expect(printed).toContain('-  ');
  });

  test('no total line at all when nothing was reported, rather than a zero', async () => {
    expect((await run(['status'])).outputText()).not.toContain('Tokens:');
  });

  test('--json carries the raw field, not the shortened text', async () => {
    await run(['task', 'finish', '2', '--tokens', '12.3k']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.tasks[1]?.tokens).toBe(12_300);
    expect(document.tasks[0]?.tokens).toBeNull();
  });
});

describe.skipIf(!gitIsAvailable())('the log listing', () => {
  test('is newest first by the stamp, not by the order entries were appended', async () => {
    await run(['log', 'Backfilled from an hour ago', '--at', '-1h']);

    const lines = (await run(['status'])).outputText().split('\n');
    const logStart = lines.findIndex((line) => line.startsWith('Log ('));
    const logLines = lines.slice(logStart + 1).filter((line) => line.startsWith('  '));

    expect(logLines[0]).toContain('Halfway through the role editor');
    expect(logLines.at(-1)).toContain('Backfilled from an hour ago');
  });

  test('a log spanning more than one calendar day carries the date on every line', async () => {
    await run(['log', 'Yesterday afternoon', '--at', '-1d']);

    const printed = (await run(['status'])).outputText();

    expect(printed).toMatch(/\n {2}\d{2}-\d{2} \d{2}:\d{2} {2}Yesterday afternoon/);
  });

  test('a log inside one day carries the clock alone', async () => {
    const printed = (await run(['status'])).outputText();

    expect(printed).toMatch(/\n {2}\d{2}:\d{2} {2}Halfway through the role editor/);
  });
});

describe.skipIf(!gitIsAvailable())('the concurrency block both --json documents carry', () => {
  // A dispatcher reads this to decide whether to start an agent and on what: the review bar counts, and a ticket waiting on unfinished work is not ready.
  test('counts every running row against the limit and lists the ready tickets lowest first', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'add', 'Export the roles', '--depends-on', '1']);
    await run(['ticket', 'add', 'Import the roles']);

    const working = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    const full    = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;

    const expected = {
      limit:          2,
      agentsInFlight: 2,
      freeSlots:      0,
      readyTicketIds: ['002', '004'],
    };
    expect(working.concurrency).toEqual(expected);
    expect(full.concurrency).toEqual(expected);
  });
});

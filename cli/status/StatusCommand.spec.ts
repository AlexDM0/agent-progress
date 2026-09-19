/**
 * What `agent-progress status` tells its two readers; the `--json` document is the whole progress file plus the tickets, and is the agent's contract.
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

type StatusDocument = ProgressFile & { tickets: Array<TicketFrontmatter & { filePath: string }> };

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

describe.skipIf(!gitIsAvailable())('the --json document', () => {
  test('is the progress file itself, so an agent could write the document it read back', async () => {
    const context  = await run(['status', '--json']);
    const document = JSON.parse(context.outputText()) as StatusDocument;

    expect(document.version).toBe(1);
    expect(document.trackerId.length).toBeGreaterThan(0);
    expect(document.nextTaskId).toBe(3);
  });

  test('carries the project, the view, every row, every ticket\'s frontmatter and the log', async () => {
    const context  = await run(['status', '--json']);
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
    const logLines = lines.slice(logStart + 1);

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

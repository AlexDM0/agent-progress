/**
 * Ticket priority as the command surface sees it. The cases that matter: a low ticket takes no row and no task id until it is started, a
 * priority change moves the row in the same write, the ready list and `claim` hold low work back while normal or high work is owed, and a
 * ticket file without the key reads as normal and is never rewritten for being read.
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

async function runExpectingRefusal(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` was expected to be refused`).toBe(1);
  return context;
}

function progressFilePath(): string {
  return join(repositoryDirectory, '.agent-progress', 'progress.json');
}

function storedProgress(): ProgressFile {
  return JSON.parse(readFileSync(progressFilePath(), 'utf8')) as ProgressFile;
}

function ticketFilePath(identifier: string): string {
  const ticketsDirectory = join(repositoryDirectory, '.agent-progress', 'tickets');
  const fileName         = readdirSync(ticketsDirectory).find((name) => name.startsWith(`${identifier}-`));
  if (fileName === undefined) throw new Error(`no ticket file for #${identifier}`);
  return join(ticketsDirectory, fileName);
}

function storedTicketText(identifier: string): string {
  return readFileSync(ticketFilePath(identifier), 'utf8');
}

async function readyTicketIds(): Promise<string[]> {
  const document = JSON.parse((await run(['status', '--json'])).outputText()) as { concurrency: { readyTicketIds: string[] } };
  return document.concurrency.readyTicketIds;
}

function logLinesAbout(identifier: string): string[] {
  return storedProgress().log.map((entry) => entry.text).filter((text) => text.startsWith(`Ticket #${identifier} priority`));
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('ticket-priority');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('filing and moving a low ticket', () => {
  // The chart is for work the user asked for; a reviewer's side finding must not take a row, or even the id the next row would get.
  test('ticket add --priority low writes low and adds no row, leaving nextTaskId unconsumed', async () => {
    const before = storedProgress();

    const context = await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);

    expect(storedTicketText('001')).toContain('priority: "low"');
    expect(storedTicketText('001')).toContain('task: null');
    expect(storedProgress().tasks).toHaveLength(before.tasks.length);
    expect(storedProgress().nextTaskId).toBe(before.nextTaskId);
    expect(context.outputText()).toContain('low priority: no row until it is started');
  });

  test('a priority that is not one of the three is refused and files nothing', async () => {
    const context = await runExpectingRefusal(['ticket', 'add', 'Reword the empty-log note', '--priority', 'urgent']);

    expect(context.errorText()).toContain('is not a ticket priority');
    expect(readdirSync(join(repositoryDirectory, '.agent-progress', 'tickets'))).toHaveLength(0);
  });

  test('ticket start on a low ticket gives it a running row, and the ticket stays low', async () => {
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);

    await run(['ticket', 'start', '1']);

    const { tasks } = storedProgress();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'running', ticket: '001' });
    expect(storedTicketText('001')).toContain('priority: "low"');
    expect(storedTicketText('001')).toContain(`task: ${tasks[0]?.id}`);
  });

  // Once started, the row is the record of work that happened, so reopening the ticket does not take it off the chart.
  test('a started low ticket keeps its row when it is reopened', async () => {
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);
    await run(['ticket', 'start', '1']);

    await run(['ticket', 'reopen', '1']);

    expect(storedProgress().tasks[0]).toMatchObject({ status: 'pending', ticket: '001' });
  });

  test('ticket abandon on a low ticket without a row exits 0 and adds no row', async () => {
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);
    const nextTaskIdBefore = storedProgress().nextTaskId;

    await run(['ticket', 'abandon', '1', '--reason', 'x']);

    expect(storedProgress().tasks).toHaveLength(0);
    expect(storedProgress().nextTaskId).toBe(nextTaskIdBefore);
    expect(storedTicketText('001')).toContain('status: "abandoned"');
    expect(storedProgress().log.at(-1)?.text).toBe('Ticket #001 abandoned: x');
  });

  test('clear re-seeds no row for a low ticket that was never started', async () => {
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);
    await run(['ticket', 'add', 'Fix the axis']);

    await run(['clear', '--yes']);

    expect(storedProgress().tasks.map((task) => task.ticket)).toEqual(['002']);
    expect(storedTicketText('001')).toContain('task: null');
  });

  // `reopen` clears the `started` stamp, so the row a started low ticket keeps is the only sign left that it was worked.
  test('clear re-seeds the row a started low ticket kept through a reopen', async () => {
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);
    await run(['ticket', 'start', '1']);
    await run(['ticket', 'reopen', '1']);

    await run(['clear', '--yes']);

    expect(storedProgress().tasks).toHaveLength(1);
    expect(storedProgress().tasks[0]).toMatchObject({ status: 'pending', ticket: '001' });
  });
});

describe.skipIf(!gitIsAvailable())('ticket priority', () => {
  test('lowering an open normal ticket removes its row, and raising it again files a new one, each with one log line', async () => {
    await run(['ticket', 'add', 'Fix the axis']);
    expect(storedProgress().tasks).toHaveLength(1);

    await run(['ticket', 'priority', '1', 'low']);
    expect(storedProgress().tasks).toHaveLength(0);
    expect(storedTicketText('001')).toContain('priority: "low"');
    expect(storedTicketText('001')).toContain('task: null');
    expect(logLinesAbout('001')).toEqual(['Ticket #001 priority normal → low']);

    await run(['ticket', 'priority', '1', 'normal']);
    const { tasks } = storedProgress();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'pending', ticket: '001' });
    expect(storedTicketText('001')).toContain(`task: ${tasks[0]?.id}`);
    expect(logLinesAbout('001')).toEqual(['Ticket #001 priority normal → low', 'Ticket #001 priority low → normal']);
  });

  test('raising an abandoned low ticket gives it an abandoned row, not a pending one', async () => {
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);
    await run(['ticket', 'abandon', '1', '--reason', 'superseded']);

    await run(['ticket', 'priority', '1', 'high']);

    expect(storedProgress().tasks[0]).toMatchObject({ status: 'abandoned', ticket: '001' });
  });

  test('normal to high changes only the priority and logs it', async () => {
    await run(['ticket', 'add', 'Fix the axis']);
    const rowsBefore = storedProgress().tasks;

    await run(['ticket', 'priority', '1', 'high']);

    expect(storedProgress().tasks).toEqual(rowsBefore);
    expect(storedTicketText('001')).toContain('priority: "high"');
    expect(logLinesAbout('001')).toEqual(['Ticket #001 priority normal → high']);
  });

  test('lowering a ticket that is not open is refused at exit 1 with both files unchanged', async () => {
    await run(['ticket', 'add', 'Fix the axis']);
    await run(['ticket', 'start', '1']);
    const progressBefore = readFileSync(progressFilePath(), 'utf8');
    const ticketBefore   = storedTicketText('001');

    const context = await runExpectingRefusal(['ticket', 'priority', '1', 'low']);

    expect(context.errorText()).toContain('only an open ticket can be lowered to low');
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(progressBefore);
    expect(storedTicketText('001')).toBe(ticketBefore);
  });

  test('setting the priority a ticket already has is refused, and an unknown priority is too', async () => {
    await run(['ticket', 'add', 'Fix the axis']);

    expect((await runExpectingRefusal(['ticket', 'priority', '1', 'normal'])).errorText()).toContain('already normal priority');
    expect((await runExpectingRefusal(['ticket', 'priority', '1', 'urgent'])).errorText()).toContain('is not a ticket priority');
  });
});

describe.skipIf(!gitIsAvailable())('readiness and claiming', () => {
  // The acceptance pair: low work waits for the normal ticket to be delivered, both in what the dispatcher is told and in what claim allows.
  test('a low ticket is neither listed nor claimable while a normal ticket is owed, and is both once it is delivered', async () => {
    await run(['ticket', 'add', 'Fix the axis']);
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);

    expect(await readyTicketIds()).toEqual(['001']);
    const refusal = await runExpectingRefusal(['ticket', 'claim', '2']);
    expect(refusal.errorText()).toContain('#001');
    expect(storedTicketText('002')).toContain('status: "open"');

    await run(['ticket', 'start', '1']);
    await run(['ticket', 'done', '1']);
    await runExpectingRefusal(['ticket', 'claim', '2']);
    await run(['ticket', 'deliver', '1']);

    expect(await readyTicketIds()).toEqual(['002']);
    await run(['ticket', 'claim', '2', '--owner', 'opus']);
    expect(storedProgress().tasks.find((task) => task.ticket === '002')).toMatchObject({ status: 'running', owner: 'opus' });
  });

  test('a high ticket filed after a normal one is listed first', async () => {
    await run(['ticket', 'add', 'Fix the axis']);
    await run(['ticket', 'add', 'Stop the page crashing', '--priority', 'high']);

    expect(await readyTicketIds()).toEqual(['002', '001']);
    expect((await run(['status'])).outputText()).toContain('ready: #002, #001');
  });

  test('ticket start on a held-back low ticket warns and still moves it', async () => {
    await run(['ticket', 'add', 'Fix the axis']);
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);

    const context = await run(['ticket', 'start', '2']);

    expect(context.errorText()).toContain('Ticket #002 is low priority, and #001 is normal or high and not delivered or abandoned yet');
    expect(storedTicketText('002')).toContain('status: "in-progress"');
  });
});

describe.skipIf(!gitIsAvailable())('reading priorities', () => {
  // Every tracker in use today was written before the key existed: reading it must neither fail nor touch the file.
  test('a ticket file with no priority key reads as normal everywhere and is not rewritten by being read', async () => {
    await run(['ticket', 'add', 'Fix the axis']);
    const ticketBefore = storedTicketText('001');
    expect(ticketBefore).not.toContain('priority');

    const shown  = JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText()) as { priority: string };
    const listed = JSON.parse((await run(['ticket', 'list', '--json'])).outputText()) as Array<{ priority: string }>;
    const status = JSON.parse((await run(['status', '--json'])).outputText()) as { tickets: Array<{ priority: string }> };

    expect(shown.priority).toBe('normal');
    expect(listed.map((ticket) => ticket.priority)).toEqual(['normal']);
    expect(status.tickets.map((ticket) => ticket.priority)).toEqual(['normal']);
    expect(storedTicketText('001')).toBe(ticketBefore);
  });

  test('list and show print the priority, and list --priority narrows to it', async () => {
    await run(['ticket', 'add', 'Fix the axis']);
    await run(['ticket', 'add', 'Reword the empty-log note', '--priority', 'low']);

    expect((await run(['ticket', 'show', '2'])).outputText()).toContain('priority: low');
    const everything = (await run(['ticket', 'list'])).outputText();
    expect(everything).toContain('priority');
    expect(everything).toMatch(/#002 +open +low /);

    const narrowed = (await run(['ticket', 'list', '--priority', 'low'])).outputText();
    expect(narrowed).toContain('#002');
    expect(narrowed).not.toContain('#001');
    expect((await run(['ticket', 'list', '--priority', 'high'])).outputText()).toBe('No tickets are high priority.');
  });
});

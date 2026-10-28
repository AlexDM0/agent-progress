/**
 * Ticket priority as the command surface sees it. The cases that matter: a low draft takes no row and no task id, a lowered ticket keeps
 * its row while raising a rowless one files it in the same write, priority only orders the ready list and never stops a claim, the
 * readiness order breaks a tie within a priority, and a ticket file without the key reads as normal and is never rewritten for being read.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join }                      from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { PRODUCT_NAMES }                                                   from '../../src/shared/constants/ProductNames.ts';
import { removeScratchDirectory }                                          from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                                        from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                                                  from '../Main.ts';
import { createCapturedCommandContext }                                    from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }                              from '../testing/InitializedScratchRepository.ts';
import { READY_TICKET_BODY_ARGUMENTS, fileReadyTicket, filedTicketFileOf } from '../testing/ReadyTicketFiling.ts';
import { dropTicketRow }                                                   from '../testing/RowlessTicket.ts';
import { storedLogEntriesOf }                                              from '../testing/StoredLogEntries.ts';
import { storedProgressOf }                                                from '../testing/StoredProgress.ts';

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
  return join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json');
}

function ticketFilePath(identifier: string): string {
  const ticketsDirectory = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'tickets');
  const fileName         = readdirSync(ticketsDirectory).find((name) => name.startsWith(`${identifier}-`));
  if (fileName === undefined) throw new Error(`no ticket file for #${identifier}`);
  return join(ticketsDirectory, fileName);
}

function storedTicketText(identifier: string): string {
  return readFileSync(ticketFilePath(identifier), 'utf8');
}

/** Every ready order this suite pins is also held against `readyTickets`, which must list the same tickets in the same order. */
async function readyTicketIds(): Promise<string[]> {
  const document = JSON.parse((await run(['status', '--json'])).outputText()) as { concurrency: { readyTicketIds: string[] }; readyTickets: Array<{ id: string }> };
  expect(document.readyTickets.map((ready) => ready.id)).toEqual(document.concurrency.readyTicketIds);
  return document.concurrency.readyTicketIds;
}

function logLinesAbout(identifier: string): string[] {
  return storedLogEntriesOf(repositoryDirectory).map((entry) => entry.text).filter((text) => text.startsWith(`Ticket #${identifier} priority`));
}

async function fileLowPendingTicketWithoutRow(title: string): Promise<void> {
  const filing = await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', title, '--priority', 'low']);
  dropTicketRow(repositoryDirectory, filedTicketFileOf(filing.outputText()));
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('ticket-priority', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('filing and moving a low ticket', () => {
  // The chart is for work the user asked for; a reviewer's side finding must not take a row, or even the id the next row would get.
  test('ticket add --priority low writes low and adds no row, leaving nextTaskId unconsumed', async () => {
    const before = storedProgressOf(repositoryDirectory);

    const context = await run(['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'low']);

    expect(storedTicketText('001')).toContain('priority: "low"');
    expect(storedTicketText('001')).toContain('task: null');
    expect(storedProgressOf(repositoryDirectory).tasks).toHaveLength(before.tasks.length);
    expect(storedProgressOf(repositoryDirectory).nextTaskId).toBe(before.nextTaskId);
    expect(context.outputText()).toContain('It is a draft ticket, with no row');
  });

  test('a priority that is not one of the three is refused and files nothing', async () => {
    const context = await runExpectingRefusal(['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'urgent']);

    expect(context.errorText()).toContain('is not a ticket priority');
    expect(readdirSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'tickets'))).toHaveLength(0);
  });

  test('ticket start on a low ticket gives it an in-progress row, and the ticket stays low', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'low']);

    await run(['ticket', 'start', '1']);

    const { tasks } = storedProgressOf(repositoryDirectory);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'in-progress', ticket: '001' });
    expect(storedTicketText('001')).toContain('priority: "low"');
    expect(storedTicketText('001')).toContain(`task: ${tasks[0]?.id}`);
  });

  // Once started, the row is the record of work that happened, so reopening the ticket does not take it off the chart.
  test('a started low ticket keeps its row when it is reopened', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'low']);
    await run(['ticket', 'start', '1']);

    await run(['ticket', 'reopen', '1']);

    expect(storedProgressOf(repositoryDirectory).tasks[0]).toMatchObject({ status: 'pending', ticket: '001' });
  });

  test('ticket abandon on a low ticket without a row exits 0 and adds no row', async () => {
    await fileLowPendingTicketWithoutRow('Reword the empty-log note');
    const nextTaskIdBefore = storedProgressOf(repositoryDirectory).nextTaskId;

    await run(['ticket', 'abandon', '1', '--reason', 'x']);

    expect(storedProgressOf(repositoryDirectory).tasks).toHaveLength(0);
    expect(storedProgressOf(repositoryDirectory).nextTaskId).toBe(nextTaskIdBefore);
    expect(storedTicketText('001')).toContain('status: "abandoned"');
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toBe('Ticket #001 abandoned: x');
  });

  test('clear re-seeds no row for a low ticket that was never started', async () => {
    await fileLowPendingTicketWithoutRow('Reword the empty-log note');
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);

    await run(['clear', '--yes']);

    expect(storedProgressOf(repositoryDirectory).tasks.map((task) => task.ticket)).toEqual(['002']);
    expect(storedTicketText('001')).toContain('task: null');
  });

  // `reopen` clears the `started` stamp, so the row a started low ticket keeps is the only sign left that it was worked.
  test('clear re-seeds the row a started low ticket kept through a reopen', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'low']);
    await run(['ticket', 'start', '1']);
    await run(['ticket', 'reopen', '1']);

    await run(['clear', '--yes']);

    expect(storedProgressOf(repositoryDirectory).tasks).toHaveLength(1);
    expect(storedProgressOf(repositoryDirectory).tasks[0]).toMatchObject({ status: 'pending', ticket: '001' });
  });
});

describeWhenGitIsPresent('ticket priority', () => {
  // Priority only orders the queue: a lowered ticket is still ready, so it keeps its row.
  test('lowering a pending normal ticket keeps its row, and raising it again keeps the same row, each with one log line', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);
    const rowsBefore = storedProgressOf(repositoryDirectory).tasks;
    expect(rowsBefore).toHaveLength(1);

    await run(['ticket', 'priority', '1', 'low']);
    expect(storedProgressOf(repositoryDirectory).tasks).toEqual(rowsBefore);
    expect(storedTicketText('001')).toContain('priority: "low"');
    expect(storedTicketText('001')).toContain(`task: ${rowsBefore[0]?.id}`);
    expect(logLinesAbout('001')).toEqual(['Ticket #001 priority normal → low']);

    await run(['ticket', 'priority', '1', 'normal']);
    expect(storedProgressOf(repositoryDirectory).tasks).toEqual(rowsBefore);
    expect(logLinesAbout('001')).toEqual(['Ticket #001 priority normal → low', 'Ticket #001 priority low → normal']);
  });

  test('raising a pending low ticket with no row files a pending row for it', async () => {
    await fileLowPendingTicketWithoutRow('Reword the empty-log note');

    await run(['ticket', 'priority', '1', 'normal']);

    const { tasks } = storedProgressOf(repositoryDirectory);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'pending', ticket: '001' });
    expect(storedTicketText('001')).toContain(`task: ${tasks[0]?.id}`);
  });

  test('raising an abandoned low ticket gives it an abandoned row, not a pending one', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'low']);
    await run(['ticket', 'abandon', '1', '--reason', 'superseded']);

    await run(['ticket', 'priority', '1', 'high']);

    expect(storedProgressOf(repositoryDirectory).tasks[0]).toMatchObject({ status: 'abandoned', ticket: '001' });
  });

  test('normal to high changes only the priority and logs it', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);
    const rowsBefore = storedProgressOf(repositoryDirectory).tasks;

    await run(['ticket', 'priority', '1', 'high']);

    expect(storedProgressOf(repositoryDirectory).tasks).toEqual(rowsBefore);
    expect(storedTicketText('001')).toContain('priority: "high"');
    expect(logLinesAbout('001')).toEqual(['Ticket #001 priority normal → high']);
  });

  test('lowering a ticket that is not pending is refused at exit 1 with both files unchanged', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);
    await run(['ticket', 'start', '1']);
    const progressBefore = readFileSync(progressFilePath(), 'utf8');
    const ticketBefore   = storedTicketText('001');

    const context = await runExpectingRefusal(['ticket', 'priority', '1', 'low']);

    expect(context.errorText()).toContain('only a draft or pending ticket can be lowered to low');
    expect(readFileSync(progressFilePath(), 'utf8')).toBe(progressBefore);
    expect(storedTicketText('001')).toBe(ticketBefore);
  });

  test('setting the priority a ticket already has is refused, and an unknown priority is too', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);

    expect((await runExpectingRefusal(['ticket', 'priority', '1', 'normal'])).errorText()).toContain('already normal priority');
    expect((await runExpectingRefusal(['ticket', 'priority', '1', 'urgent'])).errorText()).toContain('is not a ticket priority');
  });
});

describeWhenGitIsPresent('readiness and claiming', () => {
  // Ready means build: priority only orders, so a pending normal ticket holds no low one back, in the list or in a claim.
  test('a low ticket is listed after a pending normal one and claimable while it is owed', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'low']);
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);

    expect(await readyTicketIds()).toEqual(['002', '001']);
    await run(['ticket', 'claim', '1', '--owner', 'opus']);
    expect(storedProgressOf(repositoryDirectory).tasks.find((task) => task.ticket === '001')).toMatchObject({ status: 'in-progress', owner: 'opus' });
    expect(storedTicketText('002')).toContain('status: "pending"');
  });

  test('within a priority the ticket readied first is listed first, whatever its id', async () => {
    await run(['ticket', 'add', '--type', 'ticket', 'Fix the axis', ...READY_TICKET_BODY_ARGUMENTS]);
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note']);
    await run(['ticket', 'ready', '1']);

    expect(await readyTicketIds()).toEqual(['002', '001']);
  });

  test('a high ticket filed after a normal one is listed first', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Stop the page crashing', '--priority', 'high']);

    expect(await readyTicketIds()).toEqual(['002', '001']);
    expect((await run(['status'])).outputText()).toContain('ready: #002, #001');
  });

  test('ticket start on a low ticket while normal work is owed moves it without a warning', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'low']);

    const context = await run(['ticket', 'start', '2']);

    expect(context.errorText()).toBe('');
    expect(storedTicketText('002')).toContain('status: "in-progress"');
  });
});

describeWhenGitIsPresent('reading priorities', () => {
  // Every tracker in use today was written before the key existed: reading it must neither fail nor touch the file.
  test('a ticket file with no priority key reads as normal everywhere and is not rewritten by being read', async () => {
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);
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
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Fix the axis']);
    await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Reword the empty-log note', '--priority', 'low']);

    expect((await run(['ticket', 'show', '2'])).outputText()).toContain('priority: low');
    const everything = (await run(['ticket', 'list'])).outputText();
    expect(everything).toContain('priority');
    expect(everything).toMatch(/#002 +pending +low /);

    const narrowed = (await run(['ticket', 'list', '--priority', 'low'])).outputText();
    expect(narrowed).toContain('#002');
    expect(narrowed).not.toContain('#001');
    expect((await run(['ticket', 'list', '--priority', 'high'])).outputText()).toBe('No tickets are high priority.');
  });
});

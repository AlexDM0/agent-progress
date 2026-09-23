/**
 * `ticket claim`, the one start that refuses: every refusal must leave both files byte-identical, because an agent that was refused
 * goes on to do nothing, and a half-written claim would hold a slot nobody works in. The race is the case the verb exists for.
 */
import { readdirSync, readFileSync } from 'node:fs';
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

function everyTicketText(): string[] {
  const ticketsDirectory = join(repositoryDirectory, '.agent-progress', 'tickets');
  return readdirSync(ticketsDirectory).sort().map((fileName) => readFileSync(join(ticketsDirectory, fileName), 'utf8'));
}

async function agentsInFlightNow(): Promise<number> {
  const document = JSON.parse((await run(['status', '--json'])).outputText()) as { concurrency: { agentsInFlight: number } };
  return document.concurrency.agentsInFlight;
}

async function expectBundleRefusedWithNothingWritten(commandLineArguments: readonly string[]): Promise<string> {
  const progressBefore = progressText();
  const ticketsBefore  = everyTicketText();

  const { context, exitCode } = await runWithExitCode(commandLineArguments);

  expect(exitCode).toBe(1);
  expect(progressText()).toBe(progressBefore);
  expect(everyTicketText()).toEqual(ticketsBefore);
  return context.errorText();
}

describe.skipIf(!gitIsAvailable())('claiming several tickets as one agent', () => {
  beforeEach(async () => {
    for (const title of ['Show the role history', 'Export the roles', 'Import the roles', 'Rename a role']) await run(['ticket', 'add', title]);
  });

  // The case the bundle form exists for: three tickets on a limit of 2 beside another agent, which three single claims could never fit.
  test('a bundle beside one other agent is claimed whole, its rows share one agent key, and it counts as one agent', async () => {
    await run(['task', 'add', 'Review pass', '--start']);

    const context = await run(['ticket', 'claim', '3', '4', '5', '--owner', 'Alex Example', '--note', 'role import and export']);

    const bundleRows = storedProgress().tasks.filter((task) => task.ticket !== null && ['003', '004', '005'].includes(task.ticket));
    const expectedRow = ['running', '003,004,005', 'Alex Example', 'role import and export'];
    expect(bundleRows.map((row) => [row.status, row.agent, row.owner, row.note])).toEqual([expectedRow, expectedRow, expectedRow]);
    expect(everyTicketText().filter((text) => text.includes('status: "in-progress"'))).toHaveLength(3);
    expect(context.outputText()).toContain('Tickets #003, #004, #005 started as one agent: 2 of 2 slots are now taken.');
    expect(await agentsInFlightNow()).toBe(2);
  });

  test('under --json a bundle claim prints every claimed ticket, in id order', async () => {
    const context = await run(['ticket', 'claim', '5', '3', '--json']);

    const document = JSON.parse(context.outputText()) as Array<{ id: string; status: string }>;
    expect(document.map((ticket) => [ticket.id, ticket.status])).toEqual([['003', 'in-progress'], ['005', 'in-progress']]);
  });

  test('a bundle is refused whole, with nothing written, when two agents already fill the limit', async () => {
    await run(['task', 'add', 'Review pass one', '--start']);
    await run(['task', 'add', 'Review pass two', '--start']);

    const message = await expectBundleRefusedWithNothingWritten(['ticket', 'claim', '3', '4', '5']);

    expect(message).toContain('2 agents are in flight');
    expect(message).toContain('the concurrency limit is 2');
  });

  // All or nothing: the two tickets that could be claimed on their own must not be started when the third cannot.
  test('a bundle is refused whole, with nothing written, when one of its tickets waits on one that is not done', async () => {
    await run(['ticket', 'depends', '5', '1']);

    const message = await expectBundleRefusedWithNothingWritten(['ticket', 'claim', '3', '4', '5']);

    expect(message).toContain('waiting on #001');
  });

  // One agent works a bundle in dependency order, so a dependency on a fellow member is settled by the claim itself.
  test('a ticket waiting on another ticket in the same claim is claimed with it', async () => {
    await run(['ticket', 'depends', '5', '4']);

    const { exitCode } = await runWithExitCode(['ticket', 'claim', '3', '4', '5']);

    expect(exitCode).toBe(0);
    expect(everyTicketText().filter((text) => text.includes('status: "in-progress"'))).toHaveLength(3);
  });

  test('a dependency outside the claim still refuses the whole bundle, naming only the ticket outside it', async () => {
    await run(['ticket', 'depends', '5', '4', '1']);

    const message = await expectBundleRefusedWithNothingWritten(['ticket', 'claim', '3', '4', '5']);

    expect(message).toContain('waiting on #001,');
    expect(message).not.toContain('#004');
  });

  test('a bundle is refused whole, with nothing written, when one of its tickets is already in progress', async () => {
    await run(['ticket', 'start', '4']);

    const message = await expectBundleRefusedWithNothingWritten(['ticket', 'claim', '3', '4', '5']);

    expect(message).toContain('#004 is in-progress');
  });

  // The builder hands off one ticket at a time; the slot is freed only by the last of them.
  test('a bundle whose tickets go to review one at a time holds its one slot until the last row stops running', async () => {
    await run(['ticket', 'claim', '3', '4', '5']);

    const agentsInFlightAfterEachReview: number[] = [];
    for (const identifier of ['3', '4', '5']) {
      await run(['ticket', 'review', identifier]);
      agentsInFlightAfterEachReview.push(await agentsInFlightNow());
    }

    expect(agentsInFlightAfterEachReview).toEqual([1, 1, 0]);
  });

  test('naming one ticket twice claims it once', async () => {
    await run(['ticket', 'claim', '3', '003', '#3']);

    const progress = storedProgress();
    expect(progress.tasks.find((task) => task.ticket === '003')?.agent).toBe('003');
    expect(progress.log.filter((entry) => entry.text === 'Ticket #003 started')).toHaveLength(1);
  });
});

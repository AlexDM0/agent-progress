/**
 * `ticket release-of`, as the command surface sees it. The cases that matter: the key lands on the one ticket and shows in `ticket show
 * --json` and `status --json`, it survives a later transition's rewrite, `--clear` leaves the file as it was, and every refusal — a
 * second release ticket in the group, an ungrouped ticket, a settled one — exits 1 with the whole tracker byte-identical.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join }                      from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { removeScratchDirectory }             from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../Main.ts';
import { createCapturedCommandContext }       from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../testing/InitializedScratchRepository.ts';
import { storedLogEntriesOf }                 from '../testing/StoredLogEntries.ts';
import { storedLogTextOf }                    from '../testing/StoredLogText.ts';

const FROZEN_NOW = new Date('2026-09-28T09:25:00Z');
const GROUP      = 'example-shop';

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

function ticketsDirectory(): string {
  return join(repositoryDirectory, '.agent-progress', 'tickets');
}

function storedTicketText(identifier: string): string {
  const fileName = readdirSync(ticketsDirectory()).find((name) => name.startsWith(`${identifier}-`));
  if (fileName === undefined) throw new Error(`no ticket file for #${identifier}`);
  return readFileSync(join(ticketsDirectory(), fileName), 'utf8');
}

function trackerBytes(): string {
  const ticketTexts = readdirSync(ticketsDirectory()).sort().map((name) => readFileSync(join(ticketsDirectory(), name), 'utf8'));
  const progressText = readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8');
  return [progressText, storedLogTextOf(repositoryDirectory), ...ticketTexts].join('\n=====\n');
}

async function fileGroupedTickets(): Promise<void> {
  await run(['ticket', 'add', 'Example cart', '--group', GROUP]);
  await run(['ticket', 'add', 'Example checkout', '--group', GROUP, '--depends-on', '1']);
  await run(['ticket', 'add', 'Example search page']);
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('ticket-release-of', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('marking a group\'s release ticket', () => {
  test('stores the key on that ticket, shows it in show --json and status --json, and logs one line', async () => {
    await fileGroupedTickets();

    expect((await run(['ticket', 'release-of', '2'])).outputText()).toContain(`Ticket #002 marked as the release ticket of group ${GROUP}`);

    expect(storedTicketText('002')).toContain('\nreleasesGroup: true\n');
    expect(storedTicketText('001')).not.toContain('releasesGroup');
    expect(JSON.parse((await run(['ticket', 'show', '2', '--json'])).outputText())).toMatchObject({ id: '002', releasesGroup: true });
    const status = JSON.parse((await run(['status', '--json'])).outputText()) as { tickets: Array<Record<string, unknown>> };
    expect(status.tickets.find((ticket) => ticket['id'] === '002')).toMatchObject({ releasesGroup: true });
    expect(status.tickets.find((ticket) => ticket['id'] === '001')).not.toHaveProperty('releasesGroup');
    expect(storedLogEntriesOf(repositoryDirectory).map((entry) => entry.text)).toContain(`Ticket #002 marked as the release ticket of group ${GROUP}`);
  });

  test('a later transition keeps the key on its line', async () => {
    await fileGroupedTickets();
    await run(['ticket', 'release-of', '2']);
    await run(['ticket', 'start', '2']);

    const text = storedTicketText('002');
    expect(text).toContain(`\ngroup: "${GROUP}"\nreleasesGroup: true\ndependsOn: "001"\n`);
    expect(text).toContain('\nstatus: "in-progress"\n');
  });

  test('--clear leaves the file byte-identical to one that never had the key', async () => {
    await fileGroupedTickets();
    const before = storedTicketText('002');

    await run(['ticket', 'release-of', '2']);
    expect((await run(['ticket', 'release-of', '2', '--clear'])).outputText()).toContain('Ticket #002 no longer marked as its group\'s release ticket');

    expect(storedTicketText('002')).toBe(before);
  });

  test('a second release ticket in the group exits 1 and writes nothing', async () => {
    await fileGroupedTickets();
    await run(['ticket', 'release-of', '2']);
    const before = trackerBytes();

    const refused = await runExpectingRefusal(['ticket', 'release-of', '1']);

    expect(refused.errorText()).toContain(`Group ${GROUP} already has its release ticket, #002`);
    expect(trackerBytes()).toBe(before);
  });

  test('an ungrouped ticket and a delivered or abandoned one each exit 1 and write nothing', async () => {
    await fileGroupedTickets();
    await run(['ticket', 'add', 'Example wish list', '--group', GROUP]);
    await run(['ticket', 'abandon', '4', '--reason', 'superseded by #002']);
    await run(['ticket', 'claim', '1']);
    await run(['ticket', 'finish', '1']);
    await run(['ticket', 'approve', '1']);
    await run(['ticket', 'deliver', '1']);
    const before = trackerBytes();

    expect((await runExpectingRefusal(['ticket', 'release-of', '3'])).errorText()).toContain('Ticket #003 belongs to no group');
    expect((await runExpectingRefusal(['ticket', 'release-of', '4'])).errorText()).toContain('Ticket #004 is abandoned');
    expect((await runExpectingRefusal(['ticket', 'release-of', '1'])).errorText()).toContain('Ticket #001 is delivered');

    expect(trackerBytes()).toBe(before);
  });
});

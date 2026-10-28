/**
 * A ticket's links back to its causes, `introducedBy` and `foundInReview`, as the command surface sees them. The cases that matter: a ticket
 * filed without either flag is written exactly as before the keys existed, a set or cleared link keeps every other line of the file, each
 * refusal writes nothing, and `ticket priority` round-trips a file holding the keys byte for byte apart from its own line.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join }                      from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
import { PRODUCT_NAMES }                      from '../../src/shared/constants/ProductNames.ts';
import { removeScratchDirectory }             from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../Main.ts';
import { createCapturedCommandContext }       from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../testing/InitializedScratchRepository.ts';
import { fileReadyTicket }                    from '../testing/ReadyTicketFiling.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

/**
 * Taken from `ticket add` before either key existed, by running this test on the commit before them: a ticket filed with neither flag must
 * still be written exactly so. It is never retaken from the current implementation.
 */
const FROZEN_FRONTMATTER_FILED_WITHOUT_LINKS = [
  '---',
  'id: "001"',
  'title: "Example checkout page"',
  'type: "ticket"',
  'status: "pending"',
  'filed: "2026-09-18T20:11:03+00:00"',
  'updated: "2026-09-18T20:11:03+00:00"',
  'started: null',
  'finished: null',
  'delivered: null',
  'abandonedAt: null',
  'task: 1',
  '---',
  '',
].join('\n');

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

function ticketsDirectory(): string {
  return join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'tickets');
}

function storedTicketText(identifier: string): string {
  const fileName = readdirSync(ticketsDirectory()).find((name) => name.startsWith(`${identifier}-`));
  if (fileName === undefined) throw new Error(`no ticket file for #${identifier}`);
  return readFileSync(join(ticketsDirectory(), fileName), 'utf8');
}

function storedLogText(): string {
  return readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'log.jsonl'), 'utf8');
}

function trackerSnapshot(): string {
  const ticketTexts = readdirSync(ticketsDirectory()).toSorted().map((fileName) => readFileSync(join(ticketsDirectory(), fileName), 'utf8'));
  return [storedLogText(), readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json'), 'utf8'), ...ticketTexts].join('\n=====\n');
}

/** Refused at exit 1, with the log, the progress file and every ticket file, their number included, left as they were. */
async function expectRefusedWritingNothing(commandLineArguments: readonly string[], refusalFragment: string): Promise<void> {
  const before   = trackerSnapshot();
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` was expected to be refused`).toBe(1);
  expect(context.errorText()).toContain(refusalFragment);
  expect(trackerSnapshot()).toBe(before);
}

/** #001 delivered, #002 a pending bug, #003 a pending ticket. */
async function fileDeliveredCauseAndPendingBug(): Promise<void> {
  await fileReadyTicket(run, ['ticket', 'add', 'Example checkout page', '--type', 'ticket']);
  await run(['ticket', 'status', '001', 'delivered']);
  await fileReadyTicket(run, ['ticket', 'add', 'Example cart total is wrong', '--type', 'bug']);
  await fileReadyTicket(run, ['ticket', 'add', 'Example search page', '--type', 'ticket']);
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('ticket-introduced-by', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('filing with a link', () => {
  test('a ticket filed with neither flag is written byte for byte as before the keys existed', async () => {
    await fileReadyTicket(run, ['ticket', 'add', 'Example checkout page', '--type', 'ticket']);

    expect(storedTicketText('001').slice(0, FROZEN_FRONTMATTER_FILED_WITHOUT_LINKS.length)).toBe(FROZEN_FRONTMATTER_FILED_WITHOUT_LINKS);
  });

  test('ticket add --type bug --introduced-by stores the cause, and ticket show --json prints it', async () => {
    await fileDeliveredCauseAndPendingBug();

    await fileReadyTicket(run, ['ticket', 'add', 'Example coupon is lost', '--type', 'bug', '--introduced-by', '#1']);

    expect(storedTicketText('004')).toContain('\nintroducedBy: "001"\n');
    const shown = JSON.parse((await run(['ticket', 'show', '004', '--json'])).outputText()) as { introducedBy?: string };
    expect(shown.introducedBy).toBe('001');
  });

  test('ticket add --found-in-review stores the reviewed ticket, and status --json carries it', async () => {
    await fileDeliveredCauseAndPendingBug();

    await fileReadyTicket(run, ['ticket', 'add', 'Example sentence wraps late', '--type', 'ticket', '--priority', 'low', '--found-in-review', '3']);

    expect(storedTicketText('004')).toContain('\nfoundInReview: "003"\n');
    const status = JSON.parse((await run(['status', '--json'])).outputText()) as { tickets: Array<{ id: string; foundInReview?: string }> };
    expect(status.tickets.find((ticket) => ticket.id === '004')?.foundInReview).toBe('003');
  });

  test('--introduced-by on a non-bug, a missing cause or an undelivered one, and --found-in-review naming no ticket, are refused writing nothing', async () => {
    await fileDeliveredCauseAndPendingBug();

    await expectRefusedWritingNothing(['ticket', 'add', 'Example ticket', '--type', 'ticket', '--introduced-by', '1'], 'only a bug names the ticket that introduced it');
    await expectRefusedWritingNothing(['ticket', 'add', 'Example bug', '--type', 'bug', '--introduced-by', '99'], 'There is no ticket #099');
    await expectRefusedWritingNothing(['ticket', 'add', 'Example bug', '--type', 'bug', '--introduced-by', '3'], 'it is pending');
    await expectRefusedWritingNothing(['ticket', 'add', 'Example finding', '--type', 'ticket', '--found-in-review', '99'], 'There is no ticket #099');
  });
});

describeWhenGitIsPresent('ticket introduced-by', () => {
  test('sets the cause with one log record, and an empty cause removes the key, every other line kept byte for byte', async () => {
    await fileDeliveredCauseAndPendingBug();
    const beforeText = storedTicketText('002');
    const logBefore  = storedLogText();

    await run(['ticket', 'introduced-by', '2', '1']);

    const setText = storedTicketText('002');
    expect(setText.replace('introducedBy: "001"\n', '')).toBe(beforeText);
    expect(setText).not.toBe(beforeText);
    const loggedLines = storedLogText().slice(logBefore.length).trim().split('\n');
    expect(loggedLines.map((line) => JSON.parse(line) as { kind: string; ticketId: string; fields: unknown })
      .map(({ kind, ticketId, fields }) => ({ kind, ticketId, fields }))).toEqual([
      { kind: 'ticket-introduced-by-set', ticketId: '002', fields: { introducedBy: '001' } },
    ]);

    await run(['ticket', 'introduced-by', '2', '']);

    expect(storedTicketText('002')).toBe(beforeText);
    expect(JSON.parse(storedLogText().trim().split('\n').at(-1) ?? '{}')).toMatchObject({ kind: 'ticket-introduced-by-set', ticketId: '002', fields: {} });
  });

  test('a non-bug, a missing cause, the ticket itself and an undelivered cause are each refused writing nothing', async () => {
    await fileDeliveredCauseAndPendingBug();

    await expectRefusedWritingNothing(['ticket', 'introduced-by', '3', '1'], 'Ticket #003 is a ticket, and only a bug names the ticket that introduced it');
    await expectRefusedWritingNothing(['ticket', 'introduced-by', '2', '99'], 'There is no ticket #099');
    await expectRefusedWritingNothing(['ticket', 'introduced-by', '2', '2'], 'Ticket #002 cannot be introduced by itself');
    await expectRefusedWritingNothing(['ticket', 'introduced-by', '2', '3'], 'Ticket #002 cannot be introduced by #003: it is pending');
  });

  test('ticket priority round-trips a file holding both keys, and one holding neither, apart from its own line', async () => {
    await fileDeliveredCauseAndPendingBug();
    await fileReadyTicket(run, ['ticket', 'add', 'Example coupon is lost', '--type', 'bug', '--introduced-by', '1', '--found-in-review', '3']);

    for (const identifier of ['004', '002']) {
      const beforeText = storedTicketText(identifier);
      await run(['ticket', 'priority', identifier, 'high']);
      expect(storedTicketText(identifier).replace('priority: "high"\n', '')).toBe(beforeText);
    }
    expect(storedTicketText('004')).toContain('introducedBy: "001"\nfoundInReview: "003"\n');
  });
});

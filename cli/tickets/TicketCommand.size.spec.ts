/**
 * A ticket's T-shirt size as the command surface sees it. The cases that matter: `ticket add --size` stores it and `ticket size` changes it
 * with a log line, a value outside the capital list is refused on both with nothing written, `status --json` prints it, and a ticket
 * filed without one carries no key and is rewritten byte for byte by a write that does not touch it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join }                      from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
import { removeScratchDirectory }             from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../Main.ts';
import { createCapturedCommandContext }       from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../testing/InitializedScratchRepository.ts';
import { storedLogEntriesOf }                 from '../testing/StoredLogEntries.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

let repositoryDirectory = '';

function contextHere(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
}

async function runWithExitCode(commandLineArguments: readonly string[], expectedExitCode: number): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\`: ${context.errorText()}`).toBe(expectedExitCode);
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

function storedTicketFileNames(): string[] {
  return readdirSync(ticketsDirectory());
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('ticket-size', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('a ticket size', () => {
  test('ticket add --size stores it, ticket size changes it with a log line, and status --json prints it', async () => {
    await runWithExitCode(['ticket', 'add', 'Example checkout', '--type', 'ticket', '--size', 'M'], 0);
    expect(storedTicketText('001')).toContain('\nsize: "M"\n');

    const changed = await runWithExitCode(['ticket', 'size', '1', 'L'], 0);
    expect(changed.outputText()).toContain('Ticket #001 size M → L');
    expect(storedTicketText('001')).toContain('\nsize: "L"\n');
    expect(storedLogEntriesOf(repositoryDirectory).map((entry) => entry.text)).toContain('Ticket #001 size M → L');

    const status = JSON.parse((await runWithExitCode(['status', '--json'], 0)).outputText()) as { tickets: Array<{ id: string; size?: string }> };
    expect(status.tickets.find((ticket) => ticket.id === '001')?.size).toBe('L');
  });

  test('a lowercase or unknown size is refused at exit 1 on both commands, with nothing written', async () => {
    await runWithExitCode(['ticket', 'add', 'Example checkout', '--type', 'ticket', '--size', 'm'], 1);
    expect(storedTicketFileNames()).toEqual([]);

    await runWithExitCode(['ticket', 'add', 'Example checkout', '--type', 'ticket'], 0);
    const before  = storedTicketText('001');
    const refused = await runWithExitCode(['ticket', 'size', '1', 'XXXL'], 1);
    expect(refused.errorText()).toContain('The sizes are XS, S, M, L, XL, XXL');
    await runWithExitCode(['ticket', 'size', '1', 'xl'], 1);
    expect(storedTicketText('001')).toBe(before);
  });

  test('a ticket filed without a size has no key, and a write through the CLI leaves its file byte-identical', async () => {
    await runWithExitCode(['ticket', 'add', 'Example checkout', '--type', 'ticket'], 0);
    const filed = storedTicketText('001');
    expect(filed).not.toContain('size:');

    await runWithExitCode(['ticket', 'hold', '1', '--reason', 'waiting on Example Agency'], 0);
    await runWithExitCode(['ticket', 'unhold', '1'], 0);
    expect(storedTicketText('001')).toBe(filed);
  });
});

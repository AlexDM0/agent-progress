/**
 * The model and effort a ticket's agents run on, as the command surface sees them. The cases that matter: both are stored only once named,
 * `ticket agent` changes one without touching the other, every refusal leaves both files byte-identical, and a ticket file without the keys
 * reads as the default pair and is never rewritten for being read.
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

const FROZEN_NOW = new Date('2026-09-24T09:25:00Z');

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

function ticketsDirectory(): string {
  return join(repositoryDirectory, '.agent-progress', 'tickets');
}

function ticketFilePath(identifier: string): string {
  const fileName = readdirSync(ticketsDirectory()).find((name) => name.startsWith(`${identifier}-`));
  if (fileName === undefined) throw new Error(`no ticket file for #${identifier}`);
  return join(ticketsDirectory(), fileName);
}

function storedTicketText(identifier: string): string {
  return readFileSync(ticketFilePath(identifier), 'utf8');
}

function trackerBytes(): string {
  const ticketTexts = readdirSync(ticketsDirectory()).sort().map((name) => readFileSync(join(ticketsDirectory(), name), 'utf8'));
  return [readFileSync(progressFilePath(), 'utf8'), ...ticketTexts].join('\n=====\n');
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('ticket-agent');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('naming a ticket\'s agents', () => {
  test('ticket add --model and --effort store both keys, and show and list print them', async () => {
    await run(['ticket', 'add', 'Show the role history', '--model', 'sonnet', '--effort', 'high']);

    expect(storedTicketText('001')).toContain('\nmodel: "sonnet"\neffort: "high"\n');
    const shown = (await run(['ticket', 'show', '1'])).outputText();
    expect(shown).toContain('\n  model:    sonnet\n  effort:   high\n');
    expect((await run(['ticket', 'list'])).outputText()).toContain('Show the role history  [sonnet, high effort]');
    const shownAsJson = JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText()) as { model: string; effort: string };
    expect([shownAsJson.model, shownAsJson.effort]).toEqual(['sonnet', 'high']);
  });

  test('ticket agent --effort changes the effort alone, with one log line naming both pairs', async () => {
    await run(['ticket', 'add', 'Show the role history', '--model', 'sonnet', '--effort', 'high']);

    const printed = (await run(['ticket', 'agent', '1', '--effort', 'low'])).outputText();

    expect(printed).toContain('Ticket #001 agents sonnet/high → sonnet/low');
    expect(storedTicketText('001')).toContain('\nmodel: "sonnet"\neffort: "low"\n');
    expect(storedProgress().log.filter((entry) => entry.text.startsWith('Ticket #001 agents'))).toHaveLength(1);
  });

  test('ticket agent on a ticket left to the defaults names the default pair it moves from', async () => {
    await run(['ticket', 'add', 'Show the role history']);

    expect((await run(['ticket', 'agent', '1', '--model', 'fable'])).outputText()).toContain('Ticket #001 agents opus/medium → fable/medium');
    expect(storedTicketText('001')).toContain('\nmodel: "fable"\n');
    expect(storedTicketText('001')).not.toContain('effort:');
  });
});

describe.skipIf(!gitIsAvailable())('refusals leave both files byte-identical', () => {
  // Each refusal is checked against the whole tracker's bytes, so a half-applied write cannot pass as a refusal.
  test('an unknown model or effort, no option, no change, and a delivered or abandoned ticket are all refused at exit 1', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'add', 'Export the roles']);
    await run(['ticket', 'add', 'Import the roles']);
    await run(['ticket', 'status', '2', 'delivered']);
    await run(['ticket', 'abandon', '3', '--reason', 'superseded by #1']);
    const before = trackerBytes();

    const refusals: Array<[string[], string]> = [
      [['ticket', 'add', 'Rename the roles', '--model', 'claude-opus-5-5'], '"claude-opus-5-5" is not an agent model. The models are haiku, sonnet, opus, fable.'],
      [['ticket', 'add', 'Rename the roles', '--effort', 'extreme'], '"extreme" is not an agent effort. The efforts are low, medium, high, xhigh, max.'],
      [['ticket', 'agent', '1', '--model', 'constructor'], '"constructor" is not an agent model.'],
      [['ticket', 'agent', '1', '--effort', 'Medium'], '"Medium" is not an agent effort.'],
      [['ticket', 'agent', '1'], 'needs --model, --effort or both'],
      [['ticket', 'agent', '1', '--model', 'opus', '--effort', 'medium'], 'they already run on opus/medium'],
      [['ticket', 'agent', '2', '--effort', 'high'], 'Ticket #002 is delivered, and its agents were not changed'],
      [['ticket', 'agent', '3', '--effort', 'high'], 'Ticket #003 is abandoned, and its agents were not changed'],
    ];
    for (const [commandLineArguments, reason] of refusals) {
      const context = await runExpectingRefusal(commandLineArguments);
      expect(context.errorText(), commandLineArguments.join(' ')).toContain(reason);
      expect(trackerBytes(), commandLineArguments.join(' ')).toBe(before);
    }
  });
});

describe.skipIf(!gitIsAvailable())('a ticket filed without the keys', () => {
  // A tracker from before this feature holds only such files; reading them must never add the default pair to them.
  test('reads as opus and medium everywhere, and is left byte-identical by every reader', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    const before = storedTicketText('001');
    expect(before).not.toContain('model:');
    expect(before).not.toContain('effort:');

    await run(['ticket', 'list']);
    await run(['ticket', 'list', '--json']);
    const shown = (await run(['ticket', 'show', '1'])).outputText();
    await run(['status']);
    const status = JSON.parse((await run(['status', '--json'])).outputText()) as { readyTickets: unknown[] };
    await run(['status', '--json', '--full']);

    expect(shown).not.toContain('  model:');
    expect(status.readyTickets).toEqual([{
      id:       '001',
      priority: 'normal',
      model:    'opus',
      effort:   'medium',
    }]);
    expect(storedTicketText('001')).toBe(before);
  });
});

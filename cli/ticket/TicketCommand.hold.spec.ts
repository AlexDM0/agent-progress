/**
 * `ticket hold` and `ticket unhold`, as the command surface sees them. The cases that matter: the key is written only while held and a
 * round trip leaves the ticket as it was, each move logs one line, `status --json` names a held ticket in review as much as a ready one — the
 * dispatcher decides on that list — every refusal leaves the whole tracker byte-identical, and `ticket claim` refuses a held ticket.
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

interface StatusDocument {
  concurrency:  { heldTicketIds: string[]; readyTicketIds: string[] };
  readyTickets: Record<string, unknown>[];
}

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

async function statusDocument(): Promise<StatusDocument> {
  return JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
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

function storedTicketText(identifier: string): string {
  const fileName = readdirSync(ticketsDirectory()).find((name) => name.startsWith(`${identifier}-`));
  if (fileName === undefined) throw new Error(`no ticket file for #${identifier}`);
  return readFileSync(join(ticketsDirectory(), fileName), 'utf8');
}

function trackerBytes(): string {
  const ticketTexts = readdirSync(ticketsDirectory()).sort().map((name) => readFileSync(join(ticketsDirectory(), name), 'utf8'));
  return [readFileSync(progressFilePath(), 'utf8'), ...ticketTexts].join('\n=====\n');
}

function holdLogLines(): string[] {
  return storedProgress().log.map((entry) => entry.text).filter((text) => / (?:un)?held\b/.test(text));
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('ticket-hold');
  await run(['init', '--project', 'Example Agency']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('holding a ticket', () => {
  test('hold with a reason then unhold round-trip the ticket file, with one log line each way', async () => {
    for (let i = 0; i < 7; i++) await run(['ticket', 'add', `Example ticket ${i + 1}`]);
    const before = storedTicketText('007');

    expect((await run(['ticket', 'hold', '7', '--reason', 'x'])).outputText()).toContain('Ticket #007 held: x');
    expect(storedTicketText('007')).toContain('\nhold: "x"\n');
    expect((await run(['ticket', 'show', '7'])).outputText()).toContain('\n  held:     x\n');
    expect((await run(['ticket', 'unhold', '7'])).outputText()).toContain('Ticket #007 unheld');

    expect(storedTicketText('007')).toBe(before);
    expect(holdLogLines()).toEqual(['Ticket #007 held: x', 'Ticket #007 unheld']);
  });

  test('a hold without a reason is stored empty and still holds', async () => {
    await run(['ticket', 'add', 'Show the role history']);

    expect((await run(['ticket', 'hold', '1'])).outputText()).toContain('Ticket #001 held');
    expect(storedTicketText('001')).toContain('\nhold: ""\n');
    expect((await statusDocument()).concurrency.heldTicketIds).toEqual(['001']);
  });

  // The dispatcher decides on this list, and a ticket in review has no readyTickets entry to carry the flag.
  test('status --json lists a held ticket in review, and marks a held ready ticket\'s entry', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'add', 'Export the roles']);
    await run(['ticket', 'claim', '1']);
    await run(['ticket', 'review', '1']);
    await run(['ticket', 'hold', '1', '--reason', 'the user reads it first']);
    await run(['ticket', 'hold', '2']);

    const status = await statusDocument();

    expect(status.concurrency.heldTicketIds).toEqual(['001', '002']);
    expect(status.concurrency.readyTicketIds).toEqual(['002']);
    expect(status.readyTickets).toEqual([{
      id:       '002',
      priority: 'normal',
      model:    'opus',
      effort:   'medium',
      held:     true,
    }]);
  });

  test('ticket claim refuses a held ticket, and claims it once unheld', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'hold', '1']);
    const before = trackerBytes();

    const refused = await runExpectingRefusal(['ticket', 'claim', '1']);

    expect(refused.errorText()).toContain('Ticket #001 is held, so it is not claimed');
    expect(trackerBytes()).toBe(before);
    await run(['ticket', 'unhold', '1']);
    await run(['ticket', 'claim', '1']);
  });

  // `start` is the override beside `claim`, so it moves a held ticket, but says so the way it does for an unsettled dependency.
  test('ticket start moves a held ticket and warns on standard error that it is held', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'hold', '1', '--reason', 'the user reads it first']);

    const context = await run(['ticket', 'start', '1']);

    expect(context.errorText()).toContain('Ticket #001 is held; it was started anyway');
    expect((await run(['ticket', 'show', '1', '--json'])).outputText()).toContain('"status": "in-progress"');
  });

  test('ticket start warns about no hold on a ticket that is not held', async () => {
    await run(['ticket', 'add', 'Show the role history']);

    expect((await run(['ticket', 'start', '1'])).errorText()).not.toContain('held');
  });
});

const RESUME_BUILD_HINT = 'launch a single-ticket dispatcher run for #001';
const WHOLE_BOARD_RESUME_HINT = 'the next whole-board dispatcher run resumes it; when none is going or about to be launched, launch a single-ticket';

async function unholdOutput(extraArguments: readonly string[] = []): Promise<string> {
  return (await run(['ticket', 'unhold', '1', ...extraArguments])).outputText();
}

// A whole-board run's survey resumes a paused build, so the hint names the single-ticket run only as the lane for when no such run is coming.
describe.skipIf(!gitIsAvailable())('unholding a ticket whose build a dispatcher run left paused', () => {
  beforeEach(async () => {
    await run(['ticket', 'add', 'Show the role history']);
  });

  test('ends its human output with the whole-board run that resumes the build and the single-ticket fast lane, after the Next line', async () => {
    await run(['ticket', 'claim', '1', '--note', 'Built by the whole-board dispatcher run on ticket-001']);
    await run(['task', 'pause', '1']);
    await run(['ticket', 'hold', '1']);

    const lines = (await unholdOutput()).trimEnd().split('\n');

    expect(lines.at(-2)).toStartWith('Next: ');
    expect(lines.at(-1)).toContain(RESUME_BUILD_HINT);
    expect(lines.at(-1)).toContain(WHOLE_BOARD_RESUME_HINT);
  });

  // Every dispatcher run's builder takes over only a dispatcher claim, so a person's pause is resumed or settled by hand.
  test('names resuming the row by hand, and no dispatcher run, when the paused row carries a note other than a dispatcher claim', async () => {
    await run(['ticket', 'claim', '1', '--note', 'Paused by Alex Example']);
    await run(['task', 'pause', '1']);
    await run(['ticket', 'hold', '1']);
    const buildRowId = storedProgress().tasks[0]?.id;

    const lastLine = (await unholdOutput()).trimEnd().split('\n').at(-1);

    expect(lastLine).toContain(`\`agent-progress task start ${buildRowId}\``);
    expect(lastLine).not.toContain('dispatcher run');
  });

  // The script writes the claim note and the CLI recognises it; this reads the script's own `claimNoteOf`, so the two cannot drift apart.
  test('a claim note in the form the dispatcher script writes, for either kind of run, is recognised as a dispatcher claim', async () => {
    const scriptText    = readFileSync(join(import.meta.dir, '..', '..', 'templates', 'workflows', 'AgentProgressDispatch.js'), 'utf8');
    const noteTemplate  = /function claimNoteOf\(ticketId\) \{\s*return `([^`]+)`;/.exec(scriptText)?.[1];
    const runLabelMatch = /runLabel:\s*ticketIds === null \? '([^']+)' : `([^`]+)`,/.exec(scriptText);
    expect(noteTemplate, 'claimNoteOf is no longer one template literal; update this reading of it').toBeDefined();
    expect(runLabelMatch, 'runLabel is no longer one conditional; update this reading of it').not.toBeNull();
    const runLabels = [runLabelMatch?.[1] ?? '', (runLabelMatch?.[2] ?? '').replace('${ticketIds.join(\'+\')}', '001')];

    for (const runLabel of runLabels) {
      const claimNote = (noteTemplate ?? '').replace('${settings.runLabel}', runLabel).replace('${ticketId}', '001');
      expect(claimNote).not.toContain('${');
      await run(['ticket', 'claim', '1', '--note', claimNote]);
      await run(['task', 'pause', '1']);
      await run(['ticket', 'hold', '1']);

      expect((await unholdOutput()).trimEnd().split('\n').at(-1), claimNote).toContain(WHOLE_BOARD_RESUME_HINT);
      await run(['ticket', 'reopen', '1']);
    }
  });

  test('prints no hint under --json, whose document parses whole', async () => {
    await run(['ticket', 'claim', '1']);
    await run(['task', 'pause', '1']);
    await run(['ticket', 'hold', '1']);

    const output = await unholdOutput(['--json']);

    expect(output).not.toContain(RESUME_BUILD_HINT);
    expect((JSON.parse(output) as { id: string }).id).toBe('001');
  });

  test('prints no hint for an open ticket, a running build, a ticket in review, or on a hold', async () => {
    await run(['ticket', 'hold', '1']);
    expect(await unholdOutput()).not.toContain(RESUME_BUILD_HINT);

    await run(['ticket', 'claim', '1']);
    await run(['ticket', 'hold', '1']);
    expect(await unholdOutput()).not.toContain(RESUME_BUILD_HINT);

    await run(['task', 'pause', '1']);
    expect((await run(['ticket', 'hold', '1'])).outputText()).not.toContain(RESUME_BUILD_HINT);

    await run(['task', 'start', '1']);
    await run(['ticket', 'review', '1']);
    await run(['task', 'pause', '1']);
    expect(await unholdOutput()).not.toContain(RESUME_BUILD_HINT);
  });
});

describe.skipIf(!gitIsAvailable())('refusals leave the whole tracker byte-identical', () => {
  // Each refusal is checked against the whole tracker's bytes, so a half-applied write cannot pass as a refusal.
  test('a delivered or abandoned ticket, a second hold, an unhold of a ticket not held and a missing id are all refused at exit 1', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'add', 'Export the roles']);
    await run(['ticket', 'add', 'Import the roles']);
    await run(['ticket', 'status', '2', 'delivered']);
    await run(['ticket', 'abandon', '3', '--reason', 'superseded by #1']);
    await run(['ticket', 'hold', '1']);
    const before = trackerBytes();

    const refusals: Array<[string[], string]> = [
      [['ticket', 'hold', '2', '--reason', 'x'], 'Ticket #002 is delivered, and no agent will work it again, so there is nothing to hold'],
      [['ticket', 'hold', '3'], 'Ticket #003 is abandoned, and no agent will work it again, so there is nothing to hold'],
      [['ticket', 'unhold', '2'], 'Ticket #002 is delivered, and no agent will work it again, so there is nothing to unhold'],
      [['ticket', 'hold', '1'], 'Ticket #001 is already held'],
      [['ticket', 'unhold', '4'], 'There is no readable ticket 4'],
      [['ticket', 'hold'], 'agent-progress ticket hold needs a ticket id'],
      [['ticket', 'unhold', '1', '--reason', 'x'], 'Unknown option'],
    ];
    for (const [commandLineArguments, reason] of refusals) {
      const context = await runExpectingRefusal(commandLineArguments);
      expect(context.errorText(), commandLineArguments.join(' ')).toContain(reason);
      expect(trackerBytes(), commandLineArguments.join(' ')).toBe(before);
    }
    await run(['ticket', 'unhold', '1']);
    const unheld = trackerBytes();
    const context = await runExpectingRefusal(['ticket', 'unhold', '1']);
    expect(context.errorText()).toContain('Ticket #001 is not held');
    expect(trackerBytes()).toBe(unheld);
  });
});

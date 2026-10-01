/**
 * `epic` and `ticket epic` as the command surface sees them. What matters: every refusal exits 1 and leaves every stored file as it was;
 * a tracker that never adds an epic gains no `epics/` folder and its tickets keep their bytes; and the roll-up `status --json` prints for
 * a ticket in two epics matches a count by hand.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

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

const FROZEN_NOW = new Date('2026-10-01T09:25:00Z');

type CapturedContext = ReturnType<typeof createCapturedCommandContext>;

let repositoryDirectory = '';

async function runExpectingExit(expectedExitCode: number, commandLineArguments: readonly string[]): Promise<CapturedContext> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\`: ${context.errorText()}`).toBe(expectedExitCode);
  return context;
}

async function run(commandLineArguments: readonly string[]): Promise<CapturedContext> {
  return runExpectingExit(0, commandLineArguments);
}

async function jsonOf(commandLineArguments: readonly string[]): Promise<Record<string, unknown>> {
  return JSON.parse((await run([...commandLineArguments, '--json'])).outputText()) as Record<string, unknown>;
}

/** Every stored file under the tracker but the page and its stamp, which a refused command never reaches either way. */
function storedFiles(): Record<string, string> {
  const trackerDirectory = join(repositoryDirectory, '.agent-progress');
  const stored: Record<string, string> = {};
  for (const relativePath of readdirSync(trackerDirectory, { recursive: true, encoding: 'utf8' })) {
    const path = join(trackerDirectory, relativePath);
    if (relativePath.endsWith('.json') || relativePath.endsWith('.jsonl') || relativePath.endsWith('.md')) stored[relativePath] = readFileSync(path, 'utf8');
  }
  return stored;
}

const epicsDirectory = (): string => join(repositoryDirectory, '.agent-progress', 'epics');

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('epic-command', ['--project', 'Example Agency'], () => FROZEN_NOW);
  await run(['ticket', 'add', 'Example cart']);
  await run(['ticket', 'add', 'Example search']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('epic', () => {
  test('without an epic, no command adds an epics folder or touches a ticket\'s bytes', async () => {
    const before = storedFiles();

    await run(['status', '--json']);
    await run(['render']);
    await run(['epic', 'list']);
    await run(['ticket', 'depends', '2', '1']);

    expect(existsSync(epicsDirectory())).toBe(false);
    const after = storedFiles();
    for (const [path, text] of Object.entries(before)) if (path.startsWith('tickets/001')) expect(after[path]).toBe(text);
  });

  test('add writes the key, the title, the slot and the description, kept byte for byte', async () => {
    await run(['epic', 'add', 'checkout-redesign', 'Checkout redesign', '--body', 'The checkout, rebuilt.\n\n---\nAfter a rule.']);

    expect(readFileSync(join(epicsDirectory(), 'checkout-redesign.md'), 'utf8'))
      .toBe('---\nkey: "checkout-redesign"\ntitle: "Checkout redesign"\nslot: 1\n---\nThe checkout, rebuilt.\n\n---\nAfter a rule.');
  });

  test('every refusal exits 1 and writes nothing', async () => {
    await run(['epic', 'add', 'checkout-redesign', 'Checkout redesign']);
    await run(['ticket', 'epic', '1', 'checkout-redesign']);
    writeFileSync(join(epicsDirectory(), 'broken.md'), '---\nkey: broken\n---\n');
    const before = storedFiles();

    const refusals = [
      ['epic', 'add', 'Checkout_Redesign', 'Example'],
      ['epic', 'add', 'checkout-redesign', 'Example'],
      ['epic', 'add', 'broken', 'Example'],
      ['epic', 'edit', 'search', '--title', 'Example'],
      ['epic', 'remove', 'checkout-redesign'],
      ['epic', 'show', 'search'],
      ['ticket', 'epic', '2', 'search'],
      ['ticket', 'epic', '2', 'checkout-redesign', '--add', 'search'],
      ['ticket', 'add', 'Example loyalty card', '--epic', 'search'],
    ];
    for (const refusal of refusals) await runExpectingExit(1, refusal);

    expect(storedFiles()).toEqual(before);
  });

  test('the roll-up in status --json matches a count by hand for a ticket in two epics', async () => {
    await run(['epic', 'add', 'checkout-redesign', 'Checkout redesign']);
    await run(['epic', 'add', 'loyalty-programme', 'Loyalty programme']);
    await run(['ticket', 'epic', '1', 'loyalty-programme', 'checkout-redesign']);
    await run(['ticket', 'add', 'Example loyalty card', '--epic', 'loyalty-programme']);
    // The stamps are written in the zone the test run keeps, so they come back as typed.
    await run(['ticket', 'start', '1', '--at', '2026-10-01T07:00:00+00:00']);
    await run(['ticket', 'finish', '1', '--tokens', '100k', '--at', '2026-10-01T08:00:00+00:00']);
    await run(['ticket', 'start', '2', '--at', '2026-10-01T08:30:00+00:00']);
    await run(['ticket', 'epic', '2', '--add', 'checkout-redesign']);

    const status = await jsonOf(['status', '--full']);
    const tickets = status['tickets'] as { id: string; epics: string[] }[];

    expect(tickets.map((ticket) => [ticket.id, ticket.epics])).toEqual([
      ['001', ['loyalty-programme', 'checkout-redesign']],
      ['002', ['checkout-redesign']],
      ['003', ['loyalty-programme']],
    ]);
    expect(status['epics']).toEqual([
      {
        key:                 'checkout-redesign',
        title:               'Checkout redesign',
        slot:                1,
        ticketIds:           ['001', '002'],
        ticketCountByStatus: {
          'pending': 0, 'in-progress': 1, 'in-review': 1, 'reviewed': 0, 'delivered': 0, 'abandoned': 0
        },
        tokens: 100_000,
        span:   { start: '2026-10-01T07:00:00+00:00', end: null },
      },
      {
        key:                 'loyalty-programme',
        title:               'Loyalty programme',
        slot:                2,
        ticketIds:           ['001', '003'],
        ticketCountByStatus: {
          'pending': 1, 'in-progress': 0, 'in-review': 1, 'reviewed': 0, 'delivered': 0, 'abandoned': 0
        },
        tokens: 100_000,
        span:   { start: '2026-10-01T07:00:00+00:00', end: '2026-10-01T08:00:00+00:00' },
      },
    ]);
    const listed = JSON.parse((await run(['epic', 'list', '--json'])).outputText()) as unknown;
    const storedEpicsDirectory = realpathSync(epicsDirectory());
    expect(listed).toEqual((status['epics'] as { key: string }[]).map((rollup) => ({ ...rollup, filePath: join(storedEpicsDirectory, `${rollup.key}.md`) })));
  });

  test('edit changes the title and appends to the description; remove deletes an epic no ticket names', async () => {
    await run(['epic', 'add', 'search', 'Search', '--body', 'First.']);
    await run(['epic', 'edit', 'search', '--title', 'Example search', '--append', '--body', 'Second.']);

    expect(await jsonOf(['epic', 'show', 'search'])).toMatchObject({ title: 'Example search', body: 'First.\nSecond.' });

    await run(['ticket', 'epic', '1', 'search']);
    await run(['ticket', 'epic', '1']);
    await run(['epic', 'remove', 'search']);

    expect(existsSync(join(epicsDirectory(), 'search.md'))).toBe(false);
  });
});

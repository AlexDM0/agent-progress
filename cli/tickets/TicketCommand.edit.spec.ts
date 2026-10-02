/**
 * `ticket edit`, as the command surface sees it. The byte-for-byte guarantee of a ticket body is what the cases are about: a CRLF body
 * stays CRLF throughout, a body holding a `---` line round-trips, an append puts exactly one line ending before its text where the body
 * ends without one, an empty append writes nothing, and the frontmatter's bytes (unknown keys, comments, a hand-written layout) survive
 * an edit while `updated` is not stamped and nothing is logged. A rename touches the title line, the ticket's own row and a generated
 * heading only, keeping the file path, a review bar's name and a hand-changed heading, and logs one line.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                     from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                  from 'bun:test';
import { removeScratchDirectory }             from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../Main.ts';
import { createCapturedCommandContext }       from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../testing/InitializedScratchRepository.ts';
import { storedLogTextOf }                    from '../testing/StoredLogText.ts';

const FROZEN_NOW = new Date('2026-09-24T09:25:00Z');

/** Hand-written the way the CLI never writes one: unquoted values, keys out of the CLI's order, a comment, a blank line and an unknown key. */
const HAND_WRITTEN_FRONTMATTER_LINES = [
  '---',
  'id: "001"',
  'status: pending',
  'title: "Example checkout page"',
  'type: feature',
  '# kept by hand',
  'owner: Alex Example',
  '',
  'filed: "2026-09-20T10:00:00+02:00"',
  'updated: "2026-09-20T10:00:00+02:00"',
  'started: null',
  'finished: null',
  'delivered: null',
  'abandonedAt: null',
  'task: 1',
  '---',
];

let repositoryDirectory = '';

function contextHere(standardInputText?: string): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({
    currentDirectory: repositoryDirectory,
    now:              () => FROZEN_NOW,
    ...(standardInputText === undefined ? {} : { standardInputText }),
  });
}

type CapturedContext = ReturnType<typeof createCapturedCommandContext>;

async function runExpectingExit(expectedExitCode: number, commandLineArguments: readonly string[], standardInputText?: string): Promise<CapturedContext> {
  const context  = contextHere(standardInputText);
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\`: ${context.errorText()}`).toBe(expectedExitCode);
  return context;
}

async function run(commandLineArguments: readonly string[], standardInputText?: string): Promise<ReturnType<typeof createCapturedCommandContext>> {
  return runExpectingExit(0, commandLineArguments, standardInputText);
}

function ticketFilePath(): string {
  const ticketsDirectory = join(repositoryDirectory, '.agent-progress', 'tickets');
  const fileName         = readdirSync(ticketsDirectory).find((name) => name.startsWith('001-'));
  if (fileName === undefined) throw new Error('no ticket file for #001');
  return join(ticketsDirectory, fileName);
}

function storedTicketText(): string {
  return readFileSync(ticketFilePath(), 'utf8');
}

/** Replaces the filed ticket's file with a hand-written one in the given line ending, the body appended as given. */
function handWriteTicket(lineEnding: '\n' | '\r\n', body: string): string {
  const frontmatterText = `${HAND_WRITTEN_FRONTMATTER_LINES.join(lineEnding)}${lineEnding}`;
  writeFileSync(ticketFilePath(), `${frontmatterText}${body}`);
  return frontmatterText;
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('ticket-edit', ['--project', 'Example Agency'], () => FROZEN_NOW);
  await run(['ticket', 'add', 'Example checkout page']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('editing a ticket body', () => {
  test('an append to a CRLF body keeps CRLF throughout, the appended LF text included, and the frontmatter bytes identical', async () => {
    const frontmatterText = handWriteTicket('\r\n', '## Report\r\n\r\nFirst reproduction.\r\n');

    const output = (await run(['ticket', 'edit', '1', '--append', '--body-file', '-'], '\n## Second reproduction\nOn Firefox too.\n')).outputText();

    expect(output).toContain('Ticket #001 body appended to');
    expect(storedTicketText()).toBe(`${frontmatterText}## Report\r\n\r\nFirst reproduction.\r\n\r\n## Second reproduction\r\nOn Firefox too.\r\n`);
  });

  test('a body holding a `---` line round-trips through a replacement and an append', async () => {
    const bodyWithRules = '## Report\n\n---\n\nBelow a rule.\n---\n';
    const frontmatterText = handWriteTicket('\n', 'Old prose.\n');

    await run(['ticket', 'edit', '1', '--body', bodyWithRules]);
    expect(storedTicketText()).toBe(`${frontmatterText}${bodyWithRules}`);
    // A value that starts like an option is passed in the `=` form.
    await run(['ticket', 'edit', '1', '--append', '--body=---\nAfter another rule.\n']);

    const shown = JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText()) as { body: string };
    expect(shown.body).toBe(`${bodyWithRules}---\nAfter another rule.\n`);
    expect(storedTicketText()).toBe(`${frontmatterText}${bodyWithRules}---\nAfter another rule.\n`);
  });

  test('an append to a body without a final newline adds exactly one before its text', async () => {
    const frontmatterText = handWriteTicket('\n', '## Report\n\nNo final newline');

    await run(['ticket', 'edit', '1', '--append', '--body', 'Appended.']);

    expect(storedTicketText()).toBe(`${frontmatterText}## Report\n\nNo final newline\nAppended.`);
  });

  test('an append to a body ending in a newline adds none of its own', async () => {
    const frontmatterText = handWriteTicket('\n', '## Report\n\nA final newline.\n');

    await run(['ticket', 'edit', '1', '--append', '--body', 'Appended.\n']);

    expect(storedTicketText()).toBe(`${frontmatterText}## Report\n\nA final newline.\nAppended.\n`);
  });

  test('an empty append exits 0 and leaves the ticket file byte-identical, even a body without a final newline', async () => {
    handWriteTicket('\r\n', 'No final newline');
    const before = storedTicketText();

    const output = (await run(['ticket', 'edit', '1', '--append', '--body-file', '-'], '')).outputText();

    expect(output).toContain('Ticket #001 body unchanged');
    expect(storedTicketText()).toBe(before);
  });

  test('an edit stamps nothing and logs nothing', async () => {
    const logBefore = storedLogTextOf(repositoryDirectory);
    const before    = JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText()) as { updated: string };

    await run(['ticket', 'edit', '1', '--body', 'Replaced prose.\n']);

    const after = JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText()) as { updated: string; body: string };
    expect(after.updated).toBe(before.updated);
    expect(after.body).toBe('Replaced prose.\n');
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });

  test('an empty replacement, no text at all, both text options and a missing ticket are refused, writing nothing', async () => {
    const before = storedTicketText();

    expect((await runExpectingExit(1, ['ticket', 'edit', '1', '--body', '  \n'])).errorText()).toContain('An empty body would erase');
    expect((await runExpectingExit(1, ['ticket', 'edit', '1', '--append'])).errorText()).toContain('needs --title, --body or --body-file');
    expect((await runExpectingExit(1, ['ticket', 'edit', '1', '--body', 'x', '--body-file', '-'])).errorText()).toContain('not both');
    expect((await runExpectingExit(1, ['ticket', 'edit', '9', '--body', 'x'])).errorText()).toContain('There is no readable ticket 9');

    expect(storedTicketText()).toBe(before);
  });
});

describeWhenGitIsPresent('renaming a ticket', () => {
  function storedRowNames(): string[] {
    const progress = JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as { tasks: Array<{ name: string }> };
    return progress.tasks.map((task) => task.name);
  }

  test('a new title rewrites only the title line, keeps the file path, renames the own row but not a review bar, stamps nothing and logs once', async () => {
    await run(['ticket', 'start', '1']);
    await run(['ticket', 'finish', '1', '--start-review']);
    const filePathBefore = ticketFilePath();
    const textBefore     = storedTicketText();
    const logBefore      = storedLogTextOf(repositoryDirectory);
    expect(storedRowNames()).toEqual(['#001 Example checkout page', 'Review 1 #001 — Example checkout page']);

    const output = (await run(['ticket', 'edit', '1', '--title', 'Example payment page'])).outputText();

    expect(output).toContain('Ticket #001 renamed: Example checkout page → Example payment page');
    expect(ticketFilePath()).toBe(filePathBefore);
    expect(storedTicketText()).toBe(textBefore
      .replace('title: "Example checkout page"', 'title: "Example payment page"')
      .replace('# 001 — Example checkout page', '# 001 — Example payment page'));
    expect(storedRowNames()).toEqual(['#001 Example payment page', 'Review 1 #001 — Example checkout page']);
    const addedLogLines = storedLogTextOf(repositoryDirectory).slice(logBefore.length).trim().split('\n');
    expect(addedLogLines).toHaveLength(1);
    expect(JSON.parse(addedLogLines[0] ?? '')).toMatchObject({ kind: 'ticket-retitled', ticketId: '001', fields: { from: 'Example checkout page', to: 'Example payment page' } });
  });

  test('a hand-written CRLF frontmatter keeps every byte but its title line, and a hand-changed heading is kept', async () => {
    const body = '# 001 — Example checkout page, as I call it\r\n\r\n## Report\r\n';
    const frontmatterText = handWriteTicket('\r\n', body);

    await run(['ticket', 'edit', '1', '--title', 'Example payment page']);

    expect(storedTicketText()).toBe(`${frontmatterText.replace('title: "Example checkout page"', 'title: "Example payment page"')}${body}`);
  });

  test('the generated heading follows the title and no other body byte changes', async () => {
    const body = '# 001 — Example checkout page\n\nSee # 001 — Example checkout page.\n';
    handWriteTicket('\n', body);

    await run(['ticket', 'edit', '1', '--title', 'Example payment page']);

    const shown = JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText()) as { title: string; body: string; updated: string };
    expect(shown.title).toBe('Example payment page');
    expect(shown.body).toBe('# 001 — Example payment page\n\nSee # 001 — Example checkout page.\n');
    expect(shown.updated).toBe('2026-09-20T10:00:00+02:00');
  });

  test('a title and an append apply in one write and one log line', async () => {
    handWriteTicket('\n', '## Report\n');
    const logBefore = storedLogTextOf(repositoryDirectory);

    const edited = await run(['ticket', 'edit', '1', '--title', 'Example payment page', '--append', '--body', 'Appended.\n', '--json']);
    const shown  = JSON.parse(edited.outputText()) as { title: string; body: string };

    expect(shown.title).toBe('Example payment page');
    expect(shown.body).toBe('## Report\nAppended.\n');
    expect(storedLogTextOf(repositoryDirectory).slice(logBefore.length).trim().split('\n')).toHaveLength(1);
  });

  test('an empty title is refused at exit 1 and the same title exits 0, each writing nothing', async () => {
    const before    = storedTicketText();
    const logBefore = storedLogTextOf(repositoryDirectory);

    expect((await runExpectingExit(1, ['ticket', 'edit', '1', '--title', '  '])).errorText()).toContain('empty --title');
    expect((await runExpectingExit(1, ['ticket', 'edit', '1'])).errorText()).toContain('needs --title, --body or --body-file');
    expect((await run(['ticket', 'edit', '1', '--title', 'Example checkout page'])).outputText()).toContain('Ticket #001 unchanged: nothing to write');

    expect(storedTicketText()).toBe(before);
    expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  });
});

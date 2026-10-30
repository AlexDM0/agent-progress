/**
 * `draft` as the command surface sees it. What matters: an open writes the draft file with the request byte for byte and stores the id
 * counter, which is never wound back; a claim another owner holds is refused with every stored file as it was, and taken with `--force`;
 * a close needs every ticket to exist; a tracker that never opens a draft keeps `progress.json` byte for byte and gains no folder; and a
 * malformed draft file is reported, never thrown, while every other command keeps working.
 */
import {
  existsSync,
  mkdirSync,
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
import { PRODUCT_NAMES }                      from '../../src/shared/constants/ProductNames.ts';
import { removeScratchDirectory }             from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../src/testing/ToolGuard.ts';
import { createCapturedCommandContext }       from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../testing/InitializedScratchRepository.ts';
import { runCommandLineWithOverseerMoves }    from '../testing/OverseerTicketMoves.ts';

const FROZEN_NOW = new Date('2026-10-24T20:01:45Z');

/** Line endings, a trailing blank line and characters JSON escapes: what a byte-for-byte request has to survive. */
const EXAMPLE_REQUEST = 'Alex Example asks: "file the export feature"\r\n\twith a tab, a \\ and ünïcode\n\n';

type CapturedContext = ReturnType<typeof createCapturedCommandContext>;

let repositoryDirectory = '';

async function runExpectingExit(expectedExitCode: number, commandLineArguments: readonly string[], standardInputText?: string): Promise<CapturedContext> {
  const context  = createCapturedCommandContext({
    currentDirectory: repositoryDirectory,
    now:              () => FROZEN_NOW,
    ...(standardInputText === undefined ? {} : { standardInputText }),
  });
  const exitCode = await runCommandLineWithOverseerMoves(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\`: ${context.errorText()}`).toBe(expectedExitCode);
  return context;
}

async function run(commandLineArguments: readonly string[], standardInputText?: string): Promise<CapturedContext> {
  return runExpectingExit(0, commandLineArguments, standardInputText);
}

async function jsonOf(commandLineArguments: readonly string[]): Promise<unknown> {
  return JSON.parse((await run([...commandLineArguments, '--json'])).outputText()) as unknown;
}

const trackerDirectory = (): string => join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER);
const draftsDirectory  = (): string => join(trackerDirectory(), 'filing-cabinet');
const draftFilePath    = (draftId: string): string => join(draftsDirectory(), `${draftId}.json`);

function storedJsonOf(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** Every stored file under the tracker but the page and its stamp. */
function storedFiles(): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const relativePath of readdirSync(trackerDirectory(), { recursive: true, encoding: 'utf8' })) {
    if (relativePath.endsWith('.json') || relativePath.endsWith('.jsonl') || relativePath.endsWith('.md')) {
      stored[relativePath] = readFileSync(join(trackerDirectory(), relativePath), 'utf8');
    }
  }
  return stored;
}

function logKinds(): string[] {
  const lines = readFileSync(join(trackerDirectory(), 'log.jsonl'), 'utf8').split('\n').filter((line) => line !== '');
  return lines.map((line) => (JSON.parse(line) as { kind: string }).kind);
}

beforeEach(async () => {
  // The real path, as the CLI reports it: a scratch directory under a symlinked temporary folder prints otherwise.
  repositoryDirectory = realpathSync(await createInitializedScratchRepository('draft-command', ['--project', 'Example Agency'], () => FROZEN_NOW));
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('draft', () => {
  test('a tracker that never opens a draft keeps progress.json byte for byte through status and ticket add, and gains no folder', async () => {
    const progressPath = join(trackerDirectory(), 'progress.json');
    const before       = readFileSync(progressPath, 'utf8');
    await run(['status', '--json']);
    await run(['draft', 'list']);
    expect(readFileSync(progressPath, 'utf8')).toBe(before);

    // A ticket add files a row, so the rows and the task counter change; every other key keeps its place and value, and no draft key comes.
    await run(['ticket', 'add', '--type', 'ticket', 'Example cart']);
    const afterTicket = readFileSync(progressPath, 'utf8');
    const withoutRows = (text: string): unknown => ({ ...JSON.parse(text) as Record<string, unknown>, tasks: null, nextTaskId: null });
    expect(JSON.stringify(withoutRows(afterTicket))).toBe(JSON.stringify(withoutRows(before)));
    expect(afterTicket).not.toContain('nextDraftId');
    await run(['status', '--json']);
    expect(readFileSync(progressPath, 'utf8')).toBe(afterTicket);
    expect(existsSync(draftsDirectory())).toBe(false);
  });

  test('draft open writes D1 with the title, the request byte for byte and the claim, stores nextDraftId, logs once and prints D1', async () => {
    const logLengthBefore = logKinds().length;
    const opened          = await run(['draft', 'open', 'Example feature', '--owner', 'opus', '--request-file', '-'], EXAMPLE_REQUEST);

    expect(opened.outputText().trim()).toBe('D1');
    const stored = storedJsonOf(draftFilePath('D1'));
    expect(stored).toEqual({
      version:            1,
      id:                 'D1',
      title:              'Example feature',
      request:            EXAMPLE_REQUEST,
      openedAt:           stored['openedAt'],
      claim:              { owner: 'opus', claimedAt: stored['openedAt'] },
      notes:              [],
      questions:          [],
      nextNoteNumber:     1,
      nextQuestionNumber: 1,
    });
    expect(storedJsonOf(join(trackerDirectory(), 'progress.json'))['nextDraftId']).toBe(2);
    expect(logKinds().slice(logLengthBefore)).toEqual(['draft-opened']);
  });

  test('draft open --json prints the stored draft, and show --json prints it back whole', async () => {
    const opened = await jsonOf(['draft', 'open', 'Example feature', '--owner', 'opus', '--request', 'Export the cart']);
    expect(opened).toEqual(storedJsonOf(draftFilePath('D1')));
    expect(await jsonOf(['draft', 'show', 'D1'])).toEqual(opened);
    expect(await jsonOf(['draft', 'list'])).toEqual([opened]);
  });

  test('no draft id is reused: after D2 is abandoned the next open makes D3, and after D3 is closed the next makes D4', async () => {
    await run(['ticket', 'add', '--type', 'ticket', 'Example cart']);
    await run(['draft', 'open', 'First', '--owner', 'opus']);
    expect((await run(['draft', 'open', 'Second', '--owner', 'opus'])).outputText().trim()).toBe('D2');
    await run(['draft', 'abandon', 'D2', '--reason', 'Merged into D1']);
    expect((await run(['draft', 'open', 'Third', '--owner', 'opus'])).outputText().trim()).toBe('D3');
    await run(['draft', 'close', 'D3', '--tickets', '1']);
    expect((await run(['draft', 'open', 'Fourth', '--owner', 'opus'])).outputText().trim()).toBe('D4');
  });

  test('a claim another owner holds is refused at exit 1 with every stored file as it was, and taken with --force', async () => {
    await run(['draft', 'open', 'Example feature', '--owner', 'opus']);
    const before = storedFiles();

    const refused = await runExpectingExit(1, ['draft', 'claim', 'D1', '--owner', 'other']);
    expect(refused.errorText()).toContain('opus holds it');
    expect(storedFiles()).toEqual(before);

    await run(['draft', 'claim', 'D1', '--owner', 'other', '--force']);
    expect(storedJsonOf(draftFilePath('D1'))['claim']).toEqual({ owner: 'other', claimedAt: expect.any(String) as unknown });
    const takeover = readFileSync(join(trackerDirectory(), 'log.jsonl'), 'utf8').trim().split('\n').at(-1) ?? '';
    expect(JSON.parse(takeover)).toMatchObject({ kind: 'draft-claimed', draftId: 'D1', fields: { owner: 'other', takenFrom: 'opus' } });
  });

  test('a released draft is unclaimed, and a plain claim then takes it', async () => {
    await run(['draft', 'open', 'Example feature', '--owner', 'opus']);
    await run(['draft', 'release', 'D1']);
    expect(storedJsonOf(draftFilePath('D1'))['claim']).toBeNull();
    await run(['draft', 'claim', 'D1', '--owner', 'other']);
    expect(storedJsonOf(draftFilePath('D1'))['claim']).toMatchObject({ owner: 'other' });
    expect(logKinds().slice(-3)).toEqual(['draft-opened', 'draft-released', 'draft-claimed']);
  });

  test('draft close removes the file and logs the ticket ids; a missing ticket is refused at exit 1 with nothing written', async () => {
    await run(['ticket', 'add', '--type', 'ticket', 'Example cart']);
    await run(['ticket', 'add', '--type', 'ticket', 'Example search']);
    await run(['draft', 'open', 'Example feature', '--owner', 'opus']);
    const before = storedFiles();

    const refused = await runExpectingExit(1, ['draft', 'close', 'D1', '--tickets', '1,9']);
    expect(refused.errorText()).toContain('there is no ticket 9');
    expect(storedFiles()).toEqual(before);

    await run(['draft', 'close', 'D1', '--tickets', '1,2']);
    expect(existsSync(draftFilePath('D1'))).toBe(false);
    const closed = readFileSync(join(trackerDirectory(), 'log.jsonl'), 'utf8').trim().split('\n').at(-1) ?? '';
    expect(JSON.parse(closed)).toMatchObject({ kind: 'draft-closed', draftId: 'D1', fields: { ticketIds: ['001', '002'] } });
  });

  test('draft abandon removes the file, logging the reason, and is refused at exit 1 without --reason', async () => {
    await run(['draft', 'open', 'Example feature', '--owner', 'opus']);
    const before = storedFiles();
    await runExpectingExit(1, ['draft', 'abandon', 'D1']);
    expect(storedFiles()).toEqual(before);

    await run(['draft', 'abandon', 'D1', '--reason', 'The user withdrew it']);
    expect(existsSync(draftFilePath('D1'))).toBe(false);
    const abandoned = readFileSync(join(trackerDirectory(), 'log.jsonl'), 'utf8').trim().split('\n').at(-1) ?? '';
    expect(JSON.parse(abandoned)).toMatchObject({ kind: 'draft-abandoned', draftId: 'D1', fields: { reason: 'The user withdrew it' } });
  });

  test('an unknown or malformed draft id is refused at exit 1', async () => {
    await runExpectingExit(1, ['draft', 'show', 'D7']);
    await runExpectingExit(1, ['draft', 'claim', 'D01', '--owner', 'opus']);
    await runExpectingExit(1, ['draft', 'release', '7']);
  });

  test('both status --json documents list open drafts in drafts, empty when none, and the page carries the same list', async () => {
    expect(((await jsonOf(['status'])) as { drafts: unknown }).drafts).toEqual([]);
    expect(((await jsonOf(['status', '--full'])) as { drafts: unknown }).drafts).toEqual([]);

    await run(['draft', 'open', 'Example feature', '--owner', 'opus']);
    await run(['draft', 'open', 'Example search', '--owner', 'opus']);
    await run(['draft', 'release', 'D2']);
    const expected = [
      {
        id: 'D1', title: 'Example feature', claimOwner: 'opus', openedAt: expect.any(String) as unknown, state: 'researching', openQuestionCount: 0, questions: []
      },
      {
        id: 'D2', title: 'Example search', claimOwner: null, openedAt: expect.any(String) as unknown, state: 'resumable', openQuestionCount: 0, questions: []
      },
    ];
    expect(((await jsonOf(['status'])) as { drafts: unknown }).drafts).toEqual(expected);
    expect(((await jsonOf(['status', '--full'])) as { drafts: unknown }).drafts).toEqual(expected);
  });

  test('a malformed draft file is reported by status and draft list, never thrown, and other commands keep working', async () => {
    await run(['draft', 'open', 'Example feature', '--owner', 'opus']);
    mkdirSync(draftsDirectory(), { recursive: true });
    const malformedFiles = {
      D5: 'not JSON',
      D6: JSON.stringify({
        version: 1, id: 'D6', title: 'No request', openedAt: 'x', claim: null
      }),
      D7: JSON.stringify({
        version: 0, id: 'D7', title: 'Older', request: '', openedAt: 'x', claim: null
      }),
      D8: JSON.stringify({
        version: 2, id: 'D8', title: 'Newer', request: '', openedAt: 'x', claim: null
      }),
    };
    for (const [draftId, text] of Object.entries(malformedFiles)) writeFileSync(draftFilePath(draftId), text);

    const status = await run(['status', '--json']);
    for (const draftId of Object.keys(malformedFiles)) expect(status.errorText()).toContain(`Draft file ignored: ${draftFilePath(draftId)}`);
    expect(status.errorText()).toContain(`${PRODUCT_NAMES.PROGRAM} update`);
    expect((JSON.parse(status.outputText()) as { drafts: Array<{ id: string }> }).drafts.map((draft) => draft.id)).toEqual(['D1']);

    const listing = await run(['draft', 'list']);
    expect(listing.errorText()).toContain(`Draft file ignored: ${draftFilePath('D5')}`);
    await run(['ticket', 'add', '--type', 'ticket', 'Example cart']);
    await run(['draft', 'claim', 'D1', '--owner', 'opus']);
  });

  test('draft open refuses to overwrite a malformed file at the new id, and keeps unknown keys of a draft it rewrites', async () => {
    mkdirSync(draftsDirectory(), { recursive: true });
    writeFileSync(draftFilePath('D1'), 'not JSON');
    await runExpectingExit(1, ['draft', 'open', 'Example feature', '--owner', 'opus']);
    expect(readFileSync(draftFilePath('D1'), 'utf8')).toBe('not JSON');

    writeFileSync(draftFilePath('D1'), JSON.stringify({
      version:            1,
      id:                 'D1',
      title:              'Kept',
      request:            'r',
      openedAt:           'x',
      claim:              null,
      sources:            ['kept'],
      notes:              [],
      questions:          [],
      nextNoteNumber:     1,
      nextQuestionNumber: 1,
      answers:            { a: 1 },
    }));
    await run(['draft', 'claim', 'D1', '--owner', 'opus']);
    expect(Object.keys(storedJsonOf(draftFilePath('D1')))).toEqual([
      'version', 'id', 'title', 'request', 'openedAt', 'claim', 'notes', 'questions', 'nextNoteNumber', 'nextQuestionNumber', 'sources', 'answers',
    ]);
    expect(storedJsonOf(draftFilePath('D1'))['answers']).toEqual({ a: 1 });
  });
});

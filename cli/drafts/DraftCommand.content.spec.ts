/**
 * What a draft holds besides its request, as the command surface sees it. What matters: notes and questions are numbered per kind and a
 * number is never reused, not after a drop; every refusal (option count, letters, a missing question, an open question at close) leaves
 * every stored file byte for byte; an answer is option letters or free text and the log keeps each one; and the derived state, the
 * open-question count and the question tree read the same in `draft show --json`, `status --json` and the page's `boardFacts`.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join }                                    from 'node:path';

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

type CapturedContext = ReturnType<typeof createCapturedCommandContext>;

interface StoredQuestion {
  id:          string;
  options:     Array<{ letter: string; text: string }>;
  multiple:    boolean;
  recommended: string[];
  answer:      { letters?: string[]; text?: string } | null;
  followUps:   StoredQuestion[];
}

interface StoredDraft {
  notes:     Array<{ id: string; kind: string; text: string }>;
  questions: StoredQuestion[];
}

interface ListedDraft {
  id:                string;
  state:             string;
  openQuestionCount: number;
  questions:         StoredQuestion[];
}

let repositoryDirectory = '';

async function runExpectingExit(expectedExitCode: number, commandLineArguments: readonly string[]): Promise<CapturedContext> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLineWithOverseerMoves(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\`: ${context.errorText()}`).toBe(expectedExitCode);
  return context;
}

async function run(commandLineArguments: readonly string[]): Promise<CapturedContext> {
  return runExpectingExit(0, commandLineArguments);
}

async function jsonOf(commandLineArguments: readonly string[]): Promise<unknown> {
  return JSON.parse((await run([...commandLineArguments, '--json'])).outputText()) as unknown;
}

async function shownDraft(draftId: string): Promise<StoredDraft> {
  return (await jsonOf(['draft', 'show', draftId])) as StoredDraft;
}

async function statusDrafts(): Promise<ListedDraft[]> {
  return ((await jsonOf(['status'])) as { drafts: ListedDraft[] }).drafts;
}

const trackerDirectory = (): string => join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER);

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

function loggedRecords(): Array<{ kind: string; draftId?: string; fields: Record<string, unknown> }> {
  const lines = readFileSync(join(trackerDirectory(), 'log.jsonl'), 'utf8').split('\n').filter((line) => line !== '');
  return lines.map((line) => JSON.parse(line) as { kind: string; fields: Record<string, unknown> });
}

async function expectRefusedWithNothingWritten(commandLineArguments: readonly string[]): Promise<CapturedContext> {
  const before  = storedFiles();
  const refused = await runExpectingExit(1, commandLineArguments);
  expect(storedFiles()).toEqual(before);
  return refused;
}

function askArguments(question: string, optionTexts: readonly string[], recommended: string, ...extra: string[]): string[] {
  return ['draft', 'ask', 'D1', question, '--context', 'Alex Example asked for it', ...optionTexts.flatMap((text) => ['--option', text]), '--recommended', recommended, ...extra];
}

beforeEach(async () => {
  repositoryDirectory = realpathSync(await createInitializedScratchRepository('draft-content', ['--project', 'Example Agency'], () => FROZEN_NOW));
  await run(['ticket', 'add', '--type', 'ticket', 'Example cart']);
  await run(['draft', 'open', 'Example feature', '--owner', 'opus']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('draft content', () => {
  test('draft note adds N1 as a fact and N2 as an assumption, both in draft show --json, each logged', async () => {
    await run(['draft', 'note', 'D1', 'The cart lives in src/cart/']);
    await run(['draft', 'note', 'D1', 'CSV is enough', '--assumption']);
    expect((await shownDraft('D1')).notes).toEqual([
      { id: 'N1', kind: 'fact', text: 'The cart lives in src/cart/' },
      { id: 'N2', kind: 'assumption', text: 'CSV is enough' },
    ]);
    expect(loggedRecords().slice(-2).map((record) => record.fields)).toEqual([{ noteId: 'N1', noteKind: 'fact' }, { noteId: 'N2', noteKind: 'assumption' }]);
  });

  test('draft ask adds Q1 with lettered options and its recommendation; a bad option count, letter or parent is refused with nothing written', async () => {
    await run(askArguments('Which format?', ['CSV', 'JSON'], 'b'));
    const [question] = (await shownDraft('D1')).questions;
    expect(question).toMatchObject({
      id: 'Q1', options: [{ letter: 'a', text: 'CSV' }, { letter: 'b', text: 'JSON' }], multiple: false, recommended: ['b'], answer: null, followUps: []
    });

    expect((await expectRefusedWithNothingWritten(askArguments('One?', ['only'], 'a'))).errorText()).toContain('2 to 4 options, and 1 was given');
    await expectRefusedWithNothingWritten(askArguments('Five?', ['1', '2', '3', '4', '5'], 'a'));
    expect((await expectRefusedWithNothingWritten(askArguments('Outside?', ['x', 'y'], 'c'))).errorText()).toContain('There is no option c');
    expect((await expectRefusedWithNothingWritten(askArguments('Orphan?', ['x', 'y'], 'a', '--under', 'Q9'))).errorText()).toContain('no question Q9');
  });

  test('a follow-up asked --under a question sits in its followUps', async () => {
    await run(askArguments('Which format?', ['CSV', 'JSON'], 'a'));
    await run(askArguments('Which delimiter?', ['comma', 'tab'], 'a', '--under', 'Q1'));
    const [question] = (await shownDraft('D1')).questions;
    expect(question?.followUps.map((followUp) => followUp.id)).toEqual(['Q2']);
    expect(loggedRecords().at(-1)?.fields).toEqual({ questionId: 'Q2', underQuestionId: 'Q1' });
  });

  test('an answer of option letters records them, free text overwrites it, both are logged, and a missing question is refused', async () => {
    await run(askArguments('Which format?', ['CSV', 'JSON'], 'a'));
    await run(['draft', 'answer', 'D1', 'Q1', 'a']);
    expect((await shownDraft('D1')).questions[0]?.answer).toMatchObject({ letters: ['a'] });
    await run(['draft', 'answer', 'D1', 'Q1', 'something else']);
    const { answer } = (await shownDraft('D1')).questions[0] ?? { answer: null };
    expect(answer).toMatchObject({ text: 'something else' });
    expect(answer).not.toHaveProperty('letters');
    expect(loggedRecords().filter((record) => record.kind === 'draft-question-answered').map((record) => record.fields['answer'])).toEqual(['a', 'something else']);

    await expectRefusedWithNothingWritten(['draft', 'answer', 'D1', 'Q7', 'a']);
  });

  test('a multi-select question takes several recommended and answered letters; a single-select one, or a letter outside, is refused', async () => {
    await run(askArguments('Which formats?', ['CSV', 'JSON', 'XML'], 'a,c', '--multiple'));
    await run(['draft', 'answer', 'D1', 'Q1', 'a,b']);
    const [multiple] = (await shownDraft('D1')).questions;
    expect(multiple).toMatchObject({ multiple: true, recommended: ['a', 'c'], answer: { letters: ['a', 'b'] } });
    expect((await statusDrafts())[0]?.questions[0]).toMatchObject({ multiple: true, answer: { letters: ['a', 'b'] } });
    await expectRefusedWithNothingWritten(['draft', 'answer', 'D1', 'Q1', 'a,d']);

    expect((await expectRefusedWithNothingWritten(askArguments('Which one?', ['x', 'y', 'z'], 'a,c'))).errorText()).toContain('the question takes one');
    await run(askArguments('Which one?', ['x', 'y', 'z'], 'a'));
    await expectRefusedWithNothingWritten(['draft', 'answer', 'D1', 'Q2', 'a,b']);
    await expectRefusedWithNothingWritten(['draft', 'answer', 'D1', 'Q2', 'd']);
  });

  test('dropping Q1 drops its follow-up Q2 too, logging each, and the next question is Q3', async () => {
    await run(askArguments('Which format?', ['CSV', 'JSON'], 'a'));
    await run(askArguments('Which delimiter?', ['comma', 'tab'], 'a', '--under', 'Q1'));
    await run(['draft', 'drop', 'D1', 'Q1']);
    expect((await shownDraft('D1')).questions).toEqual([]);
    expect(loggedRecords().slice(-2).map((record) => record.fields)).toEqual([{ itemId: 'Q1' }, { itemId: 'Q2' }]);
    await run(askArguments('Which page?', ['cart', 'checkout'], 'a'));
    expect((await shownDraft('D1')).questions.map((question) => question.id)).toEqual(['Q3']);

    await run(['draft', 'note', 'D1', 'A fact']);
    await run(['draft', 'drop', 'D1', 'N1']);
    await run(['draft', 'note', 'D1', 'Another fact']);
    expect((await shownDraft('D1')).notes.map((note) => note.id)).toEqual(['N2']);
    await expectRefusedWithNothingWritten(['draft', 'drop', 'D1', 'Q9']);
  });

  test('draft close is refused naming every open question with nothing written, and closes once they are answered or dropped', async () => {
    await run(askArguments('Which format?', ['CSV', 'JSON'], 'a'));
    await run(askArguments('Which page?', ['cart', 'checkout'], 'a'));
    await run(askArguments('Which delimiter?', ['comma', 'tab'], 'a', '--under', 'Q1'));
    await run(['draft', 'answer', 'D1', 'Q1', 'a']);

    const refused = await expectRefusedWithNothingWritten(['draft', 'close', 'D1', '--tickets', '1']);
    expect(refused.errorText()).toContain('Q2, Q3 are still open');

    await run(['draft', 'answer', 'D1', 'Q2', 'b']);
    await run(['draft', 'drop', 'D1', 'Q3']);
    await run(['draft', 'close', 'D1', '--tickets', '1']);
    expect(loggedRecords().at(-1)?.kind).toBe('draft-closed');
  });

  test('a draft with no question and no note closes at once after it opens', async () => {
    await run(['draft', 'open', 'Example blue button', '--owner', 'opus']);
    await run(['draft', 'close', 'D2', '--tickets', '1']);
  });

  test('the state reads waiting while a question is open, claimed or not, else researching while claimed and resumable once released', async () => {
    const stateOf = async (): Promise<Pick<ListedDraft, 'state' | 'openQuestionCount'> | undefined> => {
      const listed = (await statusDrafts())[0];
      return listed === undefined ? undefined : { state: listed.state, openQuestionCount: listed.openQuestionCount };
    };
    expect(await stateOf()).toEqual({ state: 'researching', openQuestionCount: 0 });
    await run(askArguments('Which format?', ['CSV', 'JSON'], 'a'));
    expect(await stateOf()).toEqual({ state: 'waiting', openQuestionCount: 1 });
    await run(['draft', 'release', 'D1']);
    expect(await stateOf()).toEqual({ state: 'waiting', openQuestionCount: 1 });
    await run(['draft', 'answer', 'D1', 'Q1', 'b']);
    expect(await stateOf()).toEqual({ state: 'resumable', openQuestionCount: 0 });
    await run(['draft', 'claim', 'D1', '--owner', 'opus']);
    expect(await stateOf()).toEqual({ state: 'researching', openQuestionCount: 0 });

    const fullDrafts = ((await jsonOf(['status', '--full'])) as { drafts: ListedDraft[] }).drafts;
    expect(fullDrafts).toEqual(await statusDrafts());
  });
});

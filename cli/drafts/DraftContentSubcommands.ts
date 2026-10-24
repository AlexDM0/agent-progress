/** `draft note`, `ask`, `answer` and `drop`: what a draft holds besides its request, each one write, refused at exit 1 with nothing written. */
import { DraftDocumentUtil }            from '../../src/adapters/drafts/utils/DraftDocumentUtil.ts';
import type { DraftChanged }            from '../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { Board }                   from '../../src/lib/tracker-model/Board.ts';
import type { CommandContext }          from '../CommandContext.ts';
import { openTrackerForWriting }        from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }          from '../arguments/ArgumentParser.ts';
import { OutputUtil }                   from '../utils/OutputUtil.ts';
import { draftIdArgumentOf, refusalOf } from './DraftChangeSubcommands.ts';
import { DRAFT_USAGE }                  from './constants/DraftUsage.ts';

const NOTE_OPTION_NAMES   = ['assumption', 'json'];
const ASK_OPTION_NAMES    = ['context', 'option', 'recommended', 'multiple', 'under', 'json'];
const ANSWER_OPTION_NAMES = ['json'];
const DROP_OPTION_NAMES   = ['json'];

const LETTER_LIST_SEPARATOR = ',';

/** The positional after the subcommand and the draft id: the note's text, the question, or the question or note number. */
const ITEM_POSITION   = 2;
const ANSWER_POSITION = ITEM_POSITION + 1;

function requiredTextAt(commandArguments: ArgumentParser, index: number, missingText: string): string {
  const text = commandArguments.positionals()[index];
  if (text === undefined || text.trim() === '') throw refusalOf(missingText);
  return text;
}

async function changeDraftContent(commandArguments: ArgumentParser, context: CommandContext, change: (board: Board, at: string) => DraftChanged): Promise<void> {
  const changed = await openTrackerForWriting(commandArguments, context, (tracker) => change(tracker.board, tracker.at));
  OutputUtil.printEntity(commandArguments, context, DraftDocumentUtil.draftDocumentOf(changed.draft), OutputUtil.loggedSentencesOf(changed.logged));
}

async function noteDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(NOTE_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(ITEM_POSITION + 1, DRAFT_USAGE);
  const draftId = draftIdArgumentOf(commandArguments, 'note');
  const text    = requiredTextAt(commandArguments, ITEM_POSITION, 'agent-progress draft note needs the text of the fact or assumption.');
  const kind    = commandArguments.flag('assumption') ? 'assumption' : 'fact';
  await changeDraftContent(commandArguments, context, (board, at) => board.addDraftNote(draftId, { text, kind }, at));
}

async function askDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ASK_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(ITEM_POSITION + 1, DRAFT_USAGE);
  const draftId  = draftIdArgumentOf(commandArguments, 'ask');
  const question = requiredTextAt(commandArguments, ITEM_POSITION, 'agent-progress draft ask needs the question.');
  const questionContext = commandArguments.option('context');
  if (questionContext === undefined || questionContext.trim() === '') throw refusalOf('agent-progress draft ask needs --context <text>, what the user needs to answer it.');
  const recommended = commandArguments.option('recommended');
  if (recommended === undefined) throw refusalOf('agent-progress draft ask needs --recommended <letters>, the option or options Claude recommends.');
  const recommendedLetters = recommended.split(LETTER_LIST_SEPARATOR).map((letter) => letter.trim()).filter((letter) => letter !== '');

  await changeDraftContent(commandArguments, context, (board, at) => board.askDraftQuestion(draftId, {
    question,
    context:         questionContext,
    optionTexts:     commandArguments.optionValues('option'),
    multiple:        commandArguments.flag('multiple'),
    recommendedLetters,
    underQuestionId: commandArguments.option('under') ?? null,
  }, at));
}

async function answerDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ANSWER_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(ANSWER_POSITION + 1, DRAFT_USAGE);
  const draftId    = draftIdArgumentOf(commandArguments, 'answer');
  const questionId = requiredTextAt(commandArguments, ITEM_POSITION, 'agent-progress draft answer needs the question number, such as Q1.');
  const answer     = requiredTextAt(commandArguments, ANSWER_POSITION, 'agent-progress draft answer needs the answer: option letters such as a or a,c, or free text.');
  await changeDraftContent(commandArguments, context, (board, at) => board.answerDraftQuestion(draftId, questionId, answer, at));
}

async function dropDraftItem(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(DROP_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(ITEM_POSITION + 1, DRAFT_USAGE);
  const draftId = draftIdArgumentOf(commandArguments, 'drop');
  const itemId  = requiredTextAt(commandArguments, ITEM_POSITION, 'agent-progress draft drop needs the note or question number, such as N1 or Q1.');
  await changeDraftContent(commandArguments, context, (board, at) => board.dropDraftItem(draftId, itemId, at));
}

export const DRAFT_CONTENT_SUBCOMMANDS = {
  note: noteDraft, ask: askDraft, answer: answerDraft, drop: dropDraftItem
} as const;

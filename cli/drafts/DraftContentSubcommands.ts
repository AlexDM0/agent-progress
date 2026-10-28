/** `draft note`, `ask`, `answer` and `drop`: what a draft holds besides its request, each one write, refused at exit 1 with nothing written. */
import { DraftDocumentUtil }                                 from '../../src/adapters/drafts/utils/DraftDocumentUtil.ts';
import type { ControlCommandOf }                             from '../../src/shared/@types/ControlCommand.ts';
import { PRODUCT_NAMES }                                     from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                               from '../CommandContext.ts';
import type { ArgumentParser }                               from '../arguments/ArgumentParser.ts';
import { OutputUtil }                                        from '../utils/OutputUtil.ts';
import { appliedDraftControl, draftIdArgumentOf, refusalOf } from './DraftChangeSubcommands.ts';
import { DRAFT_USAGE }                                       from './constants/DraftUsage.ts';

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

async function changeDraftContent(
  commandArguments: ArgumentParser,
  context: CommandContext,
  command: ControlCommandOf<'draft-note' | 'draft-ask' | 'draft-answer' | 'draft-drop'>,
): Promise<void> {
  const changed = await appliedDraftControl(commandArguments, context, command);
  OutputUtil.printEntity(commandArguments, context, DraftDocumentUtil.draftDocumentOf(changed.draft), OutputUtil.loggedSentencesOf(changed.logged));
}

async function noteDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(NOTE_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(ITEM_POSITION + 1, DRAFT_USAGE);
  const draftId = draftIdArgumentOf(commandArguments, 'note');
  const text    = requiredTextAt(commandArguments, ITEM_POSITION, `${PRODUCT_NAMES.PROGRAM} draft note needs the text of the fact or assumption.`);
  const noteKind = commandArguments.flag('assumption') ? 'assumption' : 'fact';
  await changeDraftContent(commandArguments, context, {
    kind: 'draft-note', draftId, text, noteKind
  });
}

async function askDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ASK_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(ITEM_POSITION + 1, DRAFT_USAGE);
  const draftId  = draftIdArgumentOf(commandArguments, 'ask');
  const question = requiredTextAt(commandArguments, ITEM_POSITION, `${PRODUCT_NAMES.PROGRAM} draft ask needs the question.`);
  const questionContext = commandArguments.option('context');
  if (questionContext === undefined || questionContext.trim() === '') {
    throw refusalOf(`${PRODUCT_NAMES.PROGRAM} draft ask needs --context <text>, what the user needs to answer it.`);
  }
  const recommended = commandArguments.option('recommended');
  if (recommended === undefined) throw refusalOf(`${PRODUCT_NAMES.PROGRAM} draft ask needs --recommended <letters>, the option or options Claude recommends.`);
  const recommendedLetters = recommended.split(LETTER_LIST_SEPARATOR).map((letter) => letter.trim()).filter((letter) => letter !== '');

  await changeDraftContent(commandArguments, context, {
    kind:   'draft-ask',
    draftId,
    asking: {
      question,
      context:         questionContext,
      optionTexts:     commandArguments.optionValues('option'),
      multiple:        commandArguments.flag('multiple'),
      recommendedLetters,
      underQuestionId: commandArguments.option('under') ?? null,
    },
  });
}

async function answerDraft(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ANSWER_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(ANSWER_POSITION + 1, DRAFT_USAGE);
  const draftId    = draftIdArgumentOf(commandArguments, 'answer');
  const questionId = requiredTextAt(commandArguments, ITEM_POSITION, `${PRODUCT_NAMES.PROGRAM} draft answer needs the question number, such as Q1.`);
  const answer     = requiredTextAt(commandArguments, ANSWER_POSITION, `${PRODUCT_NAMES.PROGRAM} draft answer needs the answer: option letters such as a or a,c, or free text.`);
  await changeDraftContent(commandArguments, context, {
    kind: 'draft-answer', draftId, questionId, answer
  });
}

async function dropDraftItem(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(DROP_OPTION_NAMES, DRAFT_USAGE);
  commandArguments.rejectExtraPositionals(ITEM_POSITION + 1, DRAFT_USAGE);
  const draftId = draftIdArgumentOf(commandArguments, 'drop');
  const itemId  = requiredTextAt(commandArguments, ITEM_POSITION, `${PRODUCT_NAMES.PROGRAM} draft drop needs the note or question number, such as N1 or Q1.`);
  await changeDraftContent(commandArguments, context, { kind: 'draft-drop', draftId, itemId });
}

export const DRAFT_CONTENT_SUBCOMMANDS = {
  note: noteDraft, ask: askDraft, answer: answerDraft, drop: dropDraftItem
} as const;

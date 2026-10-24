/**
 * What a draft holds besides its request: research notes and assumptions, and the question tree with its answers. None of it looks at the
 * claim, so any session, or the dashboard, may answer.
 */
import type { DraftChanged } from './@types/BoardChanges.ts';
import type {
  DraftAnswer,
  DraftNoteAddition,
  DraftQuestion,
  DraftQuestionAsking
} from './@types/Draft.ts';
import type { BoardRecords }       from './BoardRecords.ts';
import { BoardRefusal }            from './BoardRefusal.ts';
import type { Drafts }             from './Drafts.ts';
import {
  DRAFT_NOTE_PREFIX,
  DRAFT_OPTION_LETTERS,
  DRAFT_QUESTION_PREFIX,
  MINIMUM_DRAFT_QUESTION_OPTIONS
}                                                                                    from './constants/DraftFields.ts';
import { DraftQuestionTreeUtil } from './utils/DraftQuestionTreeUtil.ts';

export class DraftContents {
  constructor(private readonly records: BoardRecords, private readonly drafts: Drafts) {}

  addDraftNote(draftId: string, addition: DraftNoteAddition, at: string): DraftChanged {
    const draft  = this.drafts.requireDraft(draftId);
    const noteId = `${DRAFT_NOTE_PREFIX}${draft.nextNoteNumber}`;
    draft.notes.push({ id: noteId, kind: addition.kind, text: addition.text });
    draft.nextNoteNumber += 1;
    this.records.markDraftChanged(draft);
    return { logged: [this.records.logger.log({ kind: 'draft-note-added', draftId, fields: { noteId, noteKind: addition.kind } }, at)], draft };
  }

  askDraftQuestion(draftId: string, asking: DraftQuestionAsking, at: string): DraftChanged {
    const draft       = this.drafts.requireDraft(draftId);
    const optionCount = asking.optionTexts.length;
    if (optionCount < MINIMUM_DRAFT_QUESTION_OPTIONS || optionCount > DRAFT_OPTION_LETTERS.length) {
      throw new BoardRefusal({
        reason: 'draft-question-option-count', draftId, optionCount, minimum: MINIMUM_DRAFT_QUESTION_OPTIONS, maximum: DRAFT_OPTION_LETTERS.length
      });
    }
    const parent = asking.underQuestionId === null ? undefined : DraftQuestionTreeUtil.questionById(draft.questions, asking.underQuestionId);
    if (asking.underQuestionId !== null && parent === undefined) throw new BoardRefusal({ reason: 'unknown-draft-question', draftId, questionId: asking.underQuestionId });

    const options       = asking.optionTexts.map((text, index) => ({ letter: DRAFT_OPTION_LETTERS[index] ?? '', text }));
    const optionLetters = options.map((option) => option.letter);
    const recommended   = [...new Set(asking.recommendedLetters)];
    if (recommended.length === 0) throw new BoardRefusal({ reason: 'draft-question-without-recommendation', draftId });
    this.refuseLettersOutside(draftId, recommended, optionLetters, asking.multiple);

    const questionId = `${DRAFT_QUESTION_PREFIX}${draft.nextQuestionNumber}`;
    const question: DraftQuestion = {
      id:        questionId,
      question:  asking.question,
      context:   asking.context,
      options,
      multiple:  asking.multiple,
      recommended,
      answer:    null,
      followUps: [],
    };
    (parent?.followUps ?? draft.questions).push(question);
    draft.nextQuestionNumber += 1;
    this.records.markDraftChanged(draft);
    const fields = asking.underQuestionId === null ? { questionId } : { questionId, underQuestionId: asking.underQuestionId };
    return { logged: [this.records.logger.log({ kind: 'draft-question-asked', draftId, fields }, at)], draft };
  }

  /** A comma-separated list of option letters chooses those options; anything else is free text. Answering again overwrites the answer. */
  answerDraftQuestion(draftId: string, questionId: string, answerText: string, at: string): DraftChanged {
    const draft    = this.drafts.requireDraft(draftId);
    const question = DraftQuestionTreeUtil.questionById(draft.questions, questionId);
    if (question === undefined) throw new BoardRefusal({ reason: 'unknown-draft-question', draftId, questionId });

    const letters = DraftQuestionTreeUtil.optionLettersIn(answerText);
    if (letters !== null) this.refuseLettersOutside(draftId, letters, question.options.map((option) => option.letter), question.multiple);
    const answer: DraftAnswer = letters === null ? { text: answerText, answeredAt: at } : { letters, answeredAt: at };
    question.answer           = answer;
    this.records.markDraftChanged(draft);
    const loggedAnswer = letters === null ? answerText : letters.join(',');
    return { logged: [this.records.logger.log({ kind: 'draft-question-answered', draftId, fields: { questionId, answer: loggedAnswer } }, at)], draft };
  }

  /** Dropping a question drops its follow-ups too, each logged; the numbers stay taken. */
  dropDraftItem(draftId: string, itemId: string, at: string): DraftChanged {
    const draft     = this.drafts.requireDraft(draftId);
    const noteIndex = draft.notes.findIndex((note) => note.id === itemId);
    let droppedItemIds: string[];
    if (noteIndex !== -1) {
      draft.notes.splice(noteIndex, 1);
      droppedItemIds = [itemId];
    } else {
      const removed = DraftQuestionTreeUtil.removeQuestion(draft.questions, itemId);
      if (removed === undefined) throw new BoardRefusal({ reason: 'unknown-draft-item', draftId, itemId });
      droppedItemIds = DraftQuestionTreeUtil.everyQuestionIn([removed]).map((question) => question.id);
    }
    this.records.markDraftChanged(draft);
    const logged = droppedItemIds.map((droppedItemId) => this.records.logger.log({ kind: 'draft-item-dropped', draftId, fields: { itemId: droppedItemId } }, at));
    return { logged, draft };
  }

  private refuseLettersOutside(draftId: string, letters: readonly string[], optionLetters: readonly string[], multiple: boolean): void {
    const unknownLetters = letters.filter((letter) => !optionLetters.includes(letter));
    if (unknownLetters.length > 0) throw new BoardRefusal({
      reason: 'unknown-draft-option-letters', draftId, unknownLetters, optionLetters
    });
    if (!multiple && letters.length > 1) throw new BoardRefusal({ reason: 'several-letters-on-single-select-question', draftId, letters });
  }
}

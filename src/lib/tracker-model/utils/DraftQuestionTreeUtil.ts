/** A draft's question tree walked depth first, parents before their follow-ups, and an answer's text read as option letters or free text. */
import type { DraftQuestion }                          from '../@types/Draft.ts';
import { DRAFT_OPTION_LETTERS, DRAFT_QUESTION_PREFIX } from '../constants/DraftFields.ts';

const LETTER_LIST_SEPARATOR = ',';

function everyQuestionIn(questions: readonly DraftQuestion[]): DraftQuestion[] {
  return questions.flatMap((question) => [question, ...everyQuestionIn(question.followUps)]);
}

function questionById(questions: readonly DraftQuestion[], questionId: string): DraftQuestion | undefined {
  return everyQuestionIn(questions).find((question) => question.id === questionId);
}

/** In number order, wherever each sits in the tree. */
function openQuestionIdsOf(questions: readonly DraftQuestion[]): string[] {
  const numberOf = (questionId: string): number => Number(questionId.slice(DRAFT_QUESTION_PREFIX.length));
  return everyQuestionIn(questions)
    .filter((question) => question.answer === null)
    .map((question) => question.id)
    .sort((a, b) => numberOf(a) - numberOf(b));
}

/** Removes the question with its follow-ups from wherever it sits in the tree, and returns it, or undefined when the tree has no such question. */
function removeQuestion(questions: DraftQuestion[], questionId: string): DraftQuestion | undefined {
  const index = questions.findIndex((question) => question.id === questionId);
  if (index !== -1) return questions.splice(index, 1)[0];
  for (const question of questions) {
    const removed = removeQuestion(question.followUps, questionId);
    if (removed !== undefined) return removed;
  }
  return undefined;
}

/**
 * The letters a comma-separated list names, duplicates dropped, or null when the text is anything else, which is then free text. Any letter
 * an option can have counts, so `c` on a two-option question reads as a letter for the caller to refuse.
 */
function optionLettersIn(text: string): string[] | null {
  const parts = text.split(LETTER_LIST_SEPARATOR).map((part) => part.trim());
  const possibleLetters: readonly string[] = DRAFT_OPTION_LETTERS;
  if (!parts.every((part) => possibleLetters.includes(part))) return null;
  return [...new Set(parts)];
}

export const DraftQuestionTreeUtil = {
  everyQuestionIn,
  questionById,
  openQuestionIdsOf,
  removeQuestion,
  optionLettersIn,
} as const;

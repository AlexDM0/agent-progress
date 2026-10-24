/** A draft file's notes and question tree read from their stored JSON: undefined for any value of the wrong shape, never a throw. */
import { JsonRecordUtil } from '../../../lib/json-record/JsonRecordUtil.ts';
import type {
  DraftAnswer,
  DraftNote,
  DraftNoteKind,
  DraftQuestion,
  DraftQuestionOption
}                         from '../../../lib/tracker-model/@types/Draft.ts';

const NOTE_KINDS: readonly string[] = ['fact', 'assumption'] satisfies DraftNoteKind[];

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function listOf<Item>(value: unknown, itemOf: (item: unknown) => Item | undefined): Item[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: Item[] = [];
  for (const item of value) {
    const parsed = itemOf(item);
    if (parsed === undefined) return undefined;
    items.push(parsed);
  }
  return items;
}

function noteOf(value: unknown): DraftNote | undefined {
  const note = JsonRecordUtil.recordOf(value);
  if (note === undefined) return undefined;
  const { id, kind, text } = note;
  if (!isText(id) || !isText(kind) || !NOTE_KINDS.includes(kind) || !isText(text)) return undefined;
  return { id, kind: kind as DraftNoteKind, text };
}

function optionOf(value: unknown): DraftQuestionOption | undefined {
  const option = JsonRecordUtil.recordOf(value);
  if (option === undefined || !isText(option['letter']) || !isText(option['text'])) return undefined;
  return { letter: option['letter'], text: option['text'] };
}

function answerOf(value: unknown): DraftAnswer | null | undefined {
  if (value === null) return null;
  const answer = JsonRecordUtil.recordOf(value);
  if (answer === undefined) return undefined;
  const { answeredAt, text } = answer;
  if (!isText(answeredAt)) return undefined;
  if (isText(text)) return { text, answeredAt };
  const letters = listOf(answer['letters'], (letter) => (isText(letter) ? letter : undefined));
  return letters === undefined ? undefined : { letters, answeredAt };
}

function questionOf(value: unknown): DraftQuestion | undefined {
  const stored = JsonRecordUtil.recordOf(value);
  if (stored === undefined) return undefined;
  const {
    id, question, context, multiple
  } = stored;
  if (!isText(id) || !isText(question) || !isText(context) || typeof multiple !== 'boolean') return undefined;
  const options     = listOf(stored['options'], optionOf);
  const recommended = listOf(stored['recommended'], (letter) => (isText(letter) ? letter : undefined));
  const answer      = answerOf(stored['answer']);
  const followUps   = listOf(stored['followUps'], questionOf);
  if (options === undefined || recommended === undefined || answer === undefined || followUps === undefined) return undefined;
  return {
    id, question, context, options, multiple, recommended, answer, followUps
  };
}

function notesOf(value: unknown): DraftNote[] | undefined {
  return listOf(value, noteOf);
}

function questionsOf(value: unknown): DraftQuestion[] | undefined {
  return listOf(value, questionOf);
}

export const DraftContentParsingUtil = { notesOf, questionsOf } as const;

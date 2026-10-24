/**
 * A draft file's JSON document both ways: the text read into a draft as a verdict, never a throw, and a draft written back with `version`
 * first, then the keys the model owns, then every key it does not, in the order they were stored.
 */
import { JsonRecordUtil }             from '../../../lib/json-record/JsonRecordUtil.ts';
import type { Draft, DraftClaim }     from '../../../lib/tracker-model/@types/Draft.ts';
import { FIRST_DRAFT_ITEM_NUMBER }    from '../../../lib/tracker-model/constants/DraftFields.ts';
import { DraftIdUtil }                from '../../../lib/tracker-model/utils/DraftIdUtil.ts';
import { OLDER_FORMAT_ADVICE }        from '../../constants/OlderFormatAdvice.ts';
import { StoredValueUtil }            from '../../utils/StoredValueUtil.ts';
import { CURRENT_DRAFT_FILE_VERSION } from '../constants/DraftFileVersions.ts';
import { DraftContentParsingUtil }    from './DraftContentParsingUtil.ts';

export type DraftDocumentParsing =
  | { verdict: 'parsed'; draft: Draft }
  | { verdict: 'malformed'; reason: string };

const OWNED_KEYS = ['version', 'id', 'title', 'request', 'openedAt', 'claim', 'notes', 'questions', 'nextNoteNumber', 'nextQuestionNumber'] as const;

const INDENTATION_SPACES = 2;

function isItemNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= FIRST_DRAFT_ITEM_NUMBER;
}

function claimOf(value: unknown): DraftClaim | null | undefined {
  if (value === null) return null;
  const claim = JsonRecordUtil.recordOf(value);
  if (claim === undefined) return undefined;
  const { owner, claimedAt } = claim;
  if (typeof owner !== 'string' || owner.trim() === '' || typeof claimedAt !== 'string') return undefined;
  return { owner, claimedAt };
}

function malformed(reason: string): DraftDocumentParsing {
  return { verdict: 'malformed', reason };
}

function parsedDraftDocumentOf(text: string): DraftDocumentParsing {
  const parsing = StoredValueUtil.parsedJsonOf(text);
  if (parsing.verdict === 'unparseable') return malformed(parsing.problem);
  const document = JsonRecordUtil.recordOf(parsing.value);
  if (document === undefined) return malformed('the document is not a JSON object');

  const {
    version, id, title, request, openedAt
  } = document;
  if (version !== CURRENT_DRAFT_FILE_VERSION) {
    return malformed(`version is ${JSON.stringify(version) ?? 'missing'}, and this build of agent-progress reads version ${CURRENT_DRAFT_FILE_VERSION}; ${OLDER_FORMAT_ADVICE}`);
  }
  if (typeof id !== 'string' || DraftIdUtil.draftNumberOf(id) === null) return malformed(`id is ${JSON.stringify(id) ?? 'missing'}, and it has to be a draft id such as D1`);
  if (typeof title !== 'string' || title.trim() === '') return malformed('title is not a text that is not blank');
  if (typeof request !== 'string') return malformed('request is not a text');
  if (typeof openedAt !== 'string') return malformed('openedAt is not a timestamp');
  const claim = claimOf(document['claim']);
  if (claim === undefined) return malformed('claim is neither null nor an object holding an owner and a claimedAt');
  const notes = DraftContentParsingUtil.notesOf(document['notes']);
  if (notes === undefined) return malformed('notes is not a list of notes, each holding an id, a kind of fact or assumption, and a text');
  const questions = DraftContentParsingUtil.questionsOf(document['questions']);
  if (questions === undefined) return malformed('questions is not a list of questions, each with its options, recommendation, answer and follow-ups');
  const { nextNoteNumber, nextQuestionNumber } = document;
  if (!isItemNumber(nextNoteNumber) || !isItemNumber(nextQuestionNumber)) {
    return malformed(`nextNoteNumber and nextQuestionNumber have to be whole numbers of at least ${FIRST_DRAFT_ITEM_NUMBER}`);
  }

  const ownedKeys: readonly string[] = OWNED_KEYS;
  const extra = Object.entries(document).filter(([key]) => !ownedKeys.includes(key));
  return {
    verdict: 'parsed',
    draft:   {
      id, title, request, openedAt, claim, notes, questions, nextNoteNumber, nextQuestionNumber, extra
    },
  };
}

/** The stored document a draft file holds, which `draft show --json` prints, so a rebooted session resumes from it alone. */
function draftDocumentOf(draft: Readonly<Draft>): Record<string, unknown> {
  // `fromEntries` makes every stored key an own property, so a stored `__proto__` stays data instead of setting the prototype.
  return Object.fromEntries([
    ['version', CURRENT_DRAFT_FILE_VERSION],
    ['id', draft.id],
    ['title', draft.title],
    ['request', draft.request],
    ['openedAt', draft.openedAt],
    ['claim', draft.claim],
    ['notes', draft.notes],
    ['questions', draft.questions],
    ['nextNoteNumber', draft.nextNoteNumber],
    ['nextQuestionNumber', draft.nextQuestionNumber],
    ...draft.extra,
  ]);
}

function draftDocumentTextOf(draft: Readonly<Draft>): string {
  return `${JSON.stringify(draftDocumentOf(draft), null, INDENTATION_SPACES)}\n`;
}

export const DraftDocumentUtil = { parsedDraftDocumentOf, draftDocumentOf, draftDocumentTextOf } as const;

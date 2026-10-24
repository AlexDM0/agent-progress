/** How a draft prints: its one-line listing entry and its `draft show` summary; `--json` prints the stored document itself. */
import type { Draft, DraftQuestion, DraftState } from '../../src/lib/tracker-model/@types/Draft.ts';

function claimText(draft: Readonly<Draft>): string {
  return draft.claim === null ? 'unclaimed' : `claimed by ${draft.claim.owner}`;
}

export function draftListingLineOf(draft: Readonly<Draft>): string {
  return `${draft.id}  ${draft.title}  ${claimText(draft)}`;
}

export function draftSummaryOf(draft: Readonly<Draft>, state: DraftState, filePath: string): string {
  return [
    `Draft ${draft.id}: ${draft.title}`,
    `  opened:   ${draft.openedAt}`,
    `  claim:    ${draft.claim === null ? '-' : `${draft.claim.owner} since ${draft.claim.claimedAt}`}`,
    `  state:    ${state}`,
    `  file:     ${filePath}`,
  ].join('\n');
}

function answerText(question: Readonly<DraftQuestion>): string {
  if (question.answer === null) return 'open';
  return 'letters' in question.answer ? `answered ${question.answer.letters.join(',')}` : `answered: ${question.answer.text}`;
}

function questionLinesOf(questions: readonly DraftQuestion[], depth: number): string[] {
  const indentation = '  '.repeat(depth + 1);
  return questions.flatMap((question) => [
    `${indentation}${question.id} ${question.question}  (${question.multiple ? 'multiple, ' : ''}recommended ${question.recommended.join(',')}; ${answerText(question)})`,
    ...question.options.map((option) => `${indentation}  ${option.letter}) ${option.text}`),
    ...questionLinesOf(question.followUps, depth + 1),
  ]);
}

/** The notes and the question tree, follow-ups indented under their question; empty when the draft holds neither. */
export function draftContentLinesOf(draft: Readonly<Draft>): string[] {
  const noteLines = draft.notes.map((note) => `  ${note.id} ${note.kind}: ${note.text}`);
  return [
    ...(noteLines.length === 0 ? [] : ['Notes:', ...noteLines]),
    ...(draft.questions.length === 0 ? [] : ['Questions:', ...questionLinesOf(draft.questions, 0)]),
  ];
}

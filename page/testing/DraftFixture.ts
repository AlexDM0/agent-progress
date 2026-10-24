/** Synthetic drafts and questions for the page's specs and frozen cases. Test-only: nothing that ships may import `page/testing/`. */
import type { Draft, DraftQuestion } from '../../src/lib/tracker-model/@types/Draft.ts';

export function exampleQuestion(id: string, changes: Partial<DraftQuestion> = {}): DraftQuestion {
  return {
    id,
    question:    `Example question ${id}?`,
    context:     `Why ${id} matters.`,
    options:     [{ letter: 'a', text: 'First option' }, { letter: 'b', text: 'Second option' }],
    multiple:    false,
    recommended: ['a'],
    answer:      null,
    followUps:   [],
    ...changes,
  };
}

export function exampleDraft(id: string, changes: Partial<Draft> = {}): Draft {
  return {
    id,
    title:              `Example draft ${id}`,
    request:            `Alex Example asks for draft ${id}.`,
    openedAt:           '2026-09-25T09:00:00+02:00',
    claim:              { owner: 'opus', claimedAt: '2026-09-25T09:00:00+02:00' },
    notes:              [],
    questions:          [],
    nextNoteNumber:     1,
    nextQuestionNumber: 1,
    extra:              [],
    ...changes,
  };
}

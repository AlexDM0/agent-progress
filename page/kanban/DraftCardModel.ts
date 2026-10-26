/**
 * An open draft as a To do card: its id, title and state line, drawn by the shared card renderer with a dashed outline of its own. A draft
 * has no priority, type, row, dependency or epic, so every mark of those is left out.
 */
import type { DraftSummary }  from '../../src/lib/tracker-model/@types/Draft.ts';
import { DraftWordingUtil }   from '../utils/DraftWordingUtil.ts';
import { TemplateIdUtil }     from '../utils/TemplateIdUtil.ts';
import type { LaneCardModel } from './@types/LaneBoard.ts';

export type KanbanDraft = Pick<DraftSummary, 'id' | 'title' | 'state' | 'openQuestionCount'>;

/** Its `data-state`, the token the template's draft colours and dashed outline hang on. */
export const DRAFT_CARD_STATE_TOKEN = 'draft';

export function draftCardModelOf(draft: KanbanDraft): LaneCardModel {
  const stateLine = DraftWordingUtil.stateLineOf(draft);
  return {
    elementId:  TemplateIdUtil.kanbanCardElementIdOf(draft.id),
    identity:   { attribute: 'data-draft-id', value: draft.id },
    stateToken: DRAFT_CARD_STATE_TOKEN,
    hasStripe:  false,
    ariaLabel:  `Draft ${draft.id} ${draft.title}, ${stateLine}`,
    head:       {
      idText:         draft.id,
      size:           null,
      priority:       null,
      ticketType:     null,
      slotMarkup:     null,
      hasNeededFirst: false,
      heldCount:      null,
      tokenCount:     null,
    },
    title:         draft.title,
    chips:         null,
    marks:         { waitingOn: [], heldTitle: null, noRowTitle: null },
    note:          stateLine,
    reviewedTitle: null,
    stamp:         null,
    isLive:        false,
    elapsedStamp:  null,
    opensDetail:   true,
  };
}

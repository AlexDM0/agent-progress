import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }   from '../../src/shared/@types/PagePayload.ts';
import type { BoardRow }     from './PageBoard.ts';

export interface KanbanCard {
  ticket:     PageTicket;
  /** The ticket's own row as the Board answers it; null when it has none. */
  ownRow:     BoardRow | null;
  state:      DisplayState;
  /** Oldest filed first. */
  reviewBars: readonly BoardRow[];
  waitingOn:  readonly string[];
}

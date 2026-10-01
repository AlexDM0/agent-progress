import type { DisplayState }        from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }          from '../../src/shared/@types/PagePayload.ts';
import type { BoardEpic, BoardRow } from './PageBoard.ts';

export interface KanbanCard {
  ticket:     PageTicket;
  /** The ticket's own row as the Board answers it; null when it has none. */
  ownRow:     BoardRow | null;
  state:      DisplayState;
  /** Oldest filed first. */
  reviewBars: readonly BoardRow[];
  waitingOn:  readonly string[];
  /** The ticket's epics the board knows, its primary epic first. */
  epics:      readonly BoardEpic[];
}

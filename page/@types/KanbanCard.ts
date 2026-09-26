import type { DisplayState, Task } from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }         from '../../src/shared/@types/PagePayload.ts';

export interface KanbanCard {
  ticket:    PageTicket;
  /** The task whose `ticket` is this ticket's id, or `null` for a ticket never started. */
  ownRow:    Task | null;
  state:     DisplayState;
  waitingOn: readonly string[];
}

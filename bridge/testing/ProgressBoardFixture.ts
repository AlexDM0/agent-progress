/** Small synthetic `BoardState`s holding exactly what the Progress chart and the dependencies view read, for their model specs and DOM specs. */
import type { DisplayState } from '../../src/lib/tracker-model/@types/Task.ts';
import type { ViewRange }    from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type {
  ProgressBoardState,
  ProgressRowFacts,
  ProgressTaskDocument,
  ProgressTicketDocument
} from '../@types/ProgressBoardState.ts';
import { EXAMPLE_PAGE_LIMITS } from './PageLimitsFixture.ts';

export const EXAMPLE_STARTED_AT = '2026-09-18T09:00:00+02:00';

export function exampleProgressTask(id: number, fields: Partial<ProgressTaskDocument> = {}): ProgressTaskDocument {
  return {
    id,
    name:   `Example task ${id}`,
    status: 'pending',
    start:  null,
    end:    null,
    ticket: null,
    tokens: null,
    ...fields,
  };
}

export function exampleProgressTicket(id: string, fields: Partial<ProgressTicketDocument> = {}): ProgressTicketDocument {
  return {
    id, title: `Example ticket ${id}`, type: 'ticket', status: 'pending', ...fields
  };
}

export interface ExampleProgressBoardFields {
  readonly tasks?:            readonly ProgressTaskDocument[];
  /** The Board's facts per row, by task id; a row left out is no review bar and shows its stored status. */
  readonly rowFacts?:         Readonly<Record<number, Partial<Omit<ProgressRowFacts, 'ownRowPositionOfReviewedTicket'>> & { reviewsTaskId?: number }>>;
  readonly tickets?:          readonly ProgressTicketDocument[];
  /** Each ticket's own row and review bars, by task id. */
  readonly ticketRows?:       Readonly<Record<string, { ownTaskId?: number; reviewTaskIds?: readonly number[] }>>;
  readonly displayStates?:    Readonly<Record<string, DisplayState>>;
  readonly waitingOn?:        Readonly<Record<string, readonly string[]>>;
  readonly readyTicketIds?:   readonly string[];
  readonly concurrencyLimit?: number;
  readonly dispatcherState?:  string;
  /** The tracker's own range, as the `range` command sets it; Fit when left out. */
  readonly view?:             ViewRange;
}

export function exampleProgressBoard(fields: ExampleProgressBoardFields = {}): ProgressBoardState {
  const tasks = fields.tasks ?? [];
  const tickets = fields.tickets ?? [];
  const positionOf = (taskId: number | undefined): number | null => {
    const position = tasks.findIndex((task) => task.id === taskId);
    return position === -1 ? null : position;
  };
  return {
    page: {
      tickets,
      payload: {
        progress: {
          startedAt: EXAMPLE_STARTED_AT,
          view:      fields.view ?? { kind: 'auto' },
          tasks,
          ...fields.dispatcherState === undefined ? {} : { dispatcherState: fields.dispatcherState },
        },
        limits:      EXAMPLE_PAGE_LIMITS,
        concurrency: { limit: fields.concurrencyLimit ?? 3 },
        boardFacts:  {
          rows: tasks.map((task) => {
            const facts = fields.rowFacts?.[task.id];
            return {
              displayState:                   facts?.displayState ?? task.status,
              deliveredRowCountsAsReviewed:   facts?.deliveredRowCountsAsReviewed ?? false,
              ownRowPositionOfReviewedTicket: positionOf(facts?.reviewsTaskId),
            };
          }),
          tickets: tickets.map((ticket) => ({
            ticketId:           ticket.id,
            ownRowPosition:     positionOf(fields.ticketRows?.[ticket.id]?.ownTaskId),
            reviewBarPositions: (fields.ticketRows?.[ticket.id]?.reviewTaskIds ?? []).flatMap((taskId) => positionOf(taskId) ?? []),
            displayState:       fields.displayStates?.[ticket.id] ?? ticket.status,
            waitingOnTicketIds: fields.waitingOn?.[ticket.id] ?? [],
          })),
          readyTickets: (fields.readyTicketIds ?? []).map((id) => ({ id })),
        },
      },
    },
  };
}

/** The tracker page's detail targets: which row, ticket line, Kanban card, draft card or epic link opens the panel, and what each fills it with. */

import type { PageLimits }                       from '../../src/shared/@types/PagePayload.ts';
import type { IdentifiedLogEntry }               from '../../src/shared/@types/WordedLogEntry.ts';
import type { KanbanCard }                       from '../@types/KanbanCard.ts';
import type { BoardDraft }                       from '../@types/PageBoard.ts';
import type { BoardEpic, BoardRow, BoardTicket } from '../@types/PageBoard.ts';
import type { DetailTarget, DetailTargetKind }   from '../@types/ViewerChoices.ts';
import {
  CHART_ELEMENT_ID,
  DETAIL_BODY_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
  KANBAN_FRAME_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
  TICKET_ROWS_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { EPIC_MARK_VOCABULARY }                            from '../epics/EpicMarkVocabulary.ts';
import { EpicMarkup }                                      from '../epics/EpicMarkup.ts';
import { GeometryUtil }                                    from '../utils/GeometryUtil.ts';
import type { DetailLinkOpener, DetailTargetRegistration } from './@types/DetailTargetRegistration.ts';
import { createDetailPanelController }                     from './DetailPanelController.ts';
import { draftDetailMarkup }                               from './DraftDetail.ts';
import { taskDetailMarkup }                                from './TaskDetail.ts';
import { ticketDetailMarkup }                              from './TicketDetail.ts';

const EPICS_BOARD_ELEMENT_ID = 'ap-epics';

// An epic's head row is a chart row too, but it folds its group instead of opening a detail.
const TASK_ROW_SELECTOR    = `#${TASK_ROWS_ELEMENT_ID} > .ap-row[data-task-id]`;
const TICKET_ROW_SELECTOR  = `#${TICKET_ROWS_ELEMENT_ID} > tr[data-ticket-id]`;
const KANBAN_CARD_SELECTOR = `#${KANBAN_BOARD_ELEMENT_ID} .ap-kanban-card`;
const DRAFT_CARD_SELECTOR  = `#${KANBAN_BOARD_ELEMENT_ID} .ap-kanban-card[data-draft-id]`;

const { chipOpenerAttribute, titleOpenerAttribute, itemOpenerAttribute } = EPIC_MARK_VOCABULARY;

export interface DetailDialogSources {
  rows:                  readonly BoardRow[];
  tickets:               readonly BoardTicket[];
  epics:                 readonly BoardEpic[];
  drafts:                readonly BoardDraft[];
  log:                   readonly IdentifiedLogEntry[];
  limits:                PageLimits;
  readTodayCalendarDate: () => string;
  readKanbanCards:       () => readonly KanbanCard[];
  updateKanbanOverflow:  () => void;
}

/** An epic chip or title anywhere opens its epic; a ticket line inside an epic's list opens that ticket. */
export const TRACKER_DETAIL_LINK_OPENERS: readonly DetailLinkOpener<DetailTargetKind>[] = [
  {
    kind:     'epic',
    selector: `.ap-epic-chip[${chipOpenerAttribute}], [${titleOpenerAttribute}]`,
    idOf:     (link) => link.getAttribute(chipOpenerAttribute) ?? link.getAttribute(titleOpenerAttribute) ?? '',
  },
  { kind: 'ticket', selector: `[${itemOpenerAttribute}]`, idOf: (link) => link.getAttribute(itemOpenerAttribute) ?? '' },
];

function markCoveredTickLabels(): void {
  const body     = document.getElementById(DETAIL_BODY_ELEMENT_ID);
  const endLabel = body?.querySelector('.ap-ticket-gantt-end-label') ?? null;
  if (body === null || endLabel === null) {
    return;
  }
  const ticks   = [...body.querySelectorAll('.ap-ticket-gantt-ticks .ap-tick')];
  const labels  = ticks.map((tick) => tick.firstElementChild?.getBoundingClientRect() ?? { left: 0, right: 0 });
  const covered = GeometryUtil.coveredTickLabels(labels, [endLabel.getBoundingClientRect()]);
  ticks.forEach((tick, index) => {
    tick.toggleAttribute('data-covered', covered[index] ?? false);
  });
}

export function trackerDetailTargetsOf(sources: DetailDialogSources): Readonly<Record<DetailTargetKind, DetailTargetRegistration>> {
  const {
    rows, tickets, log, limits, readTodayCalendarDate
  } = sources;
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));

  const detailMarkup = (task: BoardRow | null, ticket: BoardTicket | null): string => taskDetailMarkup({
    task,
    ticket,
    log,
    slices:            limits,
    todayCalendarDate: readTodayCalendarDate(),
    ticketEpics:       ticket?.memberOfEpics ?? [],
    allTickets:        tickets,
  });

  return {
    'task': {
      openerSelector: TASK_ROW_SELECTOR,
      idOf:           (opener) => opener.dataset['taskId'] ?? '',
      selectorFor:    (escapedId) => `${TASK_ROW_SELECTOR}[data-task-id="${escapedId}"]`,
      markupOf:       (taskId) => {
        const task = rows.find((candidate) => String(candidate.id) === taskId);
        return task === undefined ? '' : detailMarkup(task, task.ticket === null ? null : ticketById.get(task.ticket) ?? null);
      },
    },
    'ticket': {
      openerSelector: TICKET_ROW_SELECTOR,
      idOf:           (opener) => opener.dataset['ticketId'] ?? '',
      selectorFor:    (escapedId) => `${TICKET_ROW_SELECTOR}[data-ticket-id="${escapedId}"]`,
      markupOf:       (ticketId) => {
        const ticket = ticketById.get(ticketId) ?? null;
        return detailMarkup(ticket?.ownRow ?? null, ticket);
      },
    },
    // Before the Kanban card, whose selector a draft card matches too: the openers are matched in this order.
    'draft': {
      openerSelector: DRAFT_CARD_SELECTOR,
      idOf:           (opener) => opener.dataset['draftId'] ?? '',
      selectorFor:    (escapedId) => `${DRAFT_CARD_SELECTOR}[data-draft-id="${escapedId}"]`,
      markupOf:       (draftId) => {
        const draft = sources.drafts.find((candidate) => candidate.id === draftId);
        return draft === undefined ? '' : draftDetailMarkup({ draft, todayCalendarDate: readTodayCalendarDate(), slices: limits });
      },
    },
    'kanban-card': {
      openerSelector: KANBAN_CARD_SELECTOR,
      idOf:           (opener) => opener.dataset['ticketId'] ?? '',
      selectorFor:    (escapedId) => `${KANBAN_CARD_SELECTOR}[data-ticket-id="${escapedId}"]`,
      markupOf:       (ticketId) => {
        const card = sources.readKanbanCards().find((candidate) => candidate.ticket.id === ticketId);
        return card === undefined ? '' : ticketDetailMarkup({
          card,
          nowEpochMilliseconds: Date.now(),
          todayCalendarDate:    readTodayCalendarDate(),
          limits,
          allTickets:           tickets,
        });
      },
      afterShown: markCoveredTickLabels,
    },
    'epic': {
      openerSelector: null,
      idOf:           (opener) => opener.getAttribute(titleOpenerAttribute) ?? '',
      selectorFor:    (escapedId) => `#${EPICS_BOARD_ELEMENT_ID} [${titleOpenerAttribute}="${escapedId}"]`,
      markupOf:       (epicKey) => {
        const epic = sources.epics.find((candidate) => candidate.key === epicKey);
        return epic === undefined ? '' : EpicMarkup.epicDetailMarkup(epic, ticketById, {
          limits,
          todayCalendarDate:    readTodayCalendarDate(),
          nowEpochMilliseconds: Date.now(),
        });
      },
    },
  };
}

export interface DetailDialogController {
  wire(): void;
  readOpenTarget(): DetailTarget | null;
  /** Opens the panel on the target again; a task or ticket the board no longer shows opens nothing and answers false. */
  reopen(target: DetailTarget): boolean;
  /** Opens the panel on a ticket as its ticket line does; a ticket the board does not hold opens nothing and answers false. */
  openTicketDetail(ticketId: string): boolean;
}

export function createDetailDialogController(sources: DetailDialogSources): DetailDialogController {
  const panel = createDetailPanelController({
    targets:              trackerDetailTargetsOf(sources),
    linkOpeners:          TRACKER_DETAIL_LINK_OPENERS,
    observedContainerIds: [TASK_ROWS_ELEMENT_ID, TICKET_ROWS_ELEMENT_ID, KANBAN_BOARD_ELEMENT_ID],
    panelRoomScrollers:   [
      { boardElementId: KANBAN_BOARD_ELEMENT_ID, frameElementId: KANBAN_FRAME_ELEMENT_ID },
      { boardElementId: CHART_ELEMENT_ID, frameElementId: null },
    ],
    updateOverflow: sources.updateKanbanOverflow,
  });
  return {
    wire:             panel.wire,
    readOpenTarget:   panel.readOpenTarget,
    reopen:           panel.reopen,
    openTicketDetail: (ticketId) => panel.open({ kind: 'ticket', id: ticketId }),
  };
}

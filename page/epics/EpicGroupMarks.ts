/** An epic as the shared group marks read it: its roll-up, its facts, its ticket lines, its counts and the order epics are shown in. */

import { HtmlEscapeUtil }              from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }              from '../../src/lib/token-count/TokenCountUtil.ts';
import type { TicketStatus }           from '../../src/lib/tracker-model/@types/Ticket.ts';
import { FIRST_REPEAT_REVIEW_ROUND }   from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { GroupFactModel }         from '../@types/GroupMarks.ts';
import type { GroupItemRowModel }      from '../@types/GroupMarks.ts';
import type { GroupMarkupFormat }      from '../@types/GroupMarks.ts';
import type { GroupRollupModel }       from '../@types/GroupMarks.ts';
import type { BoardEpic, BoardTicket } from '../@types/PageBoard.ts';
import { LiveStateUtil }               from '../utils/LiveStateUtil.ts';
import { MarkupUtil }                  from '../utils/MarkupUtil.ts';
import { TimeUtil }                    from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }          from '../utils/WorkItemMarkupUtil.ts';

/** The roll-up bar's segments, settled work first. */
const ROLLUP_STATUS_ORDER: readonly TicketStatus[] = ['delivered', 'reviewed', 'in-review', 'in-progress', 'pending', 'abandoned'];

function countOf(epic: BoardEpic, status: TicketStatus): number {
  const count = epic.ticketCountByStatus[status];
  return typeof count === 'number' ? count : 0;
}

function openTicketCountOf(epic: BoardEpic): number {
  return epic.ticketIds.length - countOf(epic, 'delivered') - countOf(epic, 'abandoned');
}

function doneTicketCountOf(epic: BoardEpic): number {
  return countOf(epic, 'delivered');
}

function doneTextOf(epic: BoardEpic): string {
  return `${doneTicketCountOf(epic)} of ${epic.ticketIds.length} done`;
}

function epicRollupOf(epic: BoardEpic): GroupRollupModel {
  return {
    segments:  ROLLUP_STATUS_ORDER.filter((status) => countOf(epic, status) > 0).map((status) => ({ state: status, count: countOf(epic, status) })),
    ariaLabel: `${doneTextOf(epic)} tickets`,
  };
}

function spanMarkup(epic: BoardEpic, format: GroupMarkupFormat): string {
  const { span } = epic;
  if (span === null) {
    return '<span>not started</span>';
  }
  const { limits, todayCalendarDate } = format;
  const startMilliseconds = TimeUtil.epochMillisecondsOf(span.start);
  const endMilliseconds   = span.end === null ? format.nowEpochMilliseconds : TimeUtil.epochMillisecondsOf(span.end);
  const duration          = startMilliseconds === null || endMilliseconds === null ? null : TimeUtil.formatDuration(endMilliseconds - startMilliseconds, limits);
  const endText           = span.end === null ? 'now' : TimeUtil.shortStampText(span.end, todayCalendarDate, limits);
  const title             = `${TimeUtil.fullStampText(span.start, limits)} → ${span.end === null ? 'still open' : TimeUtil.fullStampText(span.end, limits)}`;
  const text              = `${TimeUtil.shortStampText(span.start, todayCalendarDate, limits)} → ${endText}${duration === null ? '' : ` · ${duration}`}`;
  return `<span ${MarkupUtil.attribute('title', title)}>${HtmlEscapeUtil.escapeHtml(text)}</span>`;
}

function plainFactOf(label: string, value: string): GroupFactModel {
  return { label, valueMarkup: `<span>${HtmlEscapeUtil.escapeHtml(value)}</span>` };
}

/** Open, done, abandoned only when there are any, tokens and the span. */
function epicFactsOf(epic: BoardEpic, format: GroupMarkupFormat): GroupFactModel[] {
  const abandonedCount = countOf(epic, 'abandoned');
  return [
    plainFactOf('open', String(openTicketCountOf(epic))),
    plainFactOf('done', String(countOf(epic, 'delivered'))),
    ...(abandonedCount > 0 ? [plainFactOf('abandoned', String(abandonedCount))] : []),
    plainFactOf('tokens', TokenCountUtil.formatTokenCount(epic.tokens)),
    { label: 'span', valueMarkup: spanMarkup(epic, format) },
  ];
}

/** Newest first, each naming the ticket's other epics. */
function epicItemRowsOf(epic: BoardEpic, ticketById: ReadonlyMap<string, BoardTicket>): GroupItemRowModel[] {
  return epic.ticketIds
    .flatMap((ticketId) => ticketById.get(ticketId) ?? [])
    .toSorted((a, b) => Number(b.id) - Number(a.id))
    .map((ticket) => ({
      opener:      ticket.id,
      leadText:    `#${ticket.id}`,
      title:       ticket.title,
      otherGroups: ticket.memberOfEpics.filter((other) => other.key !== epic.key),
      badge:       { stateToken: ticket.displayState, label: WorkItemMarkupUtil.stateLabelOf(ticket.displayState, ticket.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND) },
      note:        null,
      isLive:      LiveStateUtil.displayStateIsLive(ticket.displayState),
    }));
}

function epicHasLiveTicket(epic: BoardEpic, ticketById: ReadonlyMap<string, BoardTicket>): boolean {
  return epic.ticketIds.some((ticketId) => {
    const ticket = ticketById.get(ticketId);
    return ticket !== undefined && LiveStateUtil.displayStateIsLive(ticket.displayState);
  });
}

/** Open epics first, then the settled ones, each part in the Board's key order. */
function epicsInShownOrder(epics: readonly BoardEpic[]): BoardEpic[] {
  return epics.toSorted((a, b) => Number(openTicketCountOf(a) === 0) - Number(openTicketCountOf(b) === 0));
}

export const EpicGroupMarks = {
  epicRollupOf,
  epicFactsOf,
  epicItemRowsOf,
  epicHasLiveTicket,
  doneTicketCountOf,
  openTicketCountOf,
  doneTextOf,
  epicsInShownOrder,
} as const;

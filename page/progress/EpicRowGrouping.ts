/** The tracker page's Progress rows grouped by epic: each ticket's rows under its primary epic, the rest under "No epic". */

import type { BoardEpic }         from '../@types/PageBoard.ts';
import { NO_EPIC_CHIP }           from '../constants/EpicChips.ts';
import { EpicGroupMarks }         from '../epics/EpicGroupMarks.ts';
import { EPIC_MARK_VOCABULARY }   from '../epics/EpicMarkVocabulary.ts';
import { GroupMarkup }            from '../epics/GroupMarkup.ts';
import type { ChartGroupModel }   from './RowGrouping.ts';
import type { RowGroupingSource } from './RowGrouping.ts';

/** What the grouping reads of a chart row: the ticket it is, or the ticket it reviews. */
export interface EpicGroupedRow {
  ticket?:                 string | null;
  reviewOf?:               string;
  ownRowOfReviewedTicket?: { ticket?: string | null } | null;
}

/** A review row goes with the ticket it reviews; a free-standing row has no ticket. */
function ticketIdOfRow(row: EpicGroupedRow): string | null {
  return row.ticket ?? row.ownRowOfReviewedTicket?.ticket ?? row.reviewOf ?? null;
}

/** Shared tickets are the epic's tickets drawn under another, primary, epic; its span counts them all the same. */
function epicGroupOf(epic: BoardEpic, epicsOfTicket: ReadonlyMap<string, readonly BoardEpic[]>): ChartGroupModel {
  return {
    key:               epic.key,
    slot:              epic.slot,
    chipMarkup:        GroupMarkup.groupChipsMarkup([epic], EPIC_MARK_VOCABULARY),
    span:              epic.span === null ? null : { ...epic.span, label: epic.title },
    isOpen:            EpicGroupMarks.openTicketCountOf(epic) > 0,
    doneText:          `${EpicGroupMarks.doneTicketCountOf(epic)} / ${epic.ticketIds.length} done`,
    sharedMemberCount: epic.ticketIds.filter((ticketId) => epicsOfTicket.get(ticketId)?.[0]?.key !== epic.key).length,
  };
}

/** `epics` in the order their groups are drawn; `epicsOfTicket` gives each ticket's epics the board knows, its primary epic first. */
export function rowGroupingOfEpics(
  epics: readonly BoardEpic[],
  epicsOfTicket: ReadonlyMap<string, readonly BoardEpic[]>,
): RowGroupingSource<EpicGroupedRow> {
  return {
    groups:        epics.map((epic) => epicGroupOf(epic, epicsOfTicket)),
    groupKeyOfRow: (row) => {
      const ticketId = ticketIdOfRow(row);
      return (ticketId === null ? undefined : epicsOfTicket.get(ticketId)?.[0])?.key ?? null;
    },
    ungroupedHead: { key: NO_EPIC_CHIP, label: 'No epic' },
  };
}

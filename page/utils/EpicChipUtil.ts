/** Which epic filter chips a ticket answers to, shared by the Tickets table's chip row and the Kanban's epic strip. */

import type { BoardTicket } from '../@types/PageBoard.ts';
import { ChipFilterUtil }   from '../chips/ChipFilterUtil.ts';
import { NO_EPIC_CHIP }     from '../constants/EpicChips.ts';

/** Each of the ticket's epics, or the no-epic chip. */
function epicChipsOf(ticket: BoardTicket): string[] {
  return ticket.memberOfEpics.length === 0 ? [NO_EPIC_CHIP] : ticket.memberOfEpics.map((epic) => epic.key);
}

function pressedChipsKeep(ticket: BoardTicket, pressedChips: readonly string[]): boolean {
  return ChipFilterUtil.pressedChipsKeep(epicChipsOf(ticket), pressedChips);
}

export const EpicChipUtil = { epicChipsOf, pressedChipsKeep } as const;

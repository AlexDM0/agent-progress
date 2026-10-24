/**
 * The filter menu's Epic section on the Kanban: one row per epic narrows the board to the pressed epics' tickets, each pressed epic's
 * roll-up under its row, kept across visits; the filter line names what is pressed.
 */

import type { BoardEpic, BoardTicket } from '../@types/PageBoard.ts';
import type { ViewerPreferences }      from '../@types/ViewerChoices.ts';
import { ChipFilterUtil }              from '../chips/ChipFilterUtil.ts';
import { createChipGroupController }   from '../chips/ChipGroupController.ts';
import { NO_EPIC_CHIP }                from '../constants/EpicChips.ts';
import { EpicGroupMarks }              from '../epics/EpicGroupMarks.ts';
import { EPIC_MARK_VOCABULARY }        from '../epics/EpicMarkVocabulary.ts';
import { EpicMarkup }                  from '../epics/EpicMarkup.ts';
import { DomUtil }                     from '../utils/DomUtil.ts';
import { EpicChipUtil }                from '../utils/EpicChipUtil.ts';

const EPIC_SECTION_ELEMENT_ID = 'ap-kanban-epics';
const EPIC_ROWS_ELEMENT_ID    = 'ap-kanban-epic';

const { filterChipAttribute, noGroupChip } = EPIC_MARK_VOCABULARY;

interface KanbanEpicFilterSources {
  epics:       readonly BoardEpic[];
  allTickets:  readonly BoardTicket[];
  preferences: ViewerPreferences;
  /** Called after a row changed the pressed set, so the board is laid out again. */
  applyFilter: () => void;
}

/** What the filter line names: the first pressed row's title, "+N" for the others, and its swatch slot (null for no epic). */
export interface EpicFilterLabel {
  title: string;
  slot:  number | null;
}

export interface KanbanEpicFilterController {
  wire(): void;
  /** No row pressed keeps every ticket; a ticket in several epics passes on any one of them. */
  keeps(ticket: BoardTicket): boolean;
  readLabel(): EpicFilterLabel | null;
  /** Unpresses every row and stores that, without laying the board out again. */
  reset(): void;
}

/** Only an epic holding an open ticket gets a row; a remembered row of any other epic reads as unpressed, its stored value kept. */
export function createKanbanEpicFilterController(sources: KanbanEpicFilterSources): KanbanEpicFilterController {
  const { allTickets, preferences } = sources;
  const epics      = sources.epics.filter((epic) => EpicGroupMarks.openTicketCountOf(epic) > 0);
  const knownChips = new Set([...epics.map((epic) => epic.key), NO_EPIC_CHIP]);
  const chipGroup  = createChipGroupController({ containerId: EPIC_ROWS_ELEMENT_ID, attributeName: filterChipAttribute });
  let pressedChips = ChipFilterUtil.knownPressedChips(preferences.readKanbanEpicFilter(), knownChips);

  const ticketCountByChip = new Map<string, number>();
  for (const ticket of allTickets) {
    for (const chip of EpicChipUtil.epicChipsOf(ticket)) ticketCountByChip.set(chip, (ticketCountByChip.get(chip) ?? 0) + 1);
  }

  const render = (): void => {
    DomUtil.setMarkup(EPIC_ROWS_ELEMENT_ID, EpicMarkup.epicFilterChipsMarkup(
      epics,
      (epic) => (pressedChips.includes(epic.key) ? EpicMarkup.epicStripRollupMarkup(epic) : ''),
    ));
    chipGroup.reflect(pressedChips, ticketCountByChip);
  };

  const readLabel = (): EpicFilterLabel | null => {
    const firstChip = pressedChips[0];
    if (firstChip === undefined) {
      return null;
    }
    const epic   = epics.find((candidate) => candidate.key === firstChip);
    const others = pressedChips.length > 1 ? ` +${pressedChips.length - 1}` : '';
    return { title: `${epic?.title ?? noGroupChip?.label ?? firstChip}${others}`, slot: epic?.slot ?? null };
  };

  return {
    wire: () => {
      DomUtil.setHidden(EPIC_SECTION_ELEMENT_ID, epics.length === 0);
      if (epics.length === 0) {
        pressedChips = [];
        return;
      }
      render();
      chipGroup.wire((chip) => {
        pressedChips = ChipFilterUtil.toggledChips(pressedChips, chip);
        preferences.writeKanbanEpicFilter(pressedChips);
        render();
        // The rows were drawn anew, so the pressed one takes the focus back.
        const rows = document.getElementById(EPIC_ROWS_ELEMENT_ID);
        [...rows?.querySelectorAll<HTMLElement>(`[${filterChipAttribute}]`) ?? []].find((row) => row.getAttribute(filterChipAttribute) === chip)?.focus();
        sources.applyFilter();
      });
    },
    keeps: (ticket) => EpicChipUtil.pressedChipsKeep(ticket, pressedChips),
    readLabel,
    reset: () => {
      if (pressedChips.length === 0) {
        return;
      }
      pressedChips = [];
      preferences.writeKanbanEpicFilter(pressedChips);
      render();
    },
  };
}

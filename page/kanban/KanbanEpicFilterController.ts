/** The Kanban's epic strip: its chips narrow the board to the pressed epics' tickets, each pressed epic's roll-up beside them, kept across visits. */

import type { BoardEpic, BoardTicket } from '../@types/PageBoard.ts';
import type { ViewerPreferences }      from '../@types/ViewerChoices.ts';
import { ChipFilterUtil }              from '../chips/ChipFilterUtil.ts';
import { createChipGroupController }   from '../chips/ChipGroupController.ts';
import { NO_EPIC_CHIP }                from '../constants/EpicChips.ts';
import { EPIC_MARK_VOCABULARY }        from '../epics/EpicMarkVocabulary.ts';
import { EpicMarkup }                  from '../epics/EpicMarkup.ts';
import { DomUtil }                     from '../utils/DomUtil.ts';
import { EpicChipUtil }                from '../utils/EpicChipUtil.ts';

const EPIC_STRIP_ELEMENT_ID   = 'ap-kanban-epics';
const EPIC_CHIPS_ELEMENT_ID   = 'ap-kanban-epic';
const EPIC_ROLLUPS_ELEMENT_ID = 'ap-kanban-epic-rollups';

const { filterChipAttribute } = EPIC_MARK_VOCABULARY;

interface KanbanEpicFilterSources {
  epics:       readonly BoardEpic[];
  allTickets:  readonly BoardTicket[];
  preferences: ViewerPreferences;
  /** Called after a chip changed the pressed set, so the board is laid out again. */
  applyFilter: () => void;
}

export interface KanbanEpicFilterController {
  wire(): void;
  /** No chip pressed keeps every ticket; a ticket in several epics passes on any one of them. */
  keeps(ticket: BoardTicket): boolean;
}

export function createKanbanEpicFilterController(sources: KanbanEpicFilterSources): KanbanEpicFilterController {
  const { epics, allTickets, preferences } = sources;
  const knownChips = new Set([...epics.map((epic) => epic.key), NO_EPIC_CHIP]);
  const chipGroup  = createChipGroupController({ containerId: EPIC_CHIPS_ELEMENT_ID, attributeName: filterChipAttribute });
  let pressedChips = ChipFilterUtil.knownPressedChips(preferences.readKanbanEpicFilter(), knownChips);

  const ticketCountByChip = new Map<string, number>();
  for (const ticket of allTickets) {
    for (const chip of EpicChipUtil.epicChipsOf(ticket)) ticketCountByChip.set(chip, (ticketCountByChip.get(chip) ?? 0) + 1);
  }

  const render = (): void => {
    chipGroup.reflect(pressedChips, ticketCountByChip);
    DomUtil.setMarkup(EPIC_ROLLUPS_ELEMENT_ID, epics.filter((epic) => pressedChips.includes(epic.key)).map(EpicMarkup.epicStripRollupMarkup).join(''));
  };

  return {
    wire: () => {
      DomUtil.setHidden(EPIC_STRIP_ELEMENT_ID, epics.length === 0);
      if (epics.length === 0) {
        pressedChips = [];
        return;
      }
      DomUtil.setMarkup(EPIC_CHIPS_ELEMENT_ID, EpicMarkup.epicFilterChipsMarkup(epics));
      render();
      chipGroup.wire((chip) => {
        pressedChips = ChipFilterUtil.toggledChips(pressedChips, chip);
        preferences.writeKanbanEpicFilter(pressedChips);
        render();
        sources.applyFilter();
      });
    },
    keeps: (ticket) => EpicChipUtil.pressedChipsKeep(ticket, pressedChips),
  };
}

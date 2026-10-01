/** The Kanban's epic strip: its chips narrow the board to the pressed epics' tickets, each pressed epic's roll-up beside them, kept across visits. */

import type { BoardEpic, BoardTicket } from '../@types/PageBoard.ts';
import type { ViewerPreferences }      from '../@types/ViewerChoices.ts';
import { NO_EPIC_CHIP }                from '../constants/EpicChips.ts';
import { EpicMarkup }                  from '../epics/EpicMarkup.ts';
import { DomUtil }                     from '../utils/DomUtil.ts';
import { EpicChipUtil }                from '../utils/EpicChipUtil.ts';

const EPIC_STRIP_ELEMENT_ID   = 'ap-kanban-epics';
const EPIC_CHIPS_ELEMENT_ID   = 'ap-kanban-epic';
const EPIC_ROLLUPS_ELEMENT_ID = 'ap-kanban-epic-rollups';

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
  // A stored key whose epic has since gone presses nothing, so it cannot empty the board unseen.
  let pressedChips = preferences.readKanbanEpicFilter().filter((chip) => knownChips.has(chip));

  const ticketCountByChip = new Map<string, number>();
  for (const ticket of allTickets) {
    for (const chip of EpicChipUtil.epicChipsOf(ticket)) ticketCountByChip.set(chip, (ticketCountByChip.get(chip) ?? 0) + 1);
  }

  const render = (): void => {
    for (const button of document.querySelectorAll<HTMLElement>(`#${EPIC_CHIPS_ELEMENT_ID} [data-epic-chip]`)) {
      const chip  = button.dataset['epicChip'] ?? '';
      const count = ticketCountByChip.get(chip) ?? 0;
      button.setAttribute('aria-pressed', String(pressedChips.includes(chip)));
      button.toggleAttribute('data-empty', count === 0);
      const countElement = button.querySelector('.ap-chip-count');
      if (countElement !== null) {
        countElement.textContent = String(count);
      }
    }
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
      document.getElementById(EPIC_CHIPS_ELEMENT_ID)?.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-epic-chip]') : null;
        if (!(button instanceof HTMLElement)) {
          return;
        }
        const chip   = button.dataset['epicChip'] ?? '';
        pressedChips = pressedChips.includes(chip) ? pressedChips.filter((pressed) => pressed !== chip) : [...pressedChips, chip];
        preferences.writeKanbanEpicFilter(pressedChips);
        render();
        sources.applyFilter();
      });
    },
    keeps: (ticket) => EpicChipUtil.pressedChipsKeep(ticket, pressedChips),
  };
}

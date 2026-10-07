/**
 * The spec page's Kanban: the Specs band and the work band on two shared lane boards, the spec strip whose pressed chips narrow the work band
 * to their specs (kept per repository), a spec card's hover dimming every other spec's work, and the `implementing` statistic's jump.
 */

import type { SpecSnapshot }                                                    from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { SPEC_LANES }                                                           from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { PageLimits }                                                      from '../../../src/shared/@types/PagePayload.ts';
import { ChipFilterUtil }                                                       from '../../chips/ChipFilterUtil.ts';
import { createChipGroupController }                                            from '../../chips/ChipGroupController.ts';
import { filterChipMarkup }                                                     from '../../chips/FilterChipMarkup.ts';
import { KANBAN_BOARD_ELEMENT_ID, KANBAN_FRAME_ELEMENT_ID, SUMMARY_ELEMENT_ID } from '../../constants/TemplateIds.ts';
import type { PanelRoomScroller }                                               from '../../detail-dialog/PanelRoomController.ts';
import type { LaneBoardController }                                             from '../../kanban/LaneBoardController.ts';
import { createLaneBoardController, wireStatisticLanes, wireTabOverflow }       from '../../kanban/LaneBoardController.ts';
import { laneBoardMarkup }                                                      from '../../kanban/LaneBoardMarkup.ts';
import { DomUtil }                                                              from '../../utils/DomUtil.ts';
import { TimeUtil }                                                             from '../../utils/TimeUtil.ts';
import { SPEC_KEY_ATTRIBUTE, WORK_ITEM_ID_ATTRIBUTE }                           from '../constants/SpecCardIdentityAttributes.ts';
import { SPEC_MARK_VOCABULARY }                                                 from '../constants/SpecMarkVocabulary.ts';
import { SpecGroupMarks }                                                       from '../marks/SpecGroupMarks.ts';
import type { SpecViewerPreferences }                                           from '../preferences/SpecViewerPreferences.ts';
import type { SpecKanbanModel }                                                 from './SpecKanbanModel.ts';
import { cardElementIdOf, specKanbanModelOf }                                   from './SpecKanbanModel.ts';

const WORK_BOARD_ELEMENT_ID       = 'ap-spec-work-kanban';
const WORK_FRAME_ELEMENT_ID       = 'ap-spec-work-kanban-frame';
const SPECS_BAND_COUNT_ELEMENT_ID = 'ap-spec-specs-band-count';
const WORK_BAND_COUNT_ELEMENT_ID  = 'ap-spec-work-band-count';
const SPEC_STRIP_ELEMENT_ID       = 'ap-spec-kanban-strip';
const SPEC_CHIPS_ELEMENT_ID       = 'ap-spec-kanban-specs';
const DIMMED_ATTRIBUTE            = 'data-spec-dimmed';

/** The boards the detail panel makes room in, each inside its own frame. */
export const SPEC_KANBAN_SCROLLERS: readonly PanelRoomScroller[] = [
  { boardElementId: KANBAN_BOARD_ELEMENT_ID, frameElementId: KANBAN_FRAME_ELEMENT_ID },
  { boardElementId: WORK_BOARD_ELEMENT_ID, frameElementId: WORK_FRAME_ELEMENT_ID },
];

/** The ids the page clears before filling. */
export const SPEC_KANBAN_MARKUP_CONTAINER_IDS = [KANBAN_BOARD_ELEMENT_ID, WORK_BOARD_ELEMENT_ID, SPEC_CHIPS_ELEMENT_ID];
export const SPEC_KANBAN_TEXT_CONTAINER_IDS   = [SPECS_BAND_COUNT_ELEMENT_ID, WORK_BAND_COUNT_ELEMENT_ID];

interface SpecKanbanSources {
  snapshot:    SpecSnapshot;
  limits:      PageLimits;
  preferences: SpecViewerPreferences;
}

export interface SpecKanbanController {
  wire(): void;
  updateOverflow(): void;
}

export function createSpecKanbanController(sources: SpecKanbanSources): SpecKanbanController {
  const { snapshot, limits, preferences } = sources;
  const specKeyByWorkItemId = new Map(snapshot.specs.flatMap((spec) => spec.workItems.map((workItem) => [workItem.id, spec.folderName])));
  const chipGroup           = createChipGroupController({ containerId: SPEC_CHIPS_ELEMENT_ID, attributeName: SPEC_MARK_VOCABULARY.filterChipAttribute });
  const workItemCountBySpec = new Map(snapshot.specs.map((spec) => [spec.folderName, spec.workItems.length]));
  let pressedSpecKeys       = ChipFilterUtil.knownPressedChips(preferences.readKanbanSpecFilter(), new Set(workItemCountBySpec.keys()));
  let dimmedForSpecKey: string | null = null;

  const specsBoard = createLaneBoardController({
    boardElementId:  KANBAN_BOARD_ELEMENT_ID,
    frameElementId:  KANBAN_FRAME_ELEMENT_ID,
    cardElementIdOf: (specKey) => cardElementIdOf('specs', specKey),
    linkAttribute:   null,
  });
  const workBoard = createLaneBoardController({
    boardElementId:  WORK_BOARD_ELEMENT_ID,
    frameElementId:  WORK_FRAME_ELEMENT_ID,
    cardElementIdOf: (workItemId) => cardElementIdOf('work', workItemId),
    linkAttribute:   SPEC_MARK_VOCABULARY.itemOpenerAttribute,
  });
  const boards: readonly LaneBoardController[] = [specsBoard, workBoard];

  const kanbanModelOf = (specs: SpecSnapshot['specs']): SpecKanbanModel => specKanbanModelOf({
    snapshot:          { ...snapshot, specs },
    todayCalendarDate: TimeUtil.calendarDateOf(Date.now()),
    slices:            limits,
  });

  const showWorkBand = (): void => {
    const keptSpecs = snapshot.specs.filter((spec) => ChipFilterUtil.pressedChipsKeep([spec.folderName], pressedSpecKeys));
    const { workBand } = kanbanModelOf(keptSpecs);
    DomUtil.setText(WORK_BAND_COUNT_ELEMENT_ID, String(workBand.cardCount));
    workBoard.showBoard(laneBoardMarkup(workBand.lanes));
    dimmedForSpecKey = null;
    chipGroup.reflect(pressedSpecKeys, workItemCountBySpec);
  };

  const dimOtherSpecs = (specKey: string | null): void => {
    if (specKey === dimmedForSpecKey) {
      return;
    }
    dimmedForSpecKey = specKey;
    for (const card of document.getElementById(WORK_BOARD_ELEMENT_ID)?.querySelectorAll<HTMLElement>(`[${WORK_ITEM_ID_ATTRIBUTE}]`) ?? []) {
      const cardSpecKey = specKeyByWorkItemId.get(card.getAttribute(WORK_ITEM_ID_ATTRIBUTE) ?? '') ?? null;
      card.toggleAttribute(DIMMED_ATTRIBUTE, specKey !== null && cardSpecKey !== specKey);
    }
  };

  const specKeyUnder = (target: EventTarget | null): string | null => (
    target instanceof Element ? target.closest(`[${SPEC_KEY_ATTRIBUTE}]`)?.getAttribute(SPEC_KEY_ATTRIBUTE) ?? null : null
  );

  const wireHoverDimming = (): void => {
    const specsBoardElement = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
    specsBoardElement?.addEventListener('mouseover', (event) => dimOtherSpecs(specKeyUnder(event.target)));
    specsBoardElement?.addEventListener('mouseleave', () => dimOtherSpecs(null));
    specsBoardElement?.addEventListener('focusin', (event) => dimOtherSpecs(specKeyUnder(event.target)));
    specsBoardElement?.addEventListener('focusout', () => dimOtherSpecs(null));
  };

  const wireStrip = (): void => {
    DomUtil.setHidden(SPEC_STRIP_ELEMENT_ID, snapshot.specs.length === 0);
    DomUtil.setMarkup(SPEC_CHIPS_ELEMENT_ID, snapshot.specs.map((spec) => {
      const specMark = SpecGroupMarks.specMarkOf(spec);
      return filterChipMarkup(SPEC_MARK_VOCABULARY.filterChipAttribute, { value: spec.folderName, label: specMark.title, slot: specMark.slot });
    }).join(''));
    chipGroup.wire((specKey) => {
      pressedSpecKeys = ChipFilterUtil.toggledChips(pressedSpecKeys, specKey);
      preferences.writeKanbanSpecFilter(pressedSpecKeys);
      showWorkBand();
    });
  };

  const updateOverflow = (): void => {
    for (const board of boards) {
      board.updateOverflow();
    }
  };

  return {
    wire: () => {
      const { specsBand } = kanbanModelOf(snapshot.specs);
      DomUtil.setText(SPECS_BAND_COUNT_ELEMENT_ID, String(specsBand.cardCount));
      specsBoard.showBoard(laneBoardMarkup(specsBand.lanes));
      wireStrip();
      showWorkBand();
      for (const board of boards) {
        board.wire();
      }
      wireTabOverflow(boards);
      wireHoverDimming();
      wireStatisticLanes(SUMMARY_ELEMENT_ID, (laneKey) => {
        if (SPEC_LANES.some((lane) => lane === laneKey)) {
          specsBoard.showLane(laneKey);
        }
      });
      window.addEventListener('resize', updateOverflow);
    },
    updateOverflow,
  };
}

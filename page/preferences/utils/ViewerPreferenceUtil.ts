/**
 * The viewer's stored choices and reload snapshot read back with their defaults and written in their encodings, and the two toggles; no
 * storage is touched here.
 */

import type {
  DetailTarget,
  DetailTargetKind,
  FinishedWorkChoice,
  ReloadSnapshot,
} from '../../@types/ViewerChoices.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }                   from '../../kanban/constants/KanbanBoardLayout.ts';
import { ChartPreferenceUtil }                            from '../../progress/utils/ChartPreferenceUtil.ts';
import { ScreenSignatureUtil }                            from '../../reload/utils/ScreenSignatureUtil.ts';
import { TicketViewUtil }                                 from '../../tickets/utils/TicketViewUtil.ts';
import { DEFAULT_FINISHED_WORK_CHOICE, FinishedWorkUtil } from '../../utils/FinishedWorkUtil.ts';
import { JsonValueUtil }                                  from '../../utils/JsonValueUtil.ts';
import { DEFAULT_ABANDONED_LANE_CHOICE }                  from '../constants/PreferenceDefaults.ts';

const ABANDONED_LANE_OPEN_CHOICE = 'open';

const DETAIL_TARGET_KINDS: readonly DetailTargetKind[] = ['task', 'ticket', 'kanban-card', 'epic'];

function detailTargetFrom(value: unknown): DetailTarget | null {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return null;
  }
  const kind = DETAIL_TARGET_KINDS.find((candidate) => candidate === value['kind']);
  const id   = JsonValueUtil.textOrNull(value['id']);
  return kind === undefined || id === null ? null : { kind, id };
}

/** A snapshot of another tracker, or one that is not a record, is no snapshot; an unreadable scroll offset or text reads as the top or empty. */
function reloadSnapshotFrom(value: unknown, trackerId: string): ReloadSnapshot | null {
  if (!JsonValueUtil.valueIsRecord(value) || value['trackerId'] !== trackerId) {
    return null;
  }
  const offsetOf = (key: string): number => Math.max(0, JsonValueUtil.finiteNumberOrNull(value[key]) ?? 0);
  return {
    trackerId,
    tabName:            JsonValueUtil.textOrNull(value['tabName']) ?? '',
    windowScrollTop:    offsetOf('windowScrollTop'),
    chartScrollLeft:    offsetOf('chartScrollLeft'),
    chartScrollTop:     offsetOf('chartScrollTop'),
    kanbanScrollLeft:   offsetOf('kanbanScrollLeft'),
    fromText:           JsonValueUtil.textOrNull(value['fromText']) ?? '',
    toText:             JsonValueUtil.textOrNull(value['toText']) ?? '',
    rangePopoverIsOpen: value['rangePopoverIsOpen'] === true,
    ticketView:         TicketViewUtil.ticketViewFrom(value['ticketView']),
    detailTarget:       detailTargetFrom(value['detailTarget']),
    detailScrollTop:    offsetOf('detailScrollTop'),
    screenSignature:    ScreenSignatureUtil.screenSignatureFrom(value['screenSignature']),
  };
}

// The hide-finished checkbox stored `recent` for its last-day window; its `all` is the custom all, stored in the same word.
const RETIRED_RECENT_VISIBILITY = 'recent';

function finishedWorkChoiceFrom(value: unknown): FinishedWorkChoice {
  if (value === RETIRED_RECENT_VISIBILITY) {
    return DEFAULT_FINISHED_WORK_CHOICE;
  }
  return FinishedWorkUtil.choiceFrom(value) ?? DEFAULT_FINISHED_WORK_CHOICE;
}

function abandonedLaneIsOpenFrom(stored: string | null): boolean {
  return stored === ABANDONED_LANE_OPEN_CHOICE;
}

/** The closed choice is the default, which the page stores by removing the key. */
function abandonedLaneChoiceFor(laneIsOpen: boolean): string {
  return laneIsOpen ? ABANDONED_LANE_OPEN_CHOICE : DEFAULT_ABANDONED_LANE_CHOICE;
}

function shownCountFrom(stored: string | null): number {
  return stored === null ? CAPPED_LANE_FIRST_PAGE_CARDS : Number(stored);
}

// The chart's own choices live beside the chart, so the spec page reads them without this module; they are kept here as delegates.
export const ViewerPreferenceUtil = {
  storedOverrideFrom:     ChartPreferenceUtil.storedOverrideFrom,
  reloadSnapshotFrom,
  overrideIsEmpty:        ChartPreferenceUtil.overrideIsEmpty,
  finishedWorkChoiceFrom,
  nameColumnWidthFrom:    ChartPreferenceUtil.nameColumnWidthFrom,
  toggledNameColumnWidth: ChartPreferenceUtil.toggledNameColumnWidth,
  abandonedLaneIsOpenFrom,
  abandonedLaneChoiceFor,
  shownCountFrom,
} as const;

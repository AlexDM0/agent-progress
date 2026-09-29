/**
 * The viewer's stored choices and reload snapshot read back with their defaults and written in their encodings, and the two toggles; no
 * storage is touched here.
 */

import type {
  DetailTarget,
  DetailTargetKind,
  NameColumnWidth,
  ReloadSnapshot,
  StoredViewOverride,
  WorkVisibility,
} from '../../@types/ViewerChoices.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }                                                      from '../../kanban/constants/KanbanBoardLayout.ts';
import { TicketViewUtil }                                                                    from '../../tickets/utils/TicketViewUtil.ts';
import { JsonValueUtil }                                                                     from '../../utils/JsonValueUtil.ts';
import { DEFAULT_ABANDONED_LANE_CHOICE, DEFAULT_NAME_COLUMN_WIDTH, DEFAULT_WORK_VISIBILITY } from '../constants/PreferenceDefaults.ts';
import { EMPTY_VIEW_OVERRIDE }                                                               from '../constants/ViewOverride.ts';

const ABANDONED_LANE_OPEN_CHOICE = 'open';

function storedOverrideFrom(value: unknown): StoredViewOverride {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return EMPTY_VIEW_OVERRIDE;
  }
  return {
    presetKey:   JsonValueUtil.textOrNull(value['presetKey']),
    fromText:    JsonValueUtil.textOrNull(value['fromText']),
    toText:      JsonValueUtil.textOrNull(value['toText']),
    tickMinutes: JsonValueUtil.finiteNumberOrNull(value['tickMinutes']),
  };
}

const DETAIL_TARGET_KINDS: readonly DetailTargetKind[] = ['task', 'ticket', 'kanban-card'];

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
  };
}

function overrideIsEmpty(override: StoredViewOverride): boolean {
  return override.fromText === null && override.toText === null && override.tickMinutes === null;
}

function workVisibilityFrom(value: unknown): WorkVisibility {
  return value === 'all' ? 'all' : DEFAULT_WORK_VISIBILITY;
}

function nameColumnWidthFrom(value: unknown): NameColumnWidth {
  return value === 'wide' ? 'wide' : DEFAULT_NAME_COLUMN_WIDTH;
}

function toggledNameColumnWidth(width: NameColumnWidth): NameColumnWidth {
  return width === 'wide' ? 'normal' : 'wide';
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

export const ViewerPreferenceUtil = {
  storedOverrideFrom,
  reloadSnapshotFrom,
  overrideIsEmpty,
  workVisibilityFrom,
  nameColumnWidthFrom,
  toggledNameColumnWidth,
  abandonedLaneIsOpenFrom,
  abandonedLaneChoiceFor,
  shownCountFrom,
} as const;

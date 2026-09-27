/** The viewer's stored choices read back with their defaults and written in their encodings, and the two toggles; no storage is touched here. */

import type {
  LogVisibility,
  NameColumnWidth,
  StoredViewOverride,
  WorkVisibility,
} from '../../@types/ViewerChoices.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS } from '../../constants/CappedLanePaging.ts';
import { JsonValueUtil }                from '../../utils/JsonValueUtil.ts';
import {
  DEFAULT_ABANDONED_LANE_CHOICE,
  DEFAULT_LOG_VISIBILITY,
  DEFAULT_NAME_COLUMN_WIDTH,
  DEFAULT_WORK_VISIBILITY,
} from '../constants/PreferenceDefaults.ts';
import { EMPTY_VIEW_OVERRIDE } from '../constants/ViewOverride.ts';

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

function overrideIsEmpty(override: StoredViewOverride): boolean {
  return override.fromText === null && override.toText === null && override.tickMinutes === null;
}

function workVisibilityFrom(value: unknown): WorkVisibility {
  return value === 'all' ? 'all' : DEFAULT_WORK_VISIBILITY;
}

function logVisibilityFrom(value: unknown): LogVisibility {
  return value === 'all' ? 'all' : DEFAULT_LOG_VISIBILITY;
}

function toggledLogVisibility(visibility: LogVisibility): LogVisibility {
  return visibility === 'all' ? 'newest' : 'all';
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
  overrideIsEmpty,
  workVisibilityFrom,
  logVisibilityFrom,
  toggledLogVisibility,
  nameColumnWidthFrom,
  toggledNameColumnWidth,
  abandonedLaneIsOpenFrom,
  abandonedLaneChoiceFor,
  shownCountFrom,
} as const;

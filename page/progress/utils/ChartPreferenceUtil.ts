/** The Progress chart's stored choices, read back with their defaults, and the name column's toggle; no storage is touched here. */

import type { NameColumnWidth, StoredViewOverride } from '../../@types/ViewerChoices.ts';
import { DEFAULT_NAME_COLUMN_WIDTH }                from '../../preferences/constants/PreferenceDefaults.ts';
import { EMPTY_VIEW_OVERRIDE }                      from '../../preferences/constants/ViewOverride.ts';
import { JsonValueUtil }                            from '../../utils/JsonValueUtil.ts';

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

function nameColumnWidthFrom(value: unknown): NameColumnWidth {
  return value === 'wide' ? 'wide' : DEFAULT_NAME_COLUMN_WIDTH;
}

function toggledNameColumnWidth(width: NameColumnWidth): NameColumnWidth {
  return width === 'wide' ? 'normal' : 'wide';
}

export const ChartPreferenceUtil = {
  storedOverrideFrom,
  overrideIsEmpty,
  nameColumnWidthFrom,
  toggledNameColumnWidth,
} as const;

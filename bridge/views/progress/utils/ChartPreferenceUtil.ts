/** The Progress chart's stored choices read back with their defaults, and the name column's toggle; no storage is touched here. */

/** The range the viewer laid over the tracker's own, stored as the static page stored it: JSON under the bare board prefix. */
export interface StoredViewOverride {
  readonly presetKey:   string | null;
  readonly fromText:    string | null;
  readonly toText:      string | null;
  readonly tickMinutes: number | null;
}

export type NameColumnWidth = 'normal' | 'wide';

export const EMPTY_VIEW_OVERRIDE: StoredViewOverride = Object.freeze({
  presetKey:   null,
  fromText:    null,
  toText:      null,
  tickMinutes: null,
});

export const DEFAULT_NAME_COLUMN_WIDTH: NameColumnWidth = 'normal';

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function storedOverrideFrom(value: unknown): StoredViewOverride {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return EMPTY_VIEW_OVERRIDE;
  const record = value as Record<string, unknown>;
  return {
    presetKey:   textOrNull(record['presetKey']),
    fromText:    textOrNull(record['fromText']),
    toText:      textOrNull(record['toText']),
    tickMinutes: finiteNumberOrNull(record['tickMinutes']),
  };
}

/** Unparseable or absent text reads as no override. */
function storedOverrideFromText(storedText: string | null): StoredViewOverride {
  if (storedText === null) return EMPTY_VIEW_OVERRIDE;
  try {
    return storedOverrideFrom(JSON.parse(storedText));
  } catch {
    return EMPTY_VIEW_OVERRIDE;
  }
}

function overrideIsEmpty(override: StoredViewOverride): boolean {
  return override.fromText === null && override.toText === null && override.tickMinutes === null;
}

/** An empty override is stored by removing the key. */
function storedTextOfOverride(override: StoredViewOverride): string | null {
  return overrideIsEmpty(override) ? null : JSON.stringify(override);
}

function nameColumnWidthFrom(value: unknown): NameColumnWidth {
  return value === 'wide' ? 'wide' : DEFAULT_NAME_COLUMN_WIDTH;
}

function toggledNameColumnWidth(width: NameColumnWidth): NameColumnWidth {
  return width === 'wide' ? 'normal' : 'wide';
}

export const ChartPreferenceUtil = Object.freeze({
  storedOverrideFrom,
  storedOverrideFromText,
  overrideIsEmpty,
  storedTextOfOverride,
  nameColumnWidthFrom,
  toggledNameColumnWidth,
});

/** Whether the chart's task column is at its normal width or widened so a long name fits; the widths themselves are the template's CSS. */

export type NameColumnWidth = 'normal' | 'wide';

export const DEFAULT_NAME_COLUMN_WIDTH: NameColumnWidth = 'normal';

/** The attribute on the document element the template's `--col-name` override is keyed on. */
export const NAME_COLUMN_WIDTH_ATTRIBUTE = 'data-name-column';

export function nameColumnWidthFrom(value: unknown): NameColumnWidth {
  return value === 'wide' ? 'wide' : DEFAULT_NAME_COLUMN_WIDTH;
}

export function nameColumnWidthStorageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}:name-column`;
}

export function toggledNameColumnWidth(width: NameColumnWidth): NameColumnWidth {
  return width === 'wide' ? 'normal' : 'wide';
}

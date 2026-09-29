/** The Progress chart's fixed choices: the range presets, the automatic choices, the Fit margin, the name-column attribute and the label gutters. */

export const RANGE_PRESET_BOUNDS: Readonly<Record<string, { fromText: string | null; toText: string | null }>> = {
  'fit': { fromText: null, toText: null },
  '1h':  { fromText: '-1h', toText: 'now' },
  '4h':  { fromText: '-4h', toText: 'now' },
  '12h': { fromText: '-12h', toText: 'now' },
  '24h': { fromText: '-24h', toText: 'now' },
  '7d':  { fromText: '-7d', toText: 'now' },
};

/** The default: the range follows the rows shown. A stored `auto` from before Fit reads as it. */
export const FIT_RANGE_PRESET         = 'fit';
export const RETIRED_AUTOMATIC_PRESET = 'auto';
/** Pressed while typed bounds are in use; it opens the custom range popover rather than naming bounds of its own. */
export const CUSTOM_RANGE_PRESET      = 'custom';
export const AUTOMATIC_TICK_CHOICE    = 'auto';

/** Fit leaves this share of its span free before the earliest start and after now … */
export const FIT_MARGIN_SHARE           = 0.03;
/** … and never less than this. */
export const FIT_MARGIN_MINIMUM_MINUTES = 5;

/** The attribute on the document element the template's `--col-name` override is keyed on. */
export const NAME_COLUMN_WIDTH_ATTRIBUTE = 'data-name-column';

/** The gap between a tick label moved left of its line and that line. */
export const TICK_LABEL_GUTTER_PIXELS = 5;

/** The now label with its offset from the marker; a marker nearer the right edge than this carries its label on its left. */
export const NOW_LABEL_ROOM_PIXELS = 36;

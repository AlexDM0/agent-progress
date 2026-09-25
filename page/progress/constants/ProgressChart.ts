/** The Progress chart's fixed choices: the range presets the range bar offers, its automatic choices, and the name-column attribute. */

export const RANGE_PRESET_BOUNDS: Readonly<Record<string, { fromText: string | null; toText: string | null }>> = {
  'auto': { fromText: null, toText: null },
  '1h':   { fromText: '-1h', toText: 'now' },
  '4h':   { fromText: '-4h', toText: 'now' },
  '12h':  { fromText: '-12h', toText: 'now' },
  '24h':  { fromText: '-24h', toText: 'now' },
  '7d':   { fromText: '-7d', toText: 'now' },
  'all':  { fromText: 'start', toText: 'now' },
};

export const AUTOMATIC_RANGE_PRESET = 'auto';
export const AUTOMATIC_TICK_CHOICE  = 'auto';

/** The attribute on the document element the template's `--col-name` override is keyed on. */
export const NAME_COLUMN_WIDTH_ATTRIBUTE = 'data-name-column';

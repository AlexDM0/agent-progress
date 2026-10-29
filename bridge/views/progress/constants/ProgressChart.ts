/** The Progress chart's fixed choices: the range presets and Fit's margin, as the static page's chart has them. */

export const RANGE_PRESET_BOUNDS: Readonly<Record<string, { fromText: string | null; toText: string | null }>> = {
  'fit': { fromText: null, toText: null },
  '1h':  { fromText: '-1h', toText: 'now' },
  '4h':  { fromText: '-4h', toText: 'now' },
  '12h': { fromText: '-12h', toText: 'now' },
  '24h': { fromText: '-24h', toText: 'now' },
  '7d':  { fromText: '-7d', toText: 'now' },
};

/** The default: the range follows the rows shown. */
export const FIT_RANGE_PRESET = 'fit';

/** Fit leaves this share of its span free before the earliest start and after now … */
export const FIT_MARGIN_SHARE           = 0.03;
/** … and never less than this. */
export const FIT_MARGIN_MINIMUM_MINUTES = 5;

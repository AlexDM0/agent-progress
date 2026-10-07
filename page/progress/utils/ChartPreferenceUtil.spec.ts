/**
 * The chart's stored choices read back. The cases that matter: a stored range override keeps only its readable fields and anything else
 * reads as no override; an override with no bounds and no tick is empty, so it is stored by removing the key; an unknown name column
 * width reads as the default; and the toggle swaps the two widths.
 */

import { describe, expect, test } from 'bun:test';

import { EMPTY_VIEW_OVERRIDE } from '../../preferences/constants/ViewOverride.ts';
import { ChartPreferenceUtil } from './ChartPreferenceUtil.ts';

describe('ChartPreferenceUtil', () => {
  test('reads a stored override field by field, an unreadable field as null', () => {
    expect(ChartPreferenceUtil.storedOverrideFrom({
      presetKey: '4h', fromText: '-4h', toText: 'now', tickMinutes: 'often'
    })).toEqual({
      presetKey: '4h', fromText: '-4h', toText: 'now', tickMinutes: null,
    });
  });

  test('reads anything but a record as no override', () => {
    expect(ChartPreferenceUtil.storedOverrideFrom('4h')).toEqual(EMPTY_VIEW_OVERRIDE);
  });

  test('calls an override empty only without bounds and without a tick', () => {
    expect(ChartPreferenceUtil.overrideIsEmpty({ ...EMPTY_VIEW_OVERRIDE, presetKey: 'fit' })).toBe(true);
    expect(ChartPreferenceUtil.overrideIsEmpty({ ...EMPTY_VIEW_OVERRIDE, tickMinutes: 15 })).toBe(false);
  });

  test('reads an unknown name column width as normal, and toggles between the two', () => {
    expect(ChartPreferenceUtil.nameColumnWidthFrom('huge')).toBe('normal');
    expect(ChartPreferenceUtil.toggledNameColumnWidth(ChartPreferenceUtil.nameColumnWidthFrom('wide'))).toBe('normal');
    expect(ChartPreferenceUtil.toggledNameColumnWidth('normal')).toBe('wide');
  });
});

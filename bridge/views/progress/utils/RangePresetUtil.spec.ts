/**
 * Which preset a stored override presses. The cases that matter: no bounds is Fit, a stored `auto` from before Fit is Fit, a picked
 * preset stays pressed, bounds under a retired or unknown key read as Custom, and picking a preset keeps the chosen tick size while Fit
 * drops both the bounds and the tick size.
 */
import { describe, expect, test } from 'bun:test';

import { EMPTY_VIEW_OVERRIDE, type StoredViewOverride } from './ChartPreferenceUtil.ts';
import { RangePresetUtil }                              from './RangePresetUtil.ts';

const { pressedPresetOf, modeLabelOf, overrideOfPreset } = RangePresetUtil;

function overrideWith(changes: Partial<StoredViewOverride>): StoredViewOverride {
  return { ...EMPTY_VIEW_OVERRIDE, ...changes };
}

describe('pressedPresetOf', () => {
  test('presses Fit without typed bounds, a stored auto included', () => {
    expect(pressedPresetOf(EMPTY_VIEW_OVERRIDE)).toBe('fit');
    expect(pressedPresetOf(overrideWith({ presetKey: 'auto' }))).toBe('fit');
    expect(pressedPresetOf(overrideWith({ presetKey: 'fit', tickMinutes: 15 }))).toBe('fit');
  });

  test('keeps a picked preset pressed', () => {
    const picked = overrideWith({ presetKey: '4h', fromText: '-4h', toText: 'now' });
    expect(pressedPresetOf(picked)).toBe('4h');
    expect(modeLabelOf(pressedPresetOf(picked))).toBe('4h');
  });

  test('reads typed bounds, and the retired All preset, as Custom', () => {
    expect(pressedPresetOf(overrideWith({ fromText: '-90m', toText: 'now' }))).toBe('custom');
    expect(pressedPresetOf(overrideWith({ presetKey: 'all', fromText: 'start', toText: 'now' }))).toBe('custom');
    expect(pressedPresetOf(overrideWith({ presetKey: 'constructor', fromText: 'start', toText: 'now' }))).toBe('custom');
    expect(modeLabelOf('custom')).toBe('Custom');
    expect(modeLabelOf('fit')).toBe('Fit');
  });
});

describe('overrideOfPreset', () => {
  test('gives a preset its bounds and keeps the chosen tick size', () => {
    expect(overrideOfPreset('4h', overrideWith({ tickMinutes: 15 }))).toEqual({
      presetKey: '4h', fromText: '-4h', toText: 'now', tickMinutes: 15
    });
  });

  test('drops the bounds and the tick size for Fit', () => {
    expect(overrideOfPreset('fit', overrideWith({
      presetKey: '4h', fromText: '-4h', toText: 'now', tickMinutes: 15
    }))).toEqual({
      presetKey: 'fit', fromText: null, toText: null, tickMinutes: null
    });
  });
});

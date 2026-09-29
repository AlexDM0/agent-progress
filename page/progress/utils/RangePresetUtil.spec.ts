/**
 * Which preset a stored override presses. The cases that matter: no bounds is Fit, a stored `auto` from before Fit is Fit, a picked
 * preset stays pressed and held until Fit is picked, and bounds under a retired or unknown key read as Custom.
 */

import { describe, expect, test }  from 'bun:test';
import type { StoredViewOverride } from '../../@types/ViewerChoices.ts';
import { EMPTY_VIEW_OVERRIDE }     from '../../preferences/constants/ViewOverride.ts';
import { RangePresetUtil }         from './RangePresetUtil.ts';

const { pressedPresetOf, rangeIsHeld, modeLabelOf } = RangePresetUtil;

function overrideWith(changes: Partial<StoredViewOverride>): StoredViewOverride {
  return { ...EMPTY_VIEW_OVERRIDE, ...changes };
}

describe('pressedPresetOf', () => {
  test('presses Fit without typed bounds, a stored auto included, and does not hold it', () => {
    expect(pressedPresetOf(EMPTY_VIEW_OVERRIDE)).toBe('fit');
    expect(pressedPresetOf(overrideWith({ presetKey: 'auto' }))).toBe('fit');
    expect(pressedPresetOf(overrideWith({ presetKey: 'fit', tickMinutes: 15 }))).toBe('fit');
    expect(rangeIsHeld(EMPTY_VIEW_OVERRIDE)).toBe(false);
  });

  test('keeps a picked preset pressed and held, whatever rows are shown, until Fit replaces it', () => {
    const picked = overrideWith({ presetKey: '4h', fromText: '-4h', toText: 'now' });
    expect(pressedPresetOf(picked)).toBe('4h');
    expect(rangeIsHeld(picked)).toBe(true);
    expect(modeLabelOf(pressedPresetOf(picked))).toBe('4h');
    expect(rangeIsHeld(overrideWith({ presetKey: 'fit' }))).toBe(false);
  });

  test('reads typed bounds, and the retired All preset, as Custom', () => {
    expect(pressedPresetOf(overrideWith({ fromText: '-90m', toText: 'now' }))).toBe('custom');
    expect(pressedPresetOf(overrideWith({ presetKey: 'all', fromText: 'start', toText: 'now' }))).toBe('custom');
    expect(pressedPresetOf(overrideWith({ presetKey: 'constructor', fromText: 'start', toText: 'now' }))).toBe('custom');
    expect(modeLabelOf('custom')).toBe('Custom');
    expect(modeLabelOf('fit')).toBe('Fit');
  });
});

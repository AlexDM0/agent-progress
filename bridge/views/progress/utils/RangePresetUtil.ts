/** Which range preset a stored override presses and how the range button names it. */
import {
  CUSTOM_RANGE_PRESET,
  FIT_RANGE_PRESET,
  RANGE_PRESET_BOUNDS,
  RETIRED_AUTOMATIC_PRESET
} from '../constants/ProgressChart.ts';
import type { StoredViewOverride } from './ChartPreferenceUtil.ts';

/** Fit without typed bounds, a named preset's own key, otherwise Custom… (a stored `all` from before Fit included). */
function pressedPresetOf(override: StoredViewOverride): string {
  if (override.fromText === null || override.toText === null) return FIT_RANGE_PRESET;
  const presetKey = override.presetKey ?? CUSTOM_RANGE_PRESET;
  return presetKey !== FIT_RANGE_PRESET && presetKey !== RETIRED_AUTOMATIC_PRESET && Object.hasOwn(RANGE_PRESET_BOUNDS, presetKey) ? presetKey : CUSTOM_RANGE_PRESET;
}

function modeLabelOf(pressedPreset: string): string {
  if (pressedPreset === FIT_RANGE_PRESET) return 'Fit';
  return pressedPreset === CUSTOM_RANGE_PRESET ? 'Custom' : pressedPreset;
}

/** Picking a preset keeps the tick size the viewer chose; Fit drops the bounds and the tick size, choosing its ticks for the span it fits. */
function overrideOfPreset(presetKey: string, current: StoredViewOverride): StoredViewOverride {
  const bounds = Object.hasOwn(RANGE_PRESET_BOUNDS, presetKey) ? RANGE_PRESET_BOUNDS[presetKey] : undefined;
  return {
    presetKey,
    fromText:    bounds?.fromText ?? null,
    toText:      bounds?.toText ?? null,
    tickMinutes: presetKey === FIT_RANGE_PRESET ? null : current.tickMinutes,
  };
}

export const RangePresetUtil = Object.freeze({ pressedPresetOf, modeLabelOf, overrideOfPreset });

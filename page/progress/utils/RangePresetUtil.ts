/** Which range preset a stored override presses and how the range note names it. DOM-free. */

import type { StoredViewOverride } from '../../@types/ViewerChoices.ts';
import {
  CUSTOM_RANGE_PRESET,
  FIT_RANGE_PRESET,
  RANGE_PRESET_BOUNDS,
  RETIRED_AUTOMATIC_PRESET,
} from '../constants/ProgressChart.ts';

/** Fit without typed bounds, a named preset's own key, otherwise Custom… (a stored `all` from before Fit included). */
function pressedPresetOf(override: StoredViewOverride): string {
  if (override.fromText === null || override.toText === null) {
    return FIT_RANGE_PRESET;
  }
  const presetKey = override.presetKey ?? CUSTOM_RANGE_PRESET;
  return presetKey !== FIT_RANGE_PRESET && presetKey !== RETIRED_AUTOMATIC_PRESET && Object.hasOwn(RANGE_PRESET_BOUNDS, presetKey) ? presetKey : CUSTOM_RANGE_PRESET;
}

/** Every preset but Fit holds its range whatever the finished-work switch shows. */
function rangeIsHeld(override: StoredViewOverride): boolean {
  return pressedPresetOf(override) !== FIT_RANGE_PRESET;
}

function modeLabelOf(pressedPreset: string): string {
  if (pressedPreset === FIT_RANGE_PRESET) {
    return 'Fit';
  }
  return pressedPreset === CUSTOM_RANGE_PRESET ? 'Custom' : pressedPreset;
}

export const RangePresetUtil = {
  pressedPresetOf,
  rangeIsHeld,
  modeLabelOf,
} as const;

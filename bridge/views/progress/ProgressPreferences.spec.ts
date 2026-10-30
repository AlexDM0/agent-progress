/**
 * The Progress chart's stored choices. What matters: the range survives a reload for the same viewer, read back by a fresh store over the
 * same storage; every choice keeps the static page's key, the range as JSON under the bare board prefix, so a choice made on the static
 * page reads here; Fit, the default, removes the range key; another board's range is not read; and without a board store every choice
 * reads as its default and nothing is written.
 */
import { describe, expect, test } from 'bun:test';

import { PRODUCT_NAMES }          from '../../../src/shared/constants/ProductNames.ts';
import type { PreferenceStorage } from '../../@types/PreferenceStorage.ts';
import { boardPreferenceStoreOf } from '../../preferences/PreferenceStore.ts';
import { progressPreferencesOf }  from './ProgressPreferences.ts';
import { EMPTY_VIEW_OVERRIDE }    from './utils/ChartPreferenceUtil.ts';
import { RangePresetUtil }        from './utils/RangePresetUtil.ts';

const BOARD_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker`;

function storageOver(entries: Map<string, string>): () => PreferenceStorage {
  return () => ({
    getItem:    (key) => entries.get(key) ?? null,
    setItem:    (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  });
}

function preferencesOver(entries: Map<string, string>, trackerId = 'example-tracker') {
  return progressPreferencesOf(boardPreferenceStoreOf(trackerId, storageOver(entries)));
}

describe('the range', () => {
  test('survives a reload for the same viewer, read back by a fresh store over the same storage', () => {
    const entries = new Map<string, string>();
    const custom = {
      presetKey: null, fromText: '-90m', toText: 'now', tickMinutes: 15
    };
    preferencesOver(entries).writeRangeOverride(custom);

    expect(preferencesOver(entries).readRangeOverride()).toEqual(custom);
  });

  test('is stored as the static page stored it, JSON under the bare board prefix, and reads what the static page stored', () => {
    const entries = new Map<string, string>();
    preferencesOver(entries).writeRangeOverride(RangePresetUtil.overrideOfPreset('4h', EMPTY_VIEW_OVERRIDE));

    expect([...entries]).toEqual([[BOARD_KEY, '{"presetKey":"4h","fromText":"-4h","toText":"now","tickMinutes":null}']]);

    entries.set(BOARD_KEY, '{"presetKey":"24h","fromText":"-24h","toText":"now","tickMinutes":60}');
    expect(preferencesOver(entries).readRangeOverride()).toEqual({
      presetKey: '24h', fromText: '-24h', toText: 'now', tickMinutes: 60
    });
  });

  test('removes its key when Fit is chosen, and keeps another board\'s range apart', () => {
    const entries = new Map<string, string>();
    preferencesOver(entries).writeRangeOverride(RangePresetUtil.overrideOfPreset('4h', EMPTY_VIEW_OVERRIDE));
    preferencesOver(entries, 'other-tracker').writeRangeOverride(RangePresetUtil.overrideOfPreset('fit', EMPTY_VIEW_OVERRIDE));

    expect(preferencesOver(entries, 'other-tracker').readRangeOverride()).toEqual(EMPTY_VIEW_OVERRIDE);
    expect(preferencesOver(entries).readRangeOverride().presetKey).toBe('4h');

    preferencesOver(entries).writeRangeOverride(RangePresetUtil.overrideOfPreset('fit', EMPTY_VIEW_OVERRIDE));
    expect(entries.size).toBe(0);
  });
});

test('keeps the name column, the folded epic groups and the review rows under the static page\'s keys', () => {
  const entries = new Map<string, string>();
  const preferences = preferencesOver(entries);
  preferences.writeNameColumnWidth('wide');
  preferences.writeFoldedEpicGroups(['checkout', 'no epic']);
  preferences.writeReviewRowsAreShown(true);

  expect([...entries]).toEqual([
    [`${BOARD_KEY}:name-column`, 'wide'],
    [`${BOARD_KEY}:progress-folded-epics`, '["checkout","no epic"]'],
    [`${BOARD_KEY}:review-rows`, 'rows'],
  ]);
  const reloaded = preferencesOver(entries);
  expect([reloaded.readNameColumnWidth(), reloaded.readFoldedEpicGroups(), reloaded.readReviewRowsAreShown()]).toEqual(['wide', ['checkout', 'no epic'], true]);
});

test('reads every choice as its default without a board store, and writes nothing', () => {
  const preferences = progressPreferencesOf(null);
  preferences.writeRangeOverride(RangePresetUtil.overrideOfPreset('4h', EMPTY_VIEW_OVERRIDE));

  expect(preferences.readRangeOverride()).toEqual(EMPTY_VIEW_OVERRIDE);
  expect(preferences.readNameColumnWidth()).toBe('normal');
  expect(preferences.readFoldedEpicGroups()).toEqual([]);
  expect(preferences.readReviewRowsAreShown()).toBe(false);
});

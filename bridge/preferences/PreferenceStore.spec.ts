/**
 * The preference store over an in-memory storage. What matters: the keys keep the static page's form, `<STORAGE_PREFIX>:theme` and
 * `<STORAGE_PREFIX>:<trackerId>:<choice>`; a default choice removes its key; blocked storage reads nothing and never throws.
 */
import { describe, expect, test } from 'bun:test';

import { PRODUCT_NAMES }                                   from '../../src/shared/constants/ProductNames.ts';
import type { PreferenceStorage }                          from '../@types/PreferenceStorage.ts';
import { boardPreferenceStoreOf, sharedPreferenceStoreOf } from './PreferenceStore.ts';

function memoryStorage(): { storage: PreferenceStorage; entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    storage: {
      getItem:    (key) => entries.get(key) ?? null,
      setItem:    (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    },
  };
}

describe('the preference store', () => {
  test('keys keep the static page\'s form, and a default choice removes its key', () => {
    const { storage, entries } = memoryStorage();
    sharedPreferenceStoreOf(() => storage).writeChoice('theme', 'dark', 'auto');
    boardPreferenceStoreOf('example-tracker', () => storage).writeChoice('tab', 'agents', 'kanban');
    expect([...entries]).toEqual([[`${PRODUCT_NAMES.STORAGE_PREFIX}:theme`, 'dark'], [`${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:tab`, 'agents']]);
    sharedPreferenceStoreOf(() => storage).writeChoice('theme', 'auto', 'auto');
    expect([...entries.keys()]).toEqual([`${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:tab`]);
    expect(boardPreferenceStoreOf('example-tracker', () => storage).readChoice('tab')).toBe('agents');
  });

  test('a text list is stored as the static page stored the Kanban\'s epic filter, a JSON list under its own key, and an empty one removes it', () => {
    const { storage, entries } = memoryStorage();
    const store = boardPreferenceStoreOf('example-tracker', () => storage);
    store.writeTextList('kanban-epics', ['checkout', 'no epic']);
    expect([...entries]).toEqual([[`${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:kanban-epics`, '["checkout","no epic"]']]);
    expect(store.readTextList('kanban-epics')).toEqual(['checkout', 'no epic']);
    store.writeTextList('kanban-epics', []);
    expect(entries.size).toBe(0);
  });

  test('a stored text list that is not a JSON list of texts reads as the empty list, and a mixed one keeps only its texts', () => {
    const { storage, entries } = memoryStorage();
    const store = boardPreferenceStoreOf('example-tracker', () => storage);
    entries.set(`${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:kanban-epics`, '{not json');
    expect(store.readTextList('kanban-epics')).toEqual([]);
    entries.set(`${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:kanban-epics`, '["checkout",4]');
    expect(store.readTextList('kanban-epics')).toEqual(['checkout']);
  });

  test('blocked storage reads nothing and drops a write without throwing', () => {
    const blocked = (): PreferenceStorage => {
      throw new Error('storage is blocked');
    };
    const store = sharedPreferenceStoreOf(blocked);
    expect(store.readChoice('theme')).toBeNull();
    expect(() => store.writeChoice('theme', 'dark', 'auto')).not.toThrow();
  });
});

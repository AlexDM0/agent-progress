/**
 * The preference store, driven through the storage it writes to. The cases that matter: a choice's key is the prefix, a colon and its name,
 * while text sits under the bare prefix, so both pages' key strings stay what a viewer's browser holds; a choice at its default and an empty
 * list remove their key, so a viewer who never departs from a default leaves nothing behind; and storage that throws on reach reads as
 * nothing and drops every write without throwing, because the page must still render where the browser blocks storage.
 */
import { describe, expect, test } from 'bun:test';

import type { PreferenceStorage } from '../@types/ViewerChoices.ts';
import { createPreferenceStore }  from './PreferenceStore.ts';

const EXAMPLE_KEY_PREFIX = 'example-page:example-tracker';

interface InMemoryStorage extends PreferenceStorage {
  readonly entries: Map<string, string>;
}

function inMemoryStorage(): InMemoryStorage {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function blockedStorage(): PreferenceStorage {
  throw new Error('storage is blocked');
}

describe('createPreferenceStore', () => {
  test('keeps a choice and a list under the prefix and the choice name, and text under the bare prefix', () => {
    const storage = inMemoryStorage();
    const store = createPreferenceStore(EXAMPLE_KEY_PREFIX, () => storage);

    store.writeChoice('grouping', 'epic', 'none');
    store.writeTextList('pressed-chips', ['first', 'second']);
    store.writeText('{"range":"week"}');

    expect([...storage.entries]).toEqual([
      ['example-page:example-tracker:grouping', 'epic'],
      ['example-page:example-tracker:pressed-chips', '["first","second"]'],
      ['example-page:example-tracker', '{"range":"week"}'],
    ]);
    expect(store.readChoice('grouping')).toBe('epic');
    expect(store.readTextList('pressed-chips')).toEqual(['first', 'second']);
    expect(store.readText()).toBe('{"range":"week"}');
  });

  test('a choice equal to its default, an empty list and null text each remove their key', () => {
    const storage = inMemoryStorage();
    const store = createPreferenceStore(EXAMPLE_KEY_PREFIX, () => storage);
    store.writeChoice('grouping', 'epic', 'none');
    store.writeTextList('pressed-chips', ['first']);
    store.writeText('stored');

    store.writeChoice('grouping', 'none', 'none');
    store.writeTextList('pressed-chips', []);
    store.writeText(null);

    expect(storage.entries.size).toBe(0);
    expect(store.readChoice('grouping')).toBeNull();
    expect(store.readTextList('pressed-chips')).toEqual([]);
    expect(store.readText()).toBeNull();
  });

  test('reads a stored list that is not JSON, or not a list of text, as empty', () => {
    const storage = inMemoryStorage();
    const store = createPreferenceStore(EXAMPLE_KEY_PREFIX, () => storage);

    storage.setItem('example-page:example-tracker:pressed-chips', '{not json');
    expect(store.readTextList('pressed-chips')).toEqual([]);

    storage.setItem('example-page:example-tracker:pressed-chips', '{"first":1}');
    expect(store.readTextList('pressed-chips')).toEqual([]);
  });

  test('reads null and empty lists, and writes nothing, without throwing, when reaching the storage throws', () => {
    const store = createPreferenceStore(EXAMPLE_KEY_PREFIX, blockedStorage);

    expect(store.readText()).toBeNull();
    expect(store.readChoice('grouping')).toBeNull();
    expect(store.readTextList('pressed-chips')).toEqual([]);
    expect(() => {
      store.writeText('stored');
      store.writeText(null);
      store.writeChoice('grouping', 'epic', 'none');
      store.writeChoice('grouping', 'none', 'none');
      store.writeTextList('pressed-chips', ['first']);
      store.writeTextList('pressed-chips', []);
    }).not.toThrow();
  });

  test('reaches the storage inside each read and write, never once up front', () => {
    let reachCount = 0;
    const storage = inMemoryStorage();
    const store = createPreferenceStore(EXAMPLE_KEY_PREFIX, () => {
      reachCount += 1;
      return storage;
    });
    expect(reachCount).toBe(0);

    store.writeChoice('grouping', 'epic', 'none');
    store.readChoice('grouping');

    expect(reachCount).toBe(2);
  });
});

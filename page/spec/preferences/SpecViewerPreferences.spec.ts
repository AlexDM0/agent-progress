/**
 * The spec page's stored choices. The cases that matter: the strip's choice is kept under `agent-progress-spec:<repositoryKey>:kanban-specs`,
 * a key string that must never change, so two repositories' pages keep their own choice and nothing lands under a tracker page's prefix;
 * releasing every chip removes the key; and blocked storage reads as no choice.
 */
import { describe, expect, test } from 'bun:test';

import type { PreferenceStorage }      from '../../@types/ViewerChoices.ts';
import { createSpecViewerPreferences } from './SpecViewerPreferences.ts';

function inMemoryStorage(): PreferenceStorage & { readonly entries: Map<string, string> } {
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

describe('createSpecViewerPreferences', () => {
  test('keeps the strip’s pressed specs under the repository’s spec key, in pressed order', () => {
    const storage     = inMemoryStorage();
    const preferences = createSpecViewerPreferences('1c76f5bfd7605ed0', () => storage);
    preferences.writeKanbanSpecFilter(['002-product-search', '001-checkout']);
    expect([...storage.entries.keys()]).toEqual(['agent-progress-spec:1c76f5bfd7605ed0:kanban-specs']);
    expect(createSpecViewerPreferences('1c76f5bfd7605ed0', () => storage).readKanbanSpecFilter()).toEqual(['002-product-search', '001-checkout']);
    expect(createSpecViewerPreferences('other-repository', () => storage).readKanbanSpecFilter()).toEqual([]);
  });

  test('releasing every chip removes the key', () => {
    const storage     = inMemoryStorage();
    const preferences = createSpecViewerPreferences('1c76f5bfd7605ed0', () => storage);
    preferences.writeKanbanSpecFilter(['002-product-search']);
    preferences.writeKanbanSpecFilter([]);
    expect(storage.entries.size).toBe(0);
  });

  test('blocked storage reads as no choice and drops the write', () => {
    const preferences = createSpecViewerPreferences('1c76f5bfd7605ed0', () => {
      throw new Error('storage is blocked');
    });
    expect(() => preferences.writeKanbanSpecFilter(['002-product-search'])).not.toThrow();
    expect(preferences.readKanbanSpecFilter()).toEqual([]);
  });
});

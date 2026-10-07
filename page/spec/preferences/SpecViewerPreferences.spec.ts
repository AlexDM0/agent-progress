/**
 * The spec page's stored choices. The cases that matter: the strip's choice is kept under `agent-progress-spec:<repositoryKey>:kanban-specs`,
 * a key string that must never change, so two repositories' pages keep their own choice and nothing lands under a tracker page's prefix;
 * releasing every chip removes the key; blocked storage reads as no choice; and the Tickets tab's view keeps its own keys, a gone spec
 * pressing nothing on read.
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

  test('keeps the Tickets tab’s search and chips under their own keys, a gone spec or unknown state pressing nothing on read', () => {
    const storage     = inMemoryStorage();
    const preferences = createSpecViewerPreferences('1c76f5bfd7605ed0', () => storage);
    preferences.writeTicketsView({ searchText: 'wish', specChips: ['003-wish-list', '009-gone'], stateChips: ['done'] });
    storage.entries.set('agent-progress-spec:1c76f5bfd7605ed0:tickets-states', '["done","stale"]');

    expect([...storage.entries.keys()].toSorted()).toEqual([
      'agent-progress-spec:1c76f5bfd7605ed0:tickets-search',
      'agent-progress-spec:1c76f5bfd7605ed0:tickets-specs',
      'agent-progress-spec:1c76f5bfd7605ed0:tickets-states',
    ]);
    expect(preferences.readTicketsView(new Set(['003-wish-list']))).toEqual({ searchText: 'wish', specChips: ['003-wish-list'], stateChips: ['done'] });
  });

  test('an unnarrowed Tickets view removes its keys', () => {
    const storage     = inMemoryStorage();
    const preferences = createSpecViewerPreferences('1c76f5bfd7605ed0', () => storage);
    preferences.writeTicketsView({ searchText: 'wish', specChips: ['003-wish-list'], stateChips: ['done'] });
    preferences.writeTicketsView({ searchText: '', specChips: [], stateChips: [] });
    expect(storage.entries.size).toBe(0);
  });
});

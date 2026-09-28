/**
 * The viewer's stored page choices, driven through the storage they are written to. The cases that matter: every key string and encoding stays
 * what a viewer's browser already holds, two trackers never share a key, a choice at its default leaves nothing behind, anything unreadable
 * falls back to the default, and blocked storage never throws. The reload snapshot is taken back exactly once and only by its own tracker.
 */

import { describe, expect, test } from 'bun:test';
import type {
  PreferenceStorage,
  ReloadSnapshot,
  StoredViewOverride,
  ViewerPreferences,
} from '../@types/ViewerChoices.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }                       from '../kanban/constants/KanbanBoardLayout.ts';
import { createReloadSnapshotStore, createViewerPreferences } from './ViewerPreferences.ts';
import { DEFAULT_NAME_COLUMN_WIDTH, DEFAULT_WORK_VISIBILITY } from './constants/PreferenceDefaults.ts';
import { EMPTY_VIEW_OVERRIDE }                                from './constants/ViewOverride.ts';
import { ViewerPreferenceUtil }                               from './utils/ViewerPreferenceUtil.ts';

const EXAMPLE_TRACKER_ID         = 'tracker-a';
const ANOTHER_EXAMPLE_TRACKER_ID = 'tracker-b';

function overrideWith(changes: Partial<StoredViewOverride>): StoredViewOverride {
  return { ...EMPTY_VIEW_OVERRIDE, ...changes };
}

interface InMemoryStorage extends PreferenceStorage {
  entries: Map<string, string>;
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

type StoredChoiceName = 'range override' | 'work visibility' | 'name column' | 'Abandoned lane' | 'Done lane count' | 'Abandoned lane count';

// Frozen from the key functions before they moved here: retake by checking out bc42604 and calling the key functions in lib/render/page/.
// Columns: the choice, its key for tracker `tracker-a`, a stored value in its encoding, and the value at which the key is removed.
const FROZEN_STORED_CHOICES: readonly (readonly [StoredChoiceName, string, string, string])[] = [
  [
    'range override',
    'agent-progress:tracker-a',
    '{"presetKey":"4h","fromText":"-4h","toText":"now","tickMinutes":15}',
    '{"presetKey":"auto","fromText":null,"toText":null,"tickMinutes":null}',
  ],
  ['work visibility', 'agent-progress:tracker-a:visibility', 'all', 'recent'],
  ['name column', 'agent-progress:tracker-a:name-column', 'wide', 'normal'],
  ['Abandoned lane', 'agent-progress:tracker-a:kanban-abandoned', 'open', 'closed'],
  ['Done lane count', 'agent-progress:tracker-a:kanban-done-shown', '40', '15'],
  ['Abandoned lane count', 'agent-progress:tracker-a:kanban-abandoned-shown', '40', '15'],
];

/** Writes a choice from its stored encoding and reads it back into that encoding, so the table's text drives the typed module. */
interface StoredChoiceDriver {
  write: (preferences: ViewerPreferences, text: string) => void;
  read:  (preferences: ViewerPreferences) => string;
}

const DRIVER_FOR_STORED_CHOICE: Readonly<Record<StoredChoiceName, StoredChoiceDriver>> = {
  'range override': {
    write: (preferences, text) => preferences.writeRangeOverride(ViewerPreferenceUtil.storedOverrideFrom(JSON.parse(text))),
    read:  (preferences) => JSON.stringify(preferences.readRangeOverride()),
  },
  'work visibility': {
    write: (preferences, text) => preferences.writeWorkVisibility(ViewerPreferenceUtil.workVisibilityFrom(text)),
    read:  (preferences) => preferences.readWorkVisibility(),
  },
  'name column': {
    write: (preferences, text) => preferences.writeNameColumnWidth(ViewerPreferenceUtil.nameColumnWidthFrom(text)),
    read:  (preferences) => preferences.readNameColumnWidth(),
  },
  'Abandoned lane': {
    write: (preferences, text) => preferences.writeAbandonedLaneIsOpen(ViewerPreferenceUtil.abandonedLaneIsOpenFrom(text)),
    read:  (preferences) => ViewerPreferenceUtil.abandonedLaneChoiceFor(preferences.readAbandonedLaneIsOpen()),
  },
  'Done lane count': {
    write: (preferences, text) => preferences.writeCappedLaneShownCount('done', Number(text)),
    read:  (preferences) => String(preferences.readCappedLaneShownCount('done')),
  },
  'Abandoned lane count': {
    write: (preferences, text) => preferences.writeCappedLaneShownCount('abandoned', Number(text)),
    read:  (preferences) => String(preferences.readCappedLaneShownCount('abandoned')),
  },
};

describe('the stored keys and encodings', () => {
  // A viewer's browser already holds these keys; a key that moves silently drops every choice made before the change.
  test.each(FROZEN_STORED_CHOICES)('writes the %s to its key in its encoding', (choice, key, storedValue) => {
    const storage = inMemoryStorage();

    DRIVER_FOR_STORED_CHOICE[choice].write(createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage), storedValue);

    expect([...storage.entries]).toEqual([[key, storedValue]]);
  });

  test.each(FROZEN_STORED_CHOICES)('reads the %s back from its key in its encoding', (choice, key, storedValue) => {
    const storage = inMemoryStorage();
    storage.setItem(key, storedValue);

    expect(DRIVER_FOR_STORED_CHOICE[choice].read(createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage))).toBe(storedValue);
  });

  // `file://` is one origin, so two dashboards would share one choice without the tracker id in the key.
  test.each(FROZEN_STORED_CHOICES)('keeps the %s of two trackers under two keys', (choice, key, storedValue) => {
    const storage = inMemoryStorage();

    DRIVER_FOR_STORED_CHOICE[choice].write(createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage), storedValue);
    DRIVER_FOR_STORED_CHOICE[choice].write(createViewerPreferences(ANOTHER_EXAMPLE_TRACKER_ID, () => storage), storedValue);

    expect([...storage.entries.keys()]).toEqual([key, key.replace(EXAMPLE_TRACKER_ID, ANOTHER_EXAMPLE_TRACKER_ID)]);
  });

  test.each(FROZEN_STORED_CHOICES)('removes the %s key once the choice returns to its default', (choice, key, storedValue, removedAtValue) => {
    const storage     = inMemoryStorage();
    const preferences = createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage);

    DRIVER_FOR_STORED_CHOICE[choice].write(preferences, storedValue);
    DRIVER_FOR_STORED_CHOICE[choice].write(preferences, removedAtValue);

    expect(storage.entries.has(key)).toBe(false);
    expect(storage.entries.size).toBe(0);
  });
});

describe('createViewerPreferences', () => {
  test('reads back each choice it wrote', () => {
    const storage     = inMemoryStorage();
    const preferences = createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage);
    const override    = overrideWith({ presetKey: '4h', fromText: '-4h', toText: 'now' });

    preferences.writeRangeOverride(override);
    preferences.writeWorkVisibility('all');
    preferences.writeNameColumnWidth('wide');
    preferences.writeAbandonedLaneIsOpen(true);
    preferences.writeCappedLaneShownCount('done', 40);

    expect(preferences.readRangeOverride()).toEqual(override);
    expect(preferences.readWorkVisibility()).toBe('all');
    expect(preferences.readNameColumnWidth()).toBe('wide');
    expect(preferences.readAbandonedLaneIsOpen()).toBe(true);
    expect(preferences.readCappedLaneShownCount('done')).toBe(40);
    expect(preferences.readCappedLaneShownCount('abandoned')).toBe(CAPPED_LANE_FIRST_PAGE_CARDS);
  });

  // Merely reaching `window.localStorage` throws where the browser blocks storage; the page must still render with every default.
  test('reads every default and drops every write without throwing when the storage cannot be reached', () => {
    const preferences = createViewerPreferences(EXAMPLE_TRACKER_ID, () => {
      throw new Error('storage is blocked');
    });

    expect(preferences.readRangeOverride()).toEqual(EMPTY_VIEW_OVERRIDE);
    expect(preferences.readWorkVisibility()).toBe(DEFAULT_WORK_VISIBILITY);
    expect(preferences.readNameColumnWidth()).toBe(DEFAULT_NAME_COLUMN_WIDTH);
    expect(preferences.readAbandonedLaneIsOpen()).toBe(false);
    expect(preferences.readCappedLaneShownCount('done')).toBe(CAPPED_LANE_FIRST_PAGE_CARDS);
    expect(() => {
      preferences.writeRangeOverride(overrideWith({ tickMinutes: 15 }));
      preferences.writeWorkVisibility('all');
      preferences.writeNameColumnWidth('wide');
      preferences.writeAbandonedLaneIsOpen(true);
      preferences.writeCappedLaneShownCount('done', 40);
    }).not.toThrow();
  });

  test('reads a stored range override that is not JSON as the empty override', () => {
    const storage = inMemoryStorage();
    storage.setItem('agent-progress:tracker-a', '{not json');

    expect(createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage).readRangeOverride()).toEqual(EMPTY_VIEW_OVERRIDE);
  });
});

const EXAMPLE_RELOAD_SNAPSHOT: ReloadSnapshot = {
  trackerId:        EXAMPLE_TRACKER_ID,
  tabName:          'kanban',
  windowScrollTop:  640,
  chartScrollLeft:  1200,
  chartScrollTop:   80,
  kanbanScrollLeft: 300,
  fromText:         '-2h',
  toText:           '',
  logFilterText:    'review',
  detailTarget:     { kind: 'kanban-card', id: '12' },
  detailScrollTop:  45,
};

describe('createReloadSnapshotStore', () => {
  // The template header comment names this key; a reload that wrote it under another would restore nothing.
  test('writes the snapshot under agent-progress:snapshot as JSON', () => {
    const storage = inMemoryStorage();

    createReloadSnapshotStore(EXAMPLE_TRACKER_ID, () => storage).write(EXAMPLE_RELOAD_SNAPSHOT);

    expect([...storage.entries.keys()]).toEqual(['agent-progress:snapshot']);
    expect(JSON.parse(storage.entries.get('agent-progress:snapshot') ?? 'null')).toEqual(EXAMPLE_RELOAD_SNAPSHOT);
  });

  test('takes the snapshot back once and deletes it, so a later manual reload restores nothing', () => {
    const storage = inMemoryStorage();
    const store   = createReloadSnapshotStore(EXAMPLE_TRACKER_ID, () => storage);
    store.write(EXAMPLE_RELOAD_SNAPSHOT);

    expect(store.take()).toEqual(EXAMPLE_RELOAD_SNAPSHOT);
    expect(storage.entries.size).toBe(0);
    expect(store.take()).toBeNull();
  });

  test('takes nothing from a snapshot another tracker wrote in the same tab, and deletes it', () => {
    const storage = inMemoryStorage();
    createReloadSnapshotStore(ANOTHER_EXAMPLE_TRACKER_ID, () => storage).write({ ...EXAMPLE_RELOAD_SNAPSHOT, trackerId: ANOTHER_EXAMPLE_TRACKER_ID });

    expect(createReloadSnapshotStore(EXAMPLE_TRACKER_ID, () => storage).take()).toBeNull();
    expect(storage.entries.size).toBe(0);
  });

  test('takes nothing from a stored snapshot that is not JSON', () => {
    const storage = inMemoryStorage();
    storage.setItem('agent-progress:snapshot', '{not json');

    expect(createReloadSnapshotStore(EXAMPLE_TRACKER_ID, () => storage).take()).toBeNull();
  });

  test('neither writes nor takes, and never throws, when the storage cannot be reached', () => {
    const store = createReloadSnapshotStore(EXAMPLE_TRACKER_ID, () => {
      throw new Error('storage is blocked');
    });

    expect(() => store.write(EXAMPLE_RELOAD_SNAPSHOT)).not.toThrow();
    expect(store.take()).toBeNull();
  });
});

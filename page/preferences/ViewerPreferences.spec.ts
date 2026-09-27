/**
 * The viewer's stored page choices. The cases that matter: every key string and encoding stays what a viewer's browser already holds, a
 * choice at its default leaves nothing behind, anything unrecognised or unreadable falls back to the default, and blocked storage never throws.
 */

import { describe, expect, test }                                        from 'bun:test';
import { CAPPED_LANE_FIRST_PAGE_CARDS }                                  from '../constants/CappedLanePaging.ts';
import type { PreferenceStorage, StoredViewOverride, ViewerPreferences } from './ViewerPreferences.ts';
import {
  abandonedLaneChoiceFor,
  abandonedLaneIsOpenFrom,
  abandonedLaneStorageKeyFor,
  cappedLaneStorageKeyFor,
  createViewerPreferences,
  DEFAULT_ABANDONED_LANE_CHOICE,
  DEFAULT_LOG_VISIBILITY,
  DEFAULT_NAME_COLUMN_WIDTH,
  DEFAULT_WORK_VISIBILITY,
  EMPTY_VIEW_OVERRIDE,
  logVisibilityFrom,
  logVisibilityStorageKeyFor,
  nameColumnWidthFrom,
  nameColumnWidthStorageKeyFor,
  overrideIsEmpty,
  rangeOverrideStorageKeyFor,
  shownCountFrom,
  storedOverrideFrom,
  toggledLogVisibility,
  toggledNameColumnWidth,
  workVisibilityFrom,
  workVisibilityStorageKeyFor,
} from './ViewerPreferences.ts';

const EXAMPLE_TRACKER_ID = 'tracker-a';

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

type StoredChoiceName = 'range override' | 'work visibility' | 'log visibility' | 'name column' | 'Abandoned lane' | 'Done lane count' | 'Abandoned lane count';

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
  ['log visibility', 'agent-progress:tracker-a:log', 'all', 'newest'],
  ['name column', 'agent-progress:tracker-a:name-column', 'wide', 'normal'],
  ['Abandoned lane', 'agent-progress:tracker-a:kanban-abandoned', 'open', 'closed'],
  ['Done lane count', 'agent-progress:tracker-a:kanban-done-shown', '40', '15'],
  ['Abandoned lane count', 'agent-progress:tracker-a:kanban-abandoned-shown', '40', '15'],
];

interface StoredChoiceDriver {
  keyFor: (trackerId: string) => string;
  write:  (preferences: ViewerPreferences, text: string) => void;
}

const DRIVER_FOR_STORED_CHOICE: Readonly<Record<StoredChoiceName, StoredChoiceDriver>> = {
  'range override': {
    keyFor: rangeOverrideStorageKeyFor,
    write:  (preferences, text) => preferences.writeRangeOverride(storedOverrideFrom(JSON.parse(text))),
  },
  'work visibility': {
    keyFor: workVisibilityStorageKeyFor,
    write:  (preferences, text) => preferences.writeWorkVisibility(workVisibilityFrom(text)),
  },
  'log visibility': {
    keyFor: logVisibilityStorageKeyFor,
    write:  (preferences, text) => preferences.writeLogVisibility(logVisibilityFrom(text)),
  },
  'name column': {
    keyFor: nameColumnWidthStorageKeyFor,
    write:  (preferences, text) => preferences.writeNameColumnWidth(nameColumnWidthFrom(text)),
  },
  'Abandoned lane': {
    keyFor: abandonedLaneStorageKeyFor,
    write:  (preferences, text) => preferences.writeAbandonedLaneIsOpen(abandonedLaneIsOpenFrom(text)),
  },
  'Done lane count': {
    keyFor: (trackerId) => cappedLaneStorageKeyFor(trackerId, 'done'),
    write:  (preferences, text) => preferences.writeCappedLaneShownCount('done', Number(text)),
  },
  'Abandoned lane count': {
    keyFor: (trackerId) => cappedLaneStorageKeyFor(trackerId, 'abandoned'),
    write:  (preferences, text) => preferences.writeCappedLaneShownCount('abandoned', Number(text)),
  },
};

describe('rangeOverrideStorageKeyFor', () => {
  test('namespaces the stored range by tracker id', () => {
    expect(rangeOverrideStorageKeyFor('example-tracker-8f21')).toBe('agent-progress:example-tracker-8f21');
    expect(rangeOverrideStorageKeyFor('another')).not.toBe(rangeOverrideStorageKeyFor('example-tracker-8f21'));
  });
});

describe('storedOverrideFrom', () => {
  test('reads back everything the range bar wrote', () => {
    const stored = {
      presetKey:   '1h',
      fromText:    '-1h',
      toText:      'now',
      tickMinutes: 15,
    };

    expect(storedOverrideFrom(stored)).toEqual(overrideWith(stored));
  });

  test('keeps the readable settings when one of them is not', () => {
    const override = storedOverrideFrom({
      presetKey:   42,
      fromText:    '-1h',
      toText:      'now',
      tickMinutes: 'fifteen',
    });

    expect(override.presetKey).toBeNull();
    expect(override.fromText).toBe('-1h');
    expect(override.tickMinutes).toBeNull();
  });

  test.each([
    ['null', null],
    ['a string', 'x'],
  ])('reads %s as no override at all', (_description, value) => {
    expect(storedOverrideFrom(value)).toEqual(EMPTY_VIEW_OVERRIDE);
  });
});

describe('overrideIsEmpty', () => {
  test('is true only when neither a bound nor a tick step is set', () => {
    expect(overrideIsEmpty(EMPTY_VIEW_OVERRIDE)).toBe(true);
    expect(overrideIsEmpty(overrideWith({ presetKey: 'auto' }))).toBe(true);
    expect(overrideIsEmpty(overrideWith({ tickMinutes: 15 }))).toBe(false);
    expect(overrideIsEmpty(overrideWith({ fromText: '-1h', toText: 'now' }))).toBe(false);
  });
});

describe('logVisibilityFrom', () => {
  // A cleared or tampered key must not show the whole log by accident; only the one stored word does.
  test.each([
    ['nothing stored', null],
    ['an unknown word', 'everything'],
    ['the default spelled out', 'newest'],
  ])('reads %s as the newest entries', (_description, stored) => {
    expect(logVisibilityFrom(stored)).toBe(DEFAULT_LOG_VISIBILITY);
  });

  test('reads the stored word for the whole log as the whole log', () => {
    expect(logVisibilityFrom('all')).toBe('all');
  });

  test('toggles between the two choices and back', () => {
    expect(toggledLogVisibility(toggledLogVisibility(DEFAULT_LOG_VISIBILITY))).toBe(DEFAULT_LOG_VISIBILITY);
    expect(toggledLogVisibility(DEFAULT_LOG_VISIBILITY)).toBe('all');
  });
});

describe('logVisibilityStorageKeyFor', () => {
  // `file://` is one origin, so two dashboards would share one choice without the tracker id in the key.
  test('scopes the key to the tracker, beside the work-visibility key', () => {
    expect(logVisibilityStorageKeyFor('tracker-a')).toBe('agent-progress:tracker-a:log');
    expect(logVisibilityStorageKeyFor('tracker-a')).not.toBe(logVisibilityStorageKeyFor('tracker-b'));
  });
});

describe('nameColumnWidthFrom', () => {
  test.each([
    ['nothing stored', null],
    ['an unknown word', 'huge'],
    ['the default spelled out', 'normal'],
  ])('reads %s as the normal width', (_description, stored) => {
    expect(nameColumnWidthFrom(stored)).toBe(DEFAULT_NAME_COLUMN_WIDTH);
  });

  test('reads the stored word for the widened column as wide', () => {
    expect(nameColumnWidthFrom('wide')).toBe('wide');
  });
});

describe('toggledNameColumnWidth', () => {
  test('widens the normal column and returns the wide one to normal', () => {
    expect(toggledNameColumnWidth(DEFAULT_NAME_COLUMN_WIDTH)).toBe('wide');
    expect(toggledNameColumnWidth('wide')).toBe(DEFAULT_NAME_COLUMN_WIDTH);
  });
});

describe('nameColumnWidthStorageKeyFor', () => {
  test('scopes the key to the tracker, beside the work-visibility key', () => {
    expect(nameColumnWidthStorageKeyFor('tracker-a')).toBe('agent-progress:tracker-a:name-column');
    expect(nameColumnWidthStorageKeyFor('tracker-a')).not.toBe(nameColumnWidthStorageKeyFor('tracker-b'));
  });
});

describe('workVisibilityFrom', () => {
  test('reads only "all" as all, so a damaged stored value falls back to hiding old work', () => {
    expect(workVisibilityFrom('all')).toBe('all');
    expect(workVisibilityFrom('recent')).toBe('recent');
    expect(workVisibilityFrom(null)).toBe('recent');
    expect(workVisibilityFrom('constructor')).toBe('recent');
  });
});

describe('the capped lanes', () => {
  test('keeps a key per tracker and lane, and the Abandoned lane closed unless storage says open', () => {
    expect(cappedLaneStorageKeyFor('tracker-a', 'done')).toBe('agent-progress:tracker-a:kanban-done-shown');
    expect(cappedLaneStorageKeyFor('tracker-a', 'abandoned')).toBe('agent-progress:tracker-a:kanban-abandoned-shown');
    expect(abandonedLaneStorageKeyFor('tracker-a')).toBe('agent-progress:tracker-a:kanban-abandoned');
    expect(abandonedLaneIsOpenFrom(null)).toBe(false);
    expect(abandonedLaneIsOpenFrom('open')).toBe(true);
    expect(abandonedLaneChoiceFor(false)).toBe(DEFAULT_ABANDONED_LANE_CHOICE);
    expect(abandonedLaneChoiceFor(true)).toBe('open');
  });
});

describe('the stored keys and encodings', () => {
  // A viewer's browser already holds these keys; a key that moves silently drops every choice made before the change.
  test.each(FROZEN_STORED_CHOICES)('names the %s key it always named', (choice, key) => {
    expect(DRIVER_FOR_STORED_CHOICE[choice].keyFor(EXAMPLE_TRACKER_ID)).toBe(key);
  });

  test.each(FROZEN_STORED_CHOICES)('writes the %s to its key in its encoding', (choice, key, storedValue) => {
    const storage = inMemoryStorage();

    DRIVER_FOR_STORED_CHOICE[choice].write(createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage), storedValue);

    expect([...storage.entries]).toEqual([[key, storedValue]]);
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
    preferences.writeLogVisibility('all');
    preferences.writeNameColumnWidth('wide');
    preferences.writeAbandonedLaneIsOpen(true);
    preferences.writeCappedLaneShownCount('done', 40);

    expect(preferences.readRangeOverride()).toEqual(override);
    expect(preferences.readWorkVisibility()).toBe('all');
    expect(preferences.readLogVisibility()).toBe('all');
    expect(preferences.readNameColumnWidth()).toBe('wide');
    expect(preferences.readAbandonedLaneIsOpen()).toBe(true);
    expect(preferences.readCappedLaneShownCount('done')).toBe(40);
    expect(preferences.readCappedLaneShownCount('abandoned')).toBe(shownCountFrom(null));
  });

  // Merely reaching `window.localStorage` throws where the browser blocks storage; the page must still render with every default.
  test('reads every default and drops every write without throwing when the storage cannot be reached', () => {
    const preferences = createViewerPreferences(EXAMPLE_TRACKER_ID, () => {
      throw new Error('storage is blocked');
    });

    expect(preferences.readRangeOverride()).toEqual(EMPTY_VIEW_OVERRIDE);
    expect(preferences.readWorkVisibility()).toBe(DEFAULT_WORK_VISIBILITY);
    expect(preferences.readLogVisibility()).toBe(DEFAULT_LOG_VISIBILITY);
    expect(preferences.readNameColumnWidth()).toBe(DEFAULT_NAME_COLUMN_WIDTH);
    expect(preferences.readAbandonedLaneIsOpen()).toBe(false);
    expect(preferences.readCappedLaneShownCount('done')).toBe(CAPPED_LANE_FIRST_PAGE_CARDS);
    expect(() => {
      preferences.writeRangeOverride(overrideWith({ tickMinutes: 15 }));
      preferences.writeWorkVisibility('all');
      preferences.writeLogVisibility('all');
      preferences.writeNameColumnWidth('wide');
      preferences.writeAbandonedLaneIsOpen(true);
      preferences.writeCappedLaneShownCount('done', 40);
    }).not.toThrow();
  });

  // The lane clamps what it is handed, so the read passes on text that is no count rather than guessing one.
  test.each([
    ['nothing stored', null, CAPPED_LANE_FIRST_PAGE_CARDS],
    ['a stored count', '40', 40],
    ['text that is no number', 'many', Number.NaN],
  ])('reads %s as the Done lane count %p', (_description, stored, expected) => {
    const storage = inMemoryStorage();
    if (stored !== null) storage.setItem('agent-progress:tracker-a:kanban-done-shown', stored);

    expect(createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage).readCappedLaneShownCount('done')).toBe(expected);
  });

  test('reads a stored range override that is not JSON as the empty override', () => {
    const storage = inMemoryStorage();
    storage.setItem(rangeOverrideStorageKeyFor(EXAMPLE_TRACKER_ID), '{not json');

    expect(createViewerPreferences(EXAMPLE_TRACKER_ID, () => storage).readRangeOverride()).toEqual(EMPTY_VIEW_OVERRIDE);
  });
});

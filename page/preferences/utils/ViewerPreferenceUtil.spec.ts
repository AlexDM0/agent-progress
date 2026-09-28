/**
 * The viewer's choices parsed from what storage holds and encoded for it. The cases that matter: anything unrecognised or unreadable falls
 * back to the default, only the one stored word selects the other choice, and each toggle returns to where it started.
 */

import { describe, expect, test }  from 'bun:test';
import type { StoredViewOverride } from '../../@types/ViewerChoices.ts';
import { EMPTY_VIEW_OVERRIDE }     from '../constants/ViewOverride.ts';
import { ViewerPreferenceUtil }    from './ViewerPreferenceUtil.ts';

const {
  abandonedLaneChoiceFor,
  abandonedLaneIsOpenFrom,
  logVisibilityFrom,
  nameColumnWidthFrom,
  overrideIsEmpty,
  reloadSnapshotFrom,
  shownCountFrom,
  storedOverrideFrom,
  toggledLogVisibility,
  toggledNameColumnWidth,
  workVisibilityFrom,
} = ViewerPreferenceUtil;

function overrideWith(changes: Partial<StoredViewOverride>): StoredViewOverride {
  return { ...EMPTY_VIEW_OVERRIDE, ...changes };
}

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
    expect(logVisibilityFrom(stored)).toBe('newest');
  });

  test('reads the stored word for the whole log as the whole log', () => {
    expect(logVisibilityFrom('all')).toBe('all');
  });

  test('toggles between the two choices and back', () => {
    expect(toggledLogVisibility(toggledLogVisibility('newest'))).toBe('newest');
    expect(toggledLogVisibility('newest')).toBe('all');
  });
});

describe('nameColumnWidthFrom', () => {
  test.each([
    ['nothing stored', null],
    ['an unknown word', 'huge'],
    ['the default spelled out', 'normal'],
  ])('reads %s as the normal width', (_description, stored) => {
    expect(nameColumnWidthFrom(stored)).toBe('normal');
  });

  test('reads the stored word for the widened column as wide', () => {
    expect(nameColumnWidthFrom('wide')).toBe('wide');
  });
});

describe('toggledNameColumnWidth', () => {
  test('widens the normal column and returns the wide one to normal', () => {
    expect(toggledNameColumnWidth('normal')).toBe('wide');
    expect(toggledNameColumnWidth('wide')).toBe('normal');
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
  test('keeps the Abandoned lane closed unless storage says open, and encodes the two choices as closed and open', () => {
    expect(abandonedLaneIsOpenFrom(null)).toBe(false);
    expect(abandonedLaneIsOpenFrom('closed')).toBe(false);
    expect(abandonedLaneIsOpenFrom('open')).toBe(true);
    expect(abandonedLaneChoiceFor(false)).toBe('closed');
    expect(abandonedLaneChoiceFor(true)).toBe('open');
  });

  // The lane clamps what it is handed, so the parse passes on text that is no count rather than guessing one.
  test.each([
    ['nothing stored', null, 15],
    ['a stored count', '40', 40],
    ['text that is no number', 'many', Number.NaN],
  ])('reads %s as the shown count %p', (_description, stored, expected) => {
    expect(shownCountFrom(stored)).toBe(expected);
  });
});

describe('reloadSnapshotFrom', () => {
  const storedSnapshot = {
    trackerId:        'tracker-a',
    tabName:          'progress',
    windowScrollTop:  640,
    chartScrollLeft:  1200,
    chartScrollTop:   80,
    kanbanScrollLeft: 300,
    fromText:         '-2h',
    toText:           'now',
    detailTarget:     { kind: 'task', id: '7' },
    detailScrollTop:  45,
  };

  test('reads back everything the page stored before the reload', () => {
    expect(reloadSnapshotFrom(storedSnapshot, 'tracker-a')).toEqual({ ...storedSnapshot, detailTarget: { kind: 'task', id: '7' } });
  });

  test('reads nothing from a snapshot of another tracker, or from one that is not a record', () => {
    expect(reloadSnapshotFrom(storedSnapshot, 'tracker-b')).toBeNull();
    expect(reloadSnapshotFrom('tracker-a', 'tracker-a')).toBeNull();
    expect(reloadSnapshotFrom(null, 'tracker-a')).toBeNull();
  });

  // A half-readable snapshot still restores what it can; the unreadable parts leave the page where its layout put it.
  test('reads an unreadable or negative offset as the top, unreadable text as empty and an unknown detail as none', () => {
    const snapshot = reloadSnapshotFrom({
      ...storedSnapshot,
      windowScrollTop: 'far',
      chartScrollLeft: -5,
      fromText:        7,
      detailTarget:    { kind: 'row', id: '7' },
    }, 'tracker-a');

    expect(snapshot?.windowScrollTop).toBe(0);
    expect(snapshot?.chartScrollLeft).toBe(0);
    expect(snapshot?.fromText).toBe('');
    expect(snapshot?.detailTarget).toBeNull();
  });

  test.each(['task', 'ticket', 'kanban-card'])('reads the %s detail target', (kind) => {
    expect(reloadSnapshotFrom({ ...storedSnapshot, detailTarget: { kind, id: '3' } }, 'tracker-a')?.detailTarget).toEqual({ kind, id: '3' });
  });
});

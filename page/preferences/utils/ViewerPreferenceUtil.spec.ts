/**
 * The viewer's choices parsed from what storage holds and encoded for it. The cases that matter: anything unrecognised or unreadable falls
 * back to the default, only the one stored word selects the other choice, and each toggle returns to where it started.
 */

import { describe, expect, test }              from 'bun:test';
import type { StoredViewOverride, TicketView } from '../../@types/ViewerChoices.ts';
import { DEFAULT_TICKET_VIEW }                 from '../../tickets/utils/TicketViewUtil.ts';
import { EMPTY_VIEW_OVERRIDE }                 from '../constants/ViewOverride.ts';
import { ViewerPreferenceUtil }                from './ViewerPreferenceUtil.ts';

const {
  abandonedLaneChoiceFor,
  abandonedLaneIsOpenFrom,
  nameColumnWidthFrom,
  overrideIsEmpty,
  reloadSnapshotFrom,
  shownCountFrom,
  storedOverrideFrom,
  toggledNameColumnWidth,
  finishedWorkChoiceFrom,
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

describe('finishedWorkChoiceFrom', () => {
  test('reads the hide-finished checkbox\'s saved recent as last day and its all as custom all', () => {
    expect(finishedWorkChoiceFrom('recent')).toBe('1d');
    expect(finishedWorkChoiceFrom('all')).toBe('all');
  });

  test('reads every choice the switch stores, and anything else as the last-day default', () => {
    expect(finishedWorkChoiceFrom('1h')).toBe('1h');
    expect(finishedWorkChoiceFrom('12h')).toBe('12h');
    expect(finishedWorkChoiceFrom('since-2026-09-24')).toBe('since-2026-09-24');
    expect(finishedWorkChoiceFrom(null)).toBe('1d');
    expect(finishedWorkChoiceFrom('constructor')).toBe('1d');
    expect(finishedWorkChoiceFrom('since-2026-13-01')).toBe('1d');
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

const STORED_TICKET_VIEW: TicketView = {
  searchText:    'dark',
  statusChips:   ['paused', 'reviewing'],
  typeChips:     ['bug'],
  sortKey:       'status',
  sortDirection: 'ascending',
};

describe('reloadSnapshotFrom', () => {
  const storedSnapshot = {
    trackerId:          'tracker-a',
    tabName:            'progress',
    windowScrollTop:    640,
    chartScrollLeft:    1200,
    chartScrollTop:     80,
    kanbanScrollLeft:   300,
    fromText:           '-2h',
    toText:             'now',
    rangePopoverIsOpen: true,
    ticketView:         STORED_TICKET_VIEW,
    detailTarget:       { kind: 'task', id: '7' },
    detailScrollTop:    45,
    screenSignature:    { tasks: { 7: 'in-review' }, tickets: { '003': 'reviewing round 2' } },
  };

  test('reads back everything the page stored before the reload', () => {
    expect(reloadSnapshotFrom(storedSnapshot, 'tracker-a')).toEqual({ ...storedSnapshot, detailTarget: { kind: 'task', id: '7' } });
  });

  // A snapshot stored by a page that still had the log card carries its filter text, which nothing reads any more.
  test('reads no log filter text from a snapshot that still holds one', () => {
    expect(reloadSnapshotFrom({ ...storedSnapshot, logFilterText: '#455' }, 'tracker-a')).toEqual({ ...storedSnapshot, detailTarget: { kind: 'task', id: '7' } });
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

  test('reads an unreadable ticket view as the default one, and drops the chips and sort it does not know', () => {
    expect(reloadSnapshotFrom({ ...storedSnapshot, ticketView: 'dark' }, 'tracker-a')?.ticketView).toEqual(DEFAULT_TICKET_VIEW);
    expect(reloadSnapshotFrom({
      ...storedSnapshot,
      ticketView: {
        searchText: 3, statusChips: ['re-review', 'paused'], typeChips: 'bug', sortKey: 'priority', sortDirection: 'up'
      },
    }, 'tracker-a')?.ticketView).toEqual({ ...DEFAULT_TICKET_VIEW, statusChips: ['paused'] });
  });

  // A snapshot from before the popover, or one holding anything but true, reopens nothing over the chart.
  test.each([
    ['missing', undefined],
    ['text', 'true'],
    ['false', false],
  ])('reads a %s popover flag as closed', (_description, stored) => {
    expect(reloadSnapshotFrom({ ...storedSnapshot, rangePopoverIsOpen: stored }, 'tracker-a')?.rangePopoverIsOpen).toBe(false);
  });

  test.each(['task', 'ticket', 'kanban-card'])('reads the %s detail target', (kind) => {
    expect(reloadSnapshotFrom({ ...storedSnapshot, detailTarget: { kind, id: '3' } }, 'tracker-a')?.detailTarget).toEqual({ kind, id: '3' });
  });

  // Without a signature nothing is compared, so a reload after it highlights nothing.
  test('reads a missing or unreadable screen signature as none', () => {
    expect(reloadSnapshotFrom({ ...storedSnapshot, screenSignature: undefined }, 'tracker-a')?.screenSignature).toBeNull();
    expect(reloadSnapshotFrom({ ...storedSnapshot, screenSignature: { tasks: [] } }, 'tracker-a')?.screenSignature).toBeNull();
  });
});

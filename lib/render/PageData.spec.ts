/**
 * The page's pure helpers, imported from `lib/render/page/PageData.ts` rather than the page entry,
 * which touches `document` and so cannot be compiled by this project.
 */

import { describe, expect, test }              from 'bun:test';
import type { ProgressFile, Task }             from '../constants/Types.ts';
import type { PageLimits, StoredViewOverride } from './page/PageData.ts';
import {
  EMPTY_VIEW_OVERRIDE,
  effectiveRangeFor,
  overrideIsEmpty,
  pagePayloadFrom,
  pageTicketsFrom,
  waitingOnByTicketId,
  RANGE_PRESET_BOUNDS,
  storageKeyFor,
  storedOverrideFrom,
} from './page/PageData.ts';

const EXAMPLE_LIMITS: PageLimits = {
  tickStepLadderMinutes:       [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440],
  maximumTicksPerAxis:         12,
  axisMinimumSpanMinutes:      60,
  axisPaddingMinutes:          15,
  minimumBarWidthPercent:      0.6,
  hoursAxisLabelLimitMinutes:  1440,
  weekAxisLabelLimitMinutes:   10_080,
  hourMinutes:                 60,
  dayMinutes:                  1440,
  tickCountSafetyBound:        500,
  dateAndClockLength:          16,
  calendarDateLength:          10,
  monthAndDaySliceStart:       5,
  clockSliceStart:             11,
  clockSliceEnd:               16,
  doneWorkVisibleMilliseconds: 86_400_000,
};

const EXAMPLE_START_EPOCH_MILLISECONDS = Date.UTC(2026, 8, 18, 18, 0, 0);

function exampleTask(): Task {
  return {
    id:     1,
    name:   'Planning pass',
    status: 'running',
    start:  new Date(EXAMPLE_START_EPOCH_MILLISECONDS).toISOString(),
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
  };
}

function exampleProgress(): ProgressFile {
  return {
    version:    1,
    trackerId:  'example-tracker-8f21',
    project:    'Example Agency',
    startedAt:  new Date(EXAMPLE_START_EPOCH_MILLISECONDS).toISOString(),
    nextTaskId: 2,
    view:       { kind: 'auto' },
    tasks:      [exampleTask()],
    log:        [],
  };
}

function examplePayload(): Record<string, unknown> {
  return {
    progress:                     exampleProgress(),
    generatedAtEpochMilliseconds: EXAMPLE_START_EPOCH_MILLISECONDS,
    limits:                       EXAMPLE_LIMITS,
    concurrency:                  { limit: 2, agentsInFlight: 0 },
    pageScriptFailure:            null,
  };
}

function overrideWith(changes: Partial<StoredViewOverride>): StoredViewOverride {
  return { ...EMPTY_VIEW_OVERRIDE, ...changes };
}

describe('pagePayloadFrom', () => {
  test('accepts the payload the generator writes', () => {
    expect(pagePayloadFrom(examplePayload())).not.toBeNull();
  });

  test('accepts a payload carrying fields the page has never heard of', () => {
    const progress = { ...exampleProgress(), somethingAddedLater: 'x' };

    expect(pagePayloadFrom({ ...examplePayload(), progress, addedAtTheTopLevelToo: 1 })).not.toBeNull();
  });

  test.each([
    ['null', null],
    ['a string', 'not a payload'],
    ['an empty object', {}],
  ])('refuses %s rather than casting it', (_description, value) => {
    expect(pagePayloadFrom(value)).toBeNull();
  });

  test.each([
    ['the progress file', 'progress'],
    ['the limits', 'limits'],
    ['the generated stamp', 'generatedAtEpochMilliseconds'],
    ['the concurrency figures', 'concurrency'],
  ])('refuses a payload missing %s', (_description, missingKey) => {
    const payload: Record<string, unknown> = examplePayload();
    delete payload[missingKey];

    expect(pagePayloadFrom(payload)).toBeNull();
  });

  test('refuses a payload whose concurrency figures are not numbers, since the summary line prints them', () => {
    expect(pagePayloadFrom({ ...examplePayload(), concurrency: { limit: '2', agentsInFlight: 0 } })).toBeNull();
  });

  test('refuses a payload whose limits are not all finite numbers, since every percentage divides by one', () => {
    const limits = { ...EXAMPLE_LIMITS, axisMinimumSpanMinutes: Number.NaN };

    expect(pagePayloadFrom({ ...examplePayload(), limits })).toBeNull();
  });

  test('refuses a payload whose timestamp slice positions are missing', () => {
    const limits: Record<string, unknown> = { ...EXAMPLE_LIMITS };
    delete limits['clockSliceEnd'];

    expect(pagePayloadFrom({ ...examplePayload(), limits })).toBeNull();
  });

  test('refuses a payload whose tick ladder is not a list of numbers', () => {
    const limits = { ...EXAMPLE_LIMITS, tickStepLadderMinutes: ['five'] };

    expect(pagePayloadFrom({ ...examplePayload(), limits })).toBeNull();
  });

  test('refuses a progress file whose tasks and log are not lists', () => {
    const progress = { ...exampleProgress(), tasks: 'none' };

    expect(pagePayloadFrom({ ...examplePayload(), progress })).toBeNull();
  });
});

describe('pageTicketsFrom', () => {
  const usable = {
    id:       '003',
    title:    'Split the exporter',
    status:   'in-review',
    bodyHtml: '<p>x</p>',
  };

  test('keeps the usable entries and drops the rest, rather than failing the whole island', () => {
    const tickets = pageTicketsFrom([usable, { id: '004' }, null, 'nonsense']);

    expect(tickets.map((ticket) => ticket.id)).toEqual(['003']);
  });

  test.each([
    ['a non-array', { id: '003' }],
    ['null', null],
  ])('reads %s as no tickets at all', (_description, value) => {
    expect(pageTicketsFrom(value)).toEqual([]);
  });
});

describe('waitingOnByTicketId', () => {
  function ticketsFrom(entries: Array<{ id: string; status: string; dependsOn?: string[] }>): ReturnType<typeof pageTicketsFrom> {
    return pageTicketsFrom(entries.map((entry) => ({ title: `Ticket ${entry.id}`, bodyHtml: '', ...entry })));
  }

  test('maps a ticket to the dependencies that are not done or delivered yet', () => {
    const tickets = ticketsFrom([
      { id: '001', status: 'done' },
      { id: '002', status: 'in-progress' },
      { id: '003', status: 'open', dependsOn: ['001', '002'] },
    ]);

    expect(waitingOnByTicketId(tickets)).toEqual(new Map([['003', ['002']]]));
  });

  // A closed ticket's list is history; showing it as waiting would suggest work that is not coming.
  test('leaves out tickets that are closed and tickets whose dependencies are all settled', () => {
    const tickets = ticketsFrom([
      { id: '001', status: 'open' },
      { id: '002', status: 'done', dependsOn: ['001'] },
      { id: '003', status: 'abandoned', dependsOn: ['001'] },
      { id: '004', status: 'open' },
    ]);

    expect(waitingOnByTicketId(tickets).size).toBe(0);
  });
});

describe('storageKeyFor', () => {
  test('namespaces the stored range by tracker id', () => {
    expect(storageKeyFor('example-tracker-8f21')).toBe('agent-progress:example-tracker-8f21');
    expect(storageKeyFor('another')).not.toBe(storageKeyFor('example-tracker-8f21'));
  });
});

describe('RANGE_PRESET_BOUNDS', () => {
  test('answers each data-preset the template offers, and only with relative text', () => {
    expect(Object.keys(RANGE_PRESET_BOUNDS).sort()).toEqual(['12h', '1h', '24h', '4h', '7d', 'all', 'auto']);
    expect(RANGE_PRESET_BOUNDS['auto']).toEqual({ fromText: null, toText: null });
    expect(RANGE_PRESET_BOUNDS['4h']).toEqual({ fromText: '-4h', toText: 'now' });
    expect(RANGE_PRESET_BOUNDS['all']).toEqual({ fromText: 'start', toText: 'now' });
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

describe('effectiveRangeFor', () => {
  test('falls back to the range stored in the progress file when nothing is overridden', () => {
    expect(effectiveRangeFor(exampleProgress(), EMPTY_VIEW_OVERRIDE, EXAMPLE_START_EPOCH_MILLISECONDS, EXAMPLE_LIMITS))
      .toEqual({ kind: 'auto' });
  });

  test('uses the typed bounds verbatim, so a relative one keeps resolving against each new now', () => {
    const range = effectiveRangeFor(
      exampleProgress(),
      overrideWith({ fromText: '-4h', toText: 'now', tickMinutes: 30 }),
      EXAMPLE_START_EPOCH_MILLISECONDS,
      EXAMPLE_LIMITS,
    );

    expect(range).toEqual({
      kind: 'relative', from: '-4h', to: 'now', tickMinutes: 30
    });
  });

  test('ignores a single bound and keeps the tracker’s own range', () => {
    const range = effectiveRangeFor(exampleProgress(), overrideWith({ fromText: '-4h' }), EXAMPLE_START_EPOCH_MILLISECONDS, EXAMPLE_LIMITS);

    expect(range).toEqual({ kind: 'auto' });
  });

  test('materialises the automatic axis as an absolute range when a tick is chosen while on Auto', () => {
    const range = effectiveRangeFor(exampleProgress(), overrideWith({ tickMinutes: 15 }), EXAMPLE_START_EPOCH_MILLISECONDS, EXAMPLE_LIMITS);

    expect(range.kind).toBe('absolute');
    expect(range.kind === 'absolute' && range.tickMinutes).toBe(15);
    expect(range.kind === 'absolute' && Date.parse(range.from)).toBe(EXAMPLE_START_EPOCH_MILLISECONDS);
  });

  test('re-materialises that axis against the now it is given, rather than freezing it', () => {
    const override = overrideWith({ tickMinutes: 15 });
    const early = effectiveRangeFor(exampleProgress(), override, EXAMPLE_START_EPOCH_MILLISECONDS, EXAMPLE_LIMITS);
    const later = effectiveRangeFor(exampleProgress(), override, EXAMPLE_START_EPOCH_MILLISECONDS + 3 * 60 * 60_000, EXAMPLE_LIMITS);

    expect(early.kind === 'absolute' && later.kind === 'absolute' && later.to).not.toBe(early.kind === 'absolute' ? early.to : '');
  });
});

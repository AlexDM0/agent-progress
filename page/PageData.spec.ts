/**
 * The page's pure helpers, imported from `page/PageData.ts` rather than the page entry,
 * which touches `document` at load and so cannot be imported by a spec.
 */

import { describe, expect, test }                 from 'bun:test';
import type { ProgressFile }                      from '../src/lib/tracker-model/@types/ProgressFile.ts';
import type { Task }                              from '../src/lib/tracker-model/@types/Task.ts';
import type { PageLimits }                        from '../src/shared/@types/PagePayload.ts';
import { effectiveRangeFor, RANGE_PRESET_BOUNDS } from './PageData.ts';
import type { StoredViewOverride }                from './preferences/ViewerPreferences.ts';
import { EMPTY_VIEW_OVERRIDE }                    from './preferences/ViewerPreferences.ts';

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
    status: 'in-progress',
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

function overrideWith(changes: Partial<StoredViewOverride>): StoredViewOverride {
  return { ...EMPTY_VIEW_OVERRIDE, ...changes };
}

describe('RANGE_PRESET_BOUNDS', () => {
  test('answers each data-preset the template offers, and only with relative text', () => {
    expect(Object.keys(RANGE_PRESET_BOUNDS).sort()).toEqual(['12h', '1h', '24h', '4h', '7d', 'all', 'auto']);
    expect(RANGE_PRESET_BOUNDS['auto']).toEqual({ fromText: null, toText: null });
    expect(RANGE_PRESET_BOUNDS['4h']).toEqual({ fromText: '-4h', toText: 'now' });
    expect(RANGE_PRESET_BOUNDS['all']).toEqual({ fromText: 'start', toText: 'now' });
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

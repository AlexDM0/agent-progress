/**
 * The custom range popover's draft. The cases that matter: the preview a field shows is exactly the bound the axis draws once the draft is
 * applied, an unreadable or empty field is judged as the axis would read it, a To not after From holds Apply back, and each line says which.
 */

import { describe, expect, test }                                       from 'bun:test';
import type { Task }                                                    from '../../src/lib/tracker-model/@types/Task.ts';
import type { TrackerProgress }                                         from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import { EXAMPLE_PAGE_LIMITS }                                          from '../testing/PageLimitsFixture.ts';
import { GeometryUtil }                                                 from '../utils/GeometryUtil.ts';
import { TimeUtil }                                                     from '../utils/TimeUtil.ts';
import { customRangeDraftVerdict, customRangeOverride, rangeBoundLine } from './CustomRangeDraft.ts';
import { effectiveViewRangeFor }                                        from './EffectiveViewRange.ts';

const EXAMPLE_START_EPOCH_MILLISECONDS = new Date(2026, 8, 18, 12, 0).getTime();
const EXAMPLE_NOW_EPOCH_MILLISECONDS   = new Date(2026, 8, 18, 15, 40).getTime();
const TODAY_CALENDAR_DATE              = TimeUtil.calendarDateOf(EXAMPLE_NOW_EPOCH_MILLISECONDS);

function exampleProgress(): TrackerProgress {
  const task: Task = {
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
  return {
    trackerId:  'example-tracker-8f21',
    project:    'Example Agency',
    startedAt:  new Date(EXAMPLE_START_EPOCH_MILLISECONDS).toISOString(),
    nextTaskId: 2,
    view:       { kind: 'auto' },
    tasks:      [task],
  };
}

function resolveExampleBound(text: string): number | null {
  return GeometryUtil.resolveRangeBound(text, exampleProgress(), EXAMPLE_NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
}

describe('customRangeDraftVerdict', () => {
  test.each([
    ['start', 'now'],
    ['-2h', 'now'],
    ['-1d', '-30m'],
    [new Date(2026, 8, 18, 13, 5).toISOString(), 'now'],
    ['', ''],
    ['  -90m ', ' now '],
  ])('previews %p to %p as exactly the bounds the axis draws once applied', (fromText, toText) => {
    const verdict = customRangeDraftVerdict(fromText, toText, resolveExampleBound);
    const applied = GeometryUtil.computeTimeline({
      progress:             exampleProgress(),
      range:                effectiveViewRangeFor(exampleProgress(), customRangeOverride(fromText, toText, null), EXAMPLE_NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS),
      nowEpochMilliseconds: EXAMPLE_NOW_EPOCH_MILLISECONDS,
      limits:               EXAMPLE_PAGE_LIMITS,
    });

    expect(verdict.draftIsApplicable).toBe(true);
    expect(verdict.from).toEqual({ kind: 'resolved', epochMilliseconds: applied.fromEpochMilliseconds });
    expect(verdict.to).toEqual({ kind: 'resolved', epochMilliseconds: applied.toEpochMilliseconds });
  });

  test('reads an empty From as the earliest start and an empty To as now', () => {
    const verdict = customRangeDraftVerdict(' ', '', resolveExampleBound);

    expect(verdict.from).toEqual({ kind: 'resolved', epochMilliseconds: EXAMPLE_START_EPOCH_MILLISECONDS });
    expect(verdict.to).toEqual({ kind: 'resolved', epochMilliseconds: EXAMPLE_NOW_EPOCH_MILLISECONDS });
  });

  test.each([
    ['-2x', 'now'],
    ['start', 'yesterday-ish'],
  ])('holds Apply back when %p or %p cannot be read', (fromText, toText) => {
    expect(customRangeDraftVerdict(fromText, toText, resolveExampleBound).draftIsApplicable).toBe(false);
  });

  test('marks the To bound, not the From, when To is not after From', () => {
    const verdict = customRangeDraftVerdict('now', '-1h', resolveExampleBound);

    expect(verdict.draftIsApplicable).toBe(false);
    expect(verdict.from.kind).toBe('resolved');
    expect(verdict.to).toEqual({ kind: 'not-after-from', epochMilliseconds: EXAMPLE_NOW_EPOCH_MILLISECONDS - 60 * 60 * 1000 });
  });
});

describe('customRangeOverride', () => {
  test('stores the trimmed bounds with no preset, an empty field as its placeholder, and the chosen ticks', () => {
    expect(customRangeOverride(' -3h ', '', 15)).toEqual({
      presetKey:   null,
      fromText:    '-3h',
      toText:      'now',
      tickMinutes: 15,
    });
  });
});

describe('rangeBoundLine', () => {
  test('shows a resolved bound as an arrow and its stamp, the full stamp as the title', () => {
    expect(rangeBoundLine({ kind: 'resolved', epochMilliseconds: EXAMPLE_NOW_EPOCH_MILLISECONDS }, 'now', TODAY_CALENDAR_DATE)).toEqual({
      text:           '→ 15:40',
      title:          `${TODAY_CALENDAR_DATE} 15:40`,
      boundIsInvalid: false,
    });
  });

  test('names the trimmed text it cannot read and marks the bound invalid', () => {
    const line = rangeBoundLine({ kind: 'unreadable' }, ' -2x ', TODAY_CALENDAR_DATE);

    expect(line.text).toBe('Can\'t read \'-2x\'');
    expect(line.boundIsInvalid).toBe(true);
  });

  test('says a To bound is not after From and marks it invalid', () => {
    const line = rangeBoundLine({ kind: 'not-after-from', epochMilliseconds: EXAMPLE_NOW_EPOCH_MILLISECONDS }, 'now', TODAY_CALENDAR_DATE);

    expect(line.text).toBe('→ 15:40 is not after From');
    expect(line.boundIsInvalid).toBe(true);
  });
});

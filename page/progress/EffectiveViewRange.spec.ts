/**
 * The range the geometry is given once the viewer's override is laid over the tracker's own. The cases that matter: typed bounds are kept
 * verbatim, a single bound is ignored, the `range` command's range holds, and otherwise Fit spans the rows against the now it is given.
 */

import { describe, expect, test }  from 'bun:test';
import type { Task }               from '../../src/lib/tracker-model/@types/Task.ts';
import type { TrackerProgress }    from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { StoredViewOverride } from '../@types/ViewerChoices.ts';
import { EMPTY_VIEW_OVERRIDE }     from '../preferences/constants/ViewOverride.ts';
import { effectiveViewRangeFor }   from './EffectiveViewRange.ts';

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

function exampleProgress(): TrackerProgress {
  return {
    trackerId:  'example-tracker-8f21',
    project:    'Example Agency',
    startedAt:  new Date(EXAMPLE_START_EPOCH_MILLISECONDS).toISOString(),
    nextTaskId: 2,
    view:       { kind: 'auto' },
    tasks:      [exampleTask()],
  };
}

function overrideWith(changes: Partial<StoredViewOverride>): StoredViewOverride {
  return { ...EMPTY_VIEW_OVERRIDE, ...changes };
}

describe('effectiveViewRangeFor', () => {
  test('fits the rows it is given when nothing is overridden and the tracker keeps no range of its own', () => {
    const now   = EXAMPLE_START_EPOCH_MILLISECONDS + 100 * 60_000;
    const range = effectiveViewRangeFor(exampleProgress(), EMPTY_VIEW_OVERRIDE, now);

    expect(range).toEqual({
      kind:        'absolute',
      from:        new Date(EXAMPLE_START_EPOCH_MILLISECONDS - 5 * 60_000).toISOString(),
      to:          new Date(now + 5 * 60_000).toISOString(),
      tickMinutes: null,
    });
  });

  test('keeps the range the range command stored when nothing is overridden', () => {
    const view = {
      kind: 'relative', from: '-2h', to: 'now', tickMinutes: null
    } as const;

    expect(effectiveViewRangeFor({ ...exampleProgress(), view }, EMPTY_VIEW_OVERRIDE, EXAMPLE_START_EPOCH_MILLISECONDS)).toEqual(view);
  });

  test('uses the typed bounds verbatim, so a relative one keeps resolving against each new now', () => {
    const range = effectiveViewRangeFor(
      exampleProgress(),
      overrideWith({ fromText: '-4h', toText: 'now', tickMinutes: 30 }),
      EXAMPLE_START_EPOCH_MILLISECONDS,
    );

    expect(range).toEqual({
      kind: 'relative', from: '-4h', to: 'now', tickMinutes: 30
    });
  });

  test('ignores a single bound and fits instead', () => {
    const range = effectiveViewRangeFor(exampleProgress(), overrideWith({ fromText: '-4h' }), EXAMPLE_START_EPOCH_MILLISECONDS);

    expect(range.kind).toBe('absolute');
  });

  test('keeps a tick chosen on Fit', () => {
    const range = effectiveViewRangeFor(exampleProgress(), overrideWith({ tickMinutes: 15 }), EXAMPLE_START_EPOCH_MILLISECONDS);

    expect(range.kind === 'absolute' && range.tickMinutes).toBe(15);
  });

  test('re-materialises that axis against the now it is given, rather than freezing it', () => {
    const override = overrideWith({ tickMinutes: 15 });
    const early = effectiveViewRangeFor(exampleProgress(), override, EXAMPLE_START_EPOCH_MILLISECONDS);
    const later = effectiveViewRangeFor(exampleProgress(), override, EXAMPLE_START_EPOCH_MILLISECONDS + 3 * 60 * 60_000);

    expect(early.kind === 'absolute' && later.kind === 'absolute' && later.to).not.toBe(early.kind === 'absolute' ? early.to : '');
  });
});

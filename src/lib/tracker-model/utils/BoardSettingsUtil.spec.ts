/**
 * The checks a stored or written board setting passes before the model takes it. What matters: every stored view shape passes and a
 * malformed one does not, a limit above the ceiling is still well-formed on disk, a name every object inherits is no dispatcher state,
 * and a blank run id is no run id.
 */
import { describe, expect, test } from 'bun:test';

import { CONCURRENCY_LIMIT_CEILING_AGENTS, LOWEST_CONCURRENCY_LIMIT_AGENTS } from '../constants/ConcurrencyLimits';
import { DISPATCHER_STATES }                                                 from '../constants/DispatcherStates';
import { BoardSettingsUtil }                                                 from './BoardSettingsUtil';

const {
  concurrencyLimitIsWellFormed,
  dispatcherRunIdIsWellFormed,
  dispatcherStateIsKnown,
  viewRangeIsWellFormed,
} = BoardSettingsUtil;

const EXAMPLE_VIEW_BOUNDS = { from: '2026-09-18T09:00', to: '2026-09-18T17:00' } as const;

describe('viewRangeIsWellFormed', () => {
  test('accepts the automatic view', () => {
    expect(viewRangeIsWellFormed({ kind: 'auto' })).toBe(true);
  });

  test('accepts an absolute and a relative view, with or without a tick', () => {
    for (const kind of ['absolute', 'relative']) {
      expect(viewRangeIsWellFormed({ ...EXAMPLE_VIEW_BOUNDS, kind, tickMinutes: null }), kind).toBe(true);
      expect(viewRangeIsWellFormed({ ...EXAMPLE_VIEW_BOUNDS, kind, tickMinutes: 30 }), kind).toBe(true);
    }
  });

  test('refuses a view that is not an object, has an unknown kind, lacks its bounds or carries a tick that is not a number', () => {
    expect(viewRangeIsWellFormed(null)).toBe(false);
    expect(viewRangeIsWellFormed('auto')).toBe(false);
    expect(viewRangeIsWellFormed({ kind: 'sliding' })).toBe(false);
    expect(viewRangeIsWellFormed({ kind: 'absolute', from: EXAMPLE_VIEW_BOUNDS.from, tickMinutes: null })).toBe(false);
    expect(viewRangeIsWellFormed({ ...EXAMPLE_VIEW_BOUNDS, kind: 'relative', tickMinutes: '30' })).toBe(false);
  });
});

describe('concurrencyLimitIsWellFormed', () => {
  test('accepts the lowest limit', () => {
    expect(concurrencyLimitIsWellFormed(LOWEST_CONCURRENCY_LIMIT_AGENTS)).toBe(true);
  });

  // An older tracker may hold a limit above today's ceiling; the read clamps it rather than refusing the whole file.
  test('accepts a limit above the ceiling, which is still well-formed on disk', () => {
    expect(concurrencyLimitIsWellFormed(CONCURRENCY_LIMIT_CEILING_AGENTS + 1)).toBe(true);
  });

  test('refuses zero, a fraction and a string', () => {
    expect(concurrencyLimitIsWellFormed(0)).toBe(false);
    expect(concurrencyLimitIsWellFormed(1.5)).toBe(false);
    expect(concurrencyLimitIsWellFormed('3')).toBe(false);
  });
});

describe('dispatcherStateIsKnown', () => {
  test('knows every dispatcher state', () => {
    expect(DISPATCHER_STATES.filter((state) => !dispatcherStateIsKnown(state))).toEqual([]);
  });

  test('does not know a name every object inherits, nor a plausible state the tuple lacks', () => {
    expect(dispatcherStateIsKnown('constructor')).toBe(false);
    expect(dispatcherStateIsKnown('paused')).toBe(false);
  });
});

describe('dispatcherRunIdIsWellFormed', () => {
  test('accepts a Workflow run id', () => {
    expect(dispatcherRunIdIsWellFormed('wf_example')).toBe(true);
  });

  test('refuses a blank run id, a whitespace one and a number', () => {
    expect(dispatcherRunIdIsWellFormed('')).toBe(false);
    expect(dispatcherRunIdIsWellFormed('   ')).toBe(false);
    expect(dispatcherRunIdIsWellFormed(42)).toBe(false);
  });
});

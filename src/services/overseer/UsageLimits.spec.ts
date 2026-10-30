/**
 * The pure parts of the usage-limit handling. What matters: only a top-level refusal counts, never a warning; the reset the policy holds by
 * is the latest of the marker's and this pass's hits, so a limit met in this hold already holds its launches; a marker is never moved
 * earlier, since another board may have met a longer limit; and the scheduled wake never overflows the timer, which would fire at once.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';
import { UsageMarkerFile }                                from '../../adapters/usage-marker/UsageMarkerFile.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { UsageLimits }                                    from './UsageLimits.ts';

const WINDOW_EVENT = {
  kind: 'usage-window', window: 'five_hour', utilization: 1, resetsAt: '2026-11-01T22:00:00.000Z', status: 'rejected'
} as const;

describe('refusalOf', () => {
  test('a refusing window event is a hit with its window and reset', () => {
    expect(UsageLimits.refusalOf({ ...WINDOW_EVENT, requestsRefused: true })).toEqual({ window: 'five_hour', resetsAt: '2026-11-01T22:00:00.000Z' });
  });

  test('a warning, or any other event, is none', () => {
    expect(UsageLimits.refusalOf({ ...WINDOW_EVENT, status: 'allowed_warning', requestsRefused: false })).toBeNull();
    expect(UsageLimits.refusalOf({ kind: 'permission-denied', toolName: 'Bash' })).toBeNull();
  });
});

describe('usageResetsAtOf', () => {
  const marked = {
    verdict: 'read',
    marker:  {
      vendor: 'claude-code', window: 'seven_day', resetsAt: '2026-11-03T00:00:00.000Z', seenBy: { trackerId: 't', jobId: 'J1' }
    }
  } as const;

  test('is null with no marker and no hit, and the latest of both otherwise', () => {
    expect(UsageLimits.usageResetsAtOf({ verdict: 'absent' }, [])).toBeNull();
    expect(UsageLimits.usageResetsAtOf({ verdict: 'absent' }, [{ jobId: 'J2', window: 'five_hour', resetsAt: '2026-11-01T22:00:00.000Z' }])).toBe('2026-11-01T22:00:00.000Z');
    expect(UsageLimits.usageResetsAtOf(marked, [{ jobId: 'J2', window: 'five_hour', resetsAt: '2026-11-01T22:00:00.000Z' }])).toBe('2026-11-03T00:00:00.000Z');
    expect(UsageLimits.usageResetsAtOf({ verdict: 'malformed', reason: 'example' }, [])).toBeNull();
  });
});

describe('markHits', () => {
  let monitorFolder = '';

  beforeEach(() => {
    monitorFolder = createScratchDirectory('usage-limits');
  });

  afterEach(() => {
    removeScratchDirectory(monitorFolder);
  });

  test('writes the latest hit, and never moves a later marker earlier', () => {
    UsageLimits.markHits(monitorFolder, 'claude-code', 'example-tracker', [
      { jobId: 'J1', window: 'five_hour', resetsAt: '2026-11-01T22:00:00.000Z' },
      { jobId: 'J2', window: 'seven_day', resetsAt: '2026-11-03T00:00:00.000Z' },
    ]);
    UsageLimits.markHits(monitorFolder, 'claude-code', 'other-tracker', [{ jobId: 'J9', window: 'five_hour', resetsAt: '2026-11-02T00:00:00.000Z' }]);
    expect(UsageMarkerFile.read(monitorFolder)).toEqual({
      verdict: 'read',
      marker:  {
        vendor: 'claude-code', window: 'seven_day', resetsAt: '2026-11-03T00:00:00.000Z', seenBy: { trackerId: 'example-tracker', jobId: 'J2' }
      },
    });
  });

  test('writes nothing without a hit', () => {
    UsageLimits.markHits(monitorFolder, 'claude-code', 'example-tracker', []);
    expect(UsageMarkerFile.read(monitorFolder)).toEqual({ verdict: 'absent' });
  });
});

describe('millisecondsUntilReset', () => {
  const now = new Date('2026-11-01T21:00:00.000Z');

  test('is the time left, or null with no limit or once the reset passed', () => {
    expect(UsageLimits.millisecondsUntilReset('2026-11-01T21:00:01.000Z', now)).toBe(1000);
    expect(UsageLimits.millisecondsUntilReset('2026-11-01T21:00:00.000Z', now)).toBeNull();
    expect(UsageLimits.millisecondsUntilReset(null, now)).toBeNull();
  });

  test('a reset weeks away is capped at the longest delay a timer holds, so the wake never fires at once', () => {
    expect(UsageLimits.millisecondsUntilReset('2026-12-31T00:00:00.000Z', now)).toBe(2_147_483_647);
  });
});

/**
 * A chart segment's colour comes from the phase it shows, never from the state its row is in now: the state mapping, and the cutting of a
 * row's recorded phases to the run its bar covers, where phases before the start or after the end must not leak onto the bar.
 */

import { describe, expect, test } from 'bun:test';
import type { TaskStatus }        from '../../src/lib/tracker-model/@types/Task.ts';
import { BarPhaseUtil }           from './BarPhaseUtil.ts';

const MINUTE = 60_000;
const START  = Date.parse('2026-09-18T20:00:00+02:00');

function stampAfterStart(minutes: number): string {
  return new Date(START + minutes * MINUTE).toISOString();
}

describe('segmentStateOf', () => {
  test.each<TaskStatus>(['in-progress', 'paused', 'in-review', 're-review', 'reviewed', 'delivered', 'abandoned', 'pending'])(
    'reads a %s phase as that state, whatever state the row is in now',
    (status) => {
      expect(BarPhaseUtil.segmentStateOf(status, null)).toBe(status);
    },
  );

  test('reads a review pass in its round\'s fill, whatever phase its own row is in', () => {
    expect(BarPhaseUtil.segmentStateOf('in-progress', 1)).toBe('reviewing');
    expect(BarPhaseUtil.segmentStateOf('delivered', 2)).toBe('re-review');
    expect(BarPhaseUtil.segmentStateOf('in-progress', 3)).toBe('re-review');
  });
});

describe('phaseSpansOf', () => {
  test('runs each phase to the next one, the last to the bar\'s end, and drops the phases outside the bar', () => {
    const history = [
      { status: 'pending' as const, at: stampAfterStart(-30) },
      { status: 'in-progress' as const, at: stampAfterStart(0) },
      { status: 'paused' as const, at: stampAfterStart(10) },
      { status: 'in-progress' as const, at: stampAfterStart(25) },
      { status: 'in-review' as const, at: stampAfterStart(40) },
      { status: 'delivered' as const, at: stampAfterStart(90) },
    ];

    expect(BarPhaseUtil.phaseSpansOf(history, START, START + 40 * MINUTE)).toEqual([
      { status: 'in-progress', startEpochMilliseconds: START, endEpochMilliseconds: START + 10 * MINUTE },
      { status: 'paused', startEpochMilliseconds: START + 10 * MINUTE, endEpochMilliseconds: START + 25 * MINUTE },
      { status: 'in-progress', startEpochMilliseconds: START + 25 * MINUTE, endEpochMilliseconds: START + 40 * MINUTE },
    ]);
  });

  test('skips an unreadable stamp, letting the phase before it run on', () => {
    const history = [
      { status: 'in-progress' as const, at: stampAfterStart(0) },
      { status: 'paused' as const, at: 'not a stamp' },
    ];

    expect(BarPhaseUtil.phaseSpansOf(history, START, START + 5 * MINUTE)).toEqual([
      { status: 'in-progress', startEpochMilliseconds: START, endEpochMilliseconds: START + 5 * MINUTE },
    ]);
  });

  test('gives a row without a history no span', () => {
    expect(BarPhaseUtil.phaseSpansOf(undefined, START, START + MINUTE)).toEqual([]);
  });
});

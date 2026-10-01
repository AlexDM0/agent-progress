/**
 * Which phase each stretch of a chart bar shows, so a segment is coloured by its own phase and never by the state its row is in now.
 * DOM-free and clock-free: the bar's run arrives in epoch milliseconds.
 */

import type { DisplayState, Task, TaskStatus } from '../../src/lib/tracker-model/@types/Task.ts';
import { TimeUtil }                            from './TimeUtil.ts';

export interface BarPhaseSpan {
  status:                 TaskStatus;
  startEpochMilliseconds: number;
  endEpochMilliseconds:   number;
}

/** Each recorded phase runs from its own stamp to the next readable one, cut to the bar's run; a phase the run does not cover is left out. */
function phaseSpansOf(history: Task['history'], barStartEpochMilliseconds: number, barEndEpochMilliseconds: number): BarPhaseSpan[] {
  const stamped = (history ?? []).flatMap((phase) => {
    const atEpochMilliseconds = TimeUtil.epochMillisecondsOf(phase.at);
    return atEpochMilliseconds === null ? [] : [{ status: phase.status, atEpochMilliseconds }];
  });
  return stamped.flatMap((phase, index) => {
    const nextAt                 = stamped[index + 1]?.atEpochMilliseconds ?? barEndEpochMilliseconds;
    const startEpochMilliseconds = Math.max(phase.atEpochMilliseconds, barStartEpochMilliseconds);
    const endEpochMilliseconds   = Math.min(nextAt, barEndEpochMilliseconds);
    return endEpochMilliseconds > startEpochMilliseconds ? [{ status: phase.status, startEpochMilliseconds, endEpochMilliseconds }] : [];
  });
}

/** A review pass, `reviewPassRound` from 1, reads in its round's review fill; any other segment reads as the phase it shows. */
function segmentStateOf(phaseStatus: TaskStatus, reviewPassRound: number | null): DisplayState {
  if (reviewPassRound === null) {
    return phaseStatus;
  }
  return reviewPassRound === 1 ? 'reviewing' : 're-review';
}

export const BarPhaseUtil = {
  phaseSpansOf,
  segmentStateOf,
} as const;

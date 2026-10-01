/** A Board for callers that only read: what it would log goes nowhere, and nothing it holds is written. */
import type { Epic }            from './@types/Epic.ts';
import type { Ticket }          from './@types/Ticket.ts';
import type { TrackerProgress } from './@types/TrackerProgress.ts';
import { Board }                from './Board.ts';
import { createLogger }         from './Logger.ts';

export function readingBoardOf(progress: TrackerProgress, tickets: Ticket[], epics: Epic[]): Board {
  return new Board({
    progress, tickets, epics, logger: createLogger(() => undefined)
  });
}

/** A Board for callers that only read: what it would log goes nowhere, and nothing it holds is written. */
import type { Ticket }          from './@types/Ticket.ts';
import type { TrackerProgress } from './@types/TrackerProgress.ts';
import { Board }                from './Board.ts';
import { createLogger }         from './Logger.ts';

export function readingBoardOf(progress: TrackerProgress, tickets: Ticket[]): Board {
  return new Board({ progress, tickets, logger: createLogger(() => undefined) });
}

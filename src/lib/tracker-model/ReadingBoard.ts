/** A Board for callers that only read: what it would log goes nowhere, and nothing it holds is written. */
import type { ProgressFile } from './@types/ProgressFile.ts';
import type { Ticket }       from './@types/Ticket.ts';
import { Board }             from './Board.ts';
import { createLogger }      from './Logger.ts';

export function readingBoardOf(progress: ProgressFile, tickets: Ticket[]): Board {
  return new Board({ progress, tickets, logger: createLogger(() => undefined) });
}

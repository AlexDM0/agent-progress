/** A Board for callers that only read: what it would log goes nowhere, and nothing it holds is written. */
import type { Draft }           from './@types/Draft.ts';
import type { Epic }            from './@types/Epic.ts';
import type { LogRecord }       from './@types/LogRecord.ts';
import type { Ticket }          from './@types/Ticket.ts';
import type { TrackerProgress } from './@types/TrackerProgress.ts';
import { Board }                from './Board.ts';
import { createLogger }         from './Logger.ts';

/** `storedLogRecords` orders the ready tickets by readiness; a caller that reads no ready tickets leaves it out. */
export function readingBoardOf(progress: TrackerProgress, tickets: Ticket[], epics: Epic[], drafts: Draft[] = [], storedLogRecords: readonly LogRecord[] = []): Board {
  return new Board({
    progress, tickets, epics, drafts, logger: createLogger(() => undefined), storedLogRecords
  });
}

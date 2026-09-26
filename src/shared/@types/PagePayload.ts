/** The shape of the progress island, which the render side writes and the page reads. */

import type { TicketFrontmatter } from '../../lib/tracker-model/@types/Ticket.ts';
import type { ProgressDocument }  from './ProgressDocument.ts';

export interface PageLimits {
  tickStepLadderMinutes:       readonly number[];
  maximumTicksPerAxis:         number;
  axisMinimumSpanMinutes:      number;
  axisPaddingMinutes:          number;
  minimumBarWidthPercent:      number;
  hoursAxisLabelLimitMinutes:  number;
  weekAxisLabelLimitMinutes:   number;
  hourMinutes:                 number;
  dayMinutes:                  number;
  tickCountSafetyBound:        number;
  dateAndClockLength:          number;
  calendarDateLength:          number;
  monthAndDaySliceStart:       number;
  clockSliceStart:             number;
  clockSliceEnd:               number;
  doneWorkVisibleMilliseconds: number;
}

/** The two figures of `status --json`'s `concurrency` block the page shows, computed Bun-side by the same function. */
export interface PageConcurrency {
  limit:          number;
  agentsInFlight: number;
}

export interface PagePayload {
  progress:                     ProgressDocument;
  generatedAtEpochMilliseconds: number;
  limits:                       PageLimits;
  concurrency:                  PageConcurrency;
  pageScriptFailure:            string | null;
}

export interface PageTicket extends TicketFrontmatter {
  filePath: string;
  bodyHtml: string;
}

/**
 * The page's two islands as data: the `PagePayload` and the rendered tickets, from one progress file, its log and its tickets. The
 * static page fills its template with them and the Overseer's state document carries them; `generatedAt` is a parameter, not a clock.
 */
import { ProgressFileMappingUtil }                from '../../adapters/progress/utils/ProgressFileMappingUtil.ts';
import { LogUtil }                                from '../../adapters/utils/LogUtil.ts';
import type { Epic }                              from '../../lib/tracker-model/@types/Epic.ts';
import type { LogRecord }                         from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }                            from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }                   from '../../lib/tracker-model/@types/TrackerProgress.ts';
import type { PageConcurrency, PageDraftRequest } from '../../shared/@types/PagePayload.ts';
import type { PagePayload, PageTicket }           from '../../shared/@types/PagePayload.ts';
import { LIMITS }                                 from '../../shared/constants/Limits.ts';
import { TIME_UNITS }                             from '../../shared/constants/TimeUnits.ts';
import { TIMESTAMP_SLICES }                       from '../../shared/constants/TimestampSlices.ts';
import { withAcceptanceItemsSeparated }           from './MarkdownRenderer.ts';

export interface PagePayloadInput {
  progress:          TrackerProgress;
  logRecords:        readonly LogRecord[];
  tickets:           readonly Ticket[];
  epics:             readonly Epic[];
  pageScriptFailure: string | null;
  generatedAt:       Date;
  concurrency:       PageConcurrency;
  boardFacts:        PagePayload['boardFacts'];
  /** Absent reads as no open draft. */
  draftRequests?:    PageDraftRequest[];
  renderMarkdown:    (markdown: string) => string;
}

export interface AssembledPagePayload {
  payload: PagePayload;
  tickets: PageTicket[];
}

function pageLimits(): PagePayload['limits'] {
  return {
    tickStepLadderMinutes:      LIMITS.TICK_STEP_LADDER_MINUTES,
    maximumTicksPerAxis:        LIMITS.MAXIMUM_TICKS_PER_AXIS,
    axisMinimumSpanMinutes:     LIMITS.AXIS_MINIMUM_SPAN_MINUTES,
    axisPaddingMinutes:         LIMITS.AXIS_PADDING_MINUTES,
    minimumBarWidthPercent:     LIMITS.MINIMUM_BAR_WIDTH_PERCENT,
    hoursAxisLabelLimitMinutes: LIMITS.HOURS_AXIS_LABEL_LIMIT_MINUTES,
    weekAxisLabelLimitMinutes:  LIMITS.WEEK_AXIS_LABEL_LIMIT_MINUTES,
    hourMinutes:                TIME_UNITS.HOUR_MINUTES,
    dayMinutes:                 TIME_UNITS.DAY_MINUTES,
    tickCountSafetyBound:       LIMITS.TICK_COUNT_SAFETY_BOUND,
    dateAndClockLength:         TIMESTAMP_SLICES.DATE_AND_CLOCK_LENGTH_CHARACTERS,
    calendarDateLength:         TIMESTAMP_SLICES.CALENDAR_DATE_LENGTH_CHARACTERS,
    monthAndDaySliceStart:      TIMESTAMP_SLICES.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET,
    clockSliceStart:            TIMESTAMP_SLICES.CLOCK_SLICE_START_CHARACTER_OFFSET,
    clockSliceEnd:              TIMESTAMP_SLICES.CLOCK_SLICE_END_CHARACTER_OFFSET,
  };
}

function pageTicketsFor(tickets: readonly Ticket[], renderMarkdown: (markdown: string) => string): PageTicket[] {
  return tickets.map((ticket) => ({
    ...ticket.frontmatter,
    filePath: ticket.filePath,
    bodyHtml: renderMarkdown(withAcceptanceItemsSeparated(ticket.body)),
  }));
}

export function assemblePagePayload(input: PagePayloadInput): AssembledPagePayload {
  const {
    progress,
    logRecords,
    tickets,
    epics,
    pageScriptFailure,
    generatedAt,
    concurrency,
    boardFacts,
    draftRequests = [],
    renderMarkdown,
  } = input;
  const payload: PagePayload = {
    progress:                     ProgressFileMappingUtil.wordedDocumentOf(progress, logRecords.map(LogUtil.identifiedEntryOf)),
    generatedAtEpochMilliseconds: generatedAt.getTime(),
    limits:                       pageLimits(),
    concurrency:                  { limit: concurrency.limit, agentsInFlight: concurrency.agentsInFlight },
    pageScriptFailure,
    epicDescriptions:             epics.map((epic) => ({ key: epic.frontmatter.key, descriptionHtml: renderMarkdown(epic.body) })),
    ...draftRequests.length === 0 ? {} : { draftRequests },
    // Last, so every byte of the island before it stays where it was.
    boardFacts,
  };
  return { payload, tickets: pageTicketsFor(tickets, renderMarkdown) };
}

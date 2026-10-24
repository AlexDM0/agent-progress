/**
 * Fills `resources/template.html` — two islands, the page script, the title and the project heading — from one progress file, its log
 * and its tickets. Both islands go through `escapeJsonForScriptTag` of `src/lib/html-escape/HtmlEscapeUtil.ts`, so none can close its
 * script tag; `generatedAt` is a parameter, not a clock.
 */

import { readFileSync }                           from 'node:fs';
import { ProgressFileMappingUtil }                from '../../adapters/progress/utils/ProgressFileMappingUtil.ts';
import { LogUtil }                                from '../../adapters/utils/LogUtil.ts';
import { HtmlEscapeUtil }                         from '../../lib/html-escape/HtmlEscapeUtil.ts';
import type { Epic }                              from '../../lib/tracker-model/@types/Epic.ts';
import type { LogRecord }                         from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }                            from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }                   from '../../lib/tracker-model/@types/TrackerProgress.ts';
import type { PageConcurrency, PageDraftRequest } from '../../shared/@types/PagePayload.ts';
import type { PagePayload, PageTicket }           from '../../shared/@types/PagePayload.ts';
import { resourceFilePathOf }                     from '../../shared/ResourceFilePath.ts';
import { LIMITS }                                 from '../../shared/constants/Limits.ts';
import { TIME_UNITS }                             from '../../shared/constants/TimeUnits.ts';
import { TIMESTAMP_SLICES }                       from '../../shared/constants/TimestampSlices.ts';
import { withAcceptanceItemsSeparated }           from './MarkdownRenderer.ts';
import { substituteTemplateTokens }               from './TemplateTokenSubstitution.ts';
import { TEMPLATE_FILE_NAME, TEMPLATE_TOKENS }    from './constants/TemplateFile.ts';
import { PageScriptTextUtil }                     from './utils/PageScriptTextUtil.ts';

interface PageTemplateFillInput {
  progress:          TrackerProgress;
  logRecords:        readonly LogRecord[];
  tickets:           Ticket[];
  epics:             readonly Epic[];
  pageScript:        string | null;
  pageScriptFailure: string | null;
  generatedAt:       Date;
  concurrency:       PageConcurrency;
  boardFacts:        PagePayload['boardFacts'];
  /** Absent reads as no open draft. */
  draftRequests?:    PageDraftRequest[];
  renderMarkdown:    (markdown: string) => string;
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

export function fillPageTemplate(input: PageTemplateFillInput): string {
  const {
    progress,
    logRecords,
    tickets,
    epics,
    pageScript,
    pageScriptFailure,
    generatedAt,
    concurrency,
    boardFacts,
    draftRequests = [],
    renderMarkdown,
  } = input;
  // Read per call, never at module load.
  const template = readFileSync(resourceFilePathOf(TEMPLATE_FILE_NAME), 'utf8');

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

  const description = { templateFilePath: `resources/${TEMPLATE_FILE_NAME}`, tokens: Object.values(TEMPLATE_TOKENS) };
  return substituteTemplateTokens(template, description, {
    [TEMPLATE_TOKENS.TITLE]:           `<title>${HtmlEscapeUtil.escapeHtml(progress.project)} progress</title>`,
    // Written here as well as by the page script, so the heading never shows empty before the script runs.
    [TEMPLATE_TOKENS.PROJECT_HEADING]: `<h1 class="ap-title" id="ap-project">${HtmlEscapeUtil.escapeHtml(progress.project)}</h1>`,
    [TEMPLATE_TOKENS.PROGRESS]:        HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(payload)),
    [TEMPLATE_TOKENS.TICKETS]:         HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(pageTicketsFor(tickets, renderMarkdown))),
    [TEMPLATE_TOKENS.PAGE_SCRIPT]:     pageScript ?? PageScriptTextUtil.bannerOnlyScriptOf(pageScriptFailure),
  });
}

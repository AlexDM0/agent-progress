/**
 * Fills `resources/template.html` — two islands, the page script and the title — from one progress file, its log and its tickets. Both
 * islands go through `escapeJsonForScriptTag` of `src/lib/html-escape/HtmlEscapeUtil.ts`, so none can close its script tag; `generatedAt`
 * is a parameter, not a clock.
 */

import { readFileSync }                                  from 'node:fs';
import { ProgressFileMappingUtil }                       from '../../adapters/progress/utils/ProgressFileMappingUtil.ts';
import { LogUtil }                                       from '../../adapters/utils/LogUtil.ts';
import { HtmlEscapeUtil }                                from '../../lib/html-escape/HtmlEscapeUtil.ts';
import type { LogRecord }                                from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }                                   from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }                          from '../../lib/tracker-model/@types/TrackerProgress.ts';
import type { PageConcurrency, PagePayload, PageTicket } from '../../shared/@types/PagePayload.ts';
import { resourceFilePathOf }                            from '../../shared/ResourceFilePath.ts';
import { LIMITS }                                        from '../../shared/constants/Limits.ts';
import { TIME_UNITS }                                    from '../../shared/constants/TimeUnits.ts';
import { TIMESTAMP_SLICES }                              from '../../shared/constants/TimestampSlices.ts';
import { substituteTemplateTokens }                      from './TemplateTokenSubstitution.ts';
import { TEMPLATE_FILE_NAME, TEMPLATE_TOKENS }           from './constants/TemplateFile.ts';

interface PageTemplateFillInput {
  progress:          TrackerProgress;
  logRecords:        readonly LogRecord[];
  tickets:           Ticket[];
  pageScript:        string | null;
  pageScriptFailure: string | null;
  generatedAt:       Date;
  concurrency:       PageConcurrency;
  boardFacts:        PagePayload['boardFacts'];
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
    bodyHtml: renderMarkdown(ticket.body),
  }));
}

function bannerOnlyScript(reason: string): string {
  const message = HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(reason));
  return [
    '(function(){',
    'var banner=document.getElementById("ap-error");',
    'var text=document.getElementById("ap-error-text");',
    `if(text){text.textContent=${message};}`,
    'if(banner){banner.hidden=false;}',
    '})();',
  ].join('');
}

export function fillPageTemplate(input: PageTemplateFillInput): string {
  const {
    progress,
    logRecords,
    tickets,
    pageScript,
    pageScriptFailure,
    generatedAt,
    concurrency,
    boardFacts,
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
    // Last, so every byte of the island before it stays where it was.
    boardFacts,
  };

  return substituteTemplateTokens(template, {
    [TEMPLATE_TOKENS.TITLE]:       `<title>${HtmlEscapeUtil.escapeHtml(progress.project)} progress</title>`,
    [TEMPLATE_TOKENS.PROGRESS]:    HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(payload)),
    [TEMPLATE_TOKENS.TICKETS]:     HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(pageTicketsFor(tickets, renderMarkdown))),
    [TEMPLATE_TOKENS.PAGE_SCRIPT]: pageScript ?? bannerOnlyScript(pageScriptFailure ?? 'the page script could not be built'),
  });
}

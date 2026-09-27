/**
 * Fills `resources/template.html` — two islands, the page script and the title — from one progress file, its log and its tickets. Both islands go
 * through `escapeJsonForScriptTag` of `src/lib/utils/HtmlEscapeUtil.ts`, so none can close its script tag; `generatedAt` is a parameter, not a clock.
 */

import { readFileSync }                                  from 'node:fs';
import { ProgressDocumentUtil }                          from '../../adapters/progress/utils/ProgressDocumentUtil.ts';
import { LogUtil }                                       from '../../adapters/utils/LogUtil.ts';
import type { LogRecord }                                from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }                                   from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }                          from '../../lib/tracker-model/@types/TrackerProgress.ts';
import { HtmlEscapeUtil }                                from '../../lib/utils/HtmlEscapeUtil.ts';
import type { PageConcurrency, PagePayload, PageTicket } from '../../shared/@types/PagePayload.ts';
import { resourceFilePathOf }                            from '../../shared/ResourceFilePath.ts';
import { LIMITS }                                        from '../../shared/constants/Limits.ts';
import { TEMPLATE_FILE_NAME, TEMPLATE_TOKENS }           from './constants/TemplateFile.ts';
import { TemplateTokenUtil }                             from './utils/TemplateTokenUtil.ts';

const { escapeHtml, escapeJsonForScriptTag } = HtmlEscapeUtil;

interface RenderProgressHtmlInput {
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
    tickStepLadderMinutes:       LIMITS.TICK_STEP_LADDER_MINUTES,
    maximumTicksPerAxis:         LIMITS.MAXIMUM_TICKS_PER_AXIS,
    axisMinimumSpanMinutes:      LIMITS.AXIS_MINIMUM_SPAN_MINUTES,
    axisPaddingMinutes:          LIMITS.AXIS_PADDING_MINUTES,
    minimumBarWidthPercent:      LIMITS.MINIMUM_BAR_WIDTH_PERCENT,
    hoursAxisLabelLimitMinutes:  LIMITS.HOURS_AXIS_LABEL_LIMIT_MINUTES,
    weekAxisLabelLimitMinutes:   LIMITS.WEEK_AXIS_LABEL_LIMIT_MINUTES,
    hourMinutes:                 LIMITS.HOUR_MINUTES,
    dayMinutes:                  LIMITS.DAY_MINUTES,
    tickCountSafetyBound:        LIMITS.TICK_COUNT_SAFETY_BOUND,
    dateAndClockLength:          LIMITS.DATE_AND_CLOCK_LENGTH_CHARACTERS,
    calendarDateLength:          LIMITS.CALENDAR_DATE_LENGTH_CHARACTERS,
    monthAndDaySliceStart:       LIMITS.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET,
    clockSliceStart:             LIMITS.CLOCK_SLICE_START_CHARACTER_OFFSET,
    clockSliceEnd:               LIMITS.CLOCK_SLICE_END_CHARACTER_OFFSET,
    doneWorkVisibleMilliseconds: LIMITS.DONE_WORK_VISIBLE_MILLISECONDS,
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
  const message = escapeJsonForScriptTag(JSON.stringify(reason));
  return [
    '(function(){',
    'var banner=document.getElementById("ap-error");',
    'var text=document.getElementById("ap-error-text");',
    `if(text){text.textContent=${message};}`,
    'if(banner){banner.hidden=false;}',
    '})();',
  ].join('');
}

export function renderProgressHtml(input: RenderProgressHtmlInput): string {
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
    progress:                     ProgressDocumentUtil.documentOf(progress, logRecords.map(LogUtil.identifiedEntryOf)),
    generatedAtEpochMilliseconds: generatedAt.getTime(),
    limits:                       pageLimits(),
    concurrency:                  { limit: concurrency.limit, agentsInFlight: concurrency.agentsInFlight },
    pageScriptFailure,
    // Last, so every byte of the island before it stays where it was.
    boardFacts,
  };

  return TemplateTokenUtil.substituteTemplateTokens(template, {
    [TEMPLATE_TOKENS.TITLE]:       `<title>${escapeHtml(progress.project)} progress</title>`,
    [TEMPLATE_TOKENS.PROGRESS]:    escapeJsonForScriptTag(JSON.stringify(payload)),
    [TEMPLATE_TOKENS.TICKETS]:     escapeJsonForScriptTag(JSON.stringify(pageTicketsFor(tickets, renderMarkdown))),
    [TEMPLATE_TOKENS.PAGE_SCRIPT]: pageScript ?? bannerOnlyScript(pageScriptFailure ?? 'the page script could not be built'),
  });
}

/**
 * Fills `resources/template.html` — two islands, the page script and the title — from one progress file, its log and its tickets. Both islands go
 * through `escapeJsonForScriptTag` of `src/lib/utils/HtmlEscapeUtil.ts`, so none can close its script tag; `generatedAt` is a parameter, not a clock.
 */

import { readFileSync }                                  from 'node:fs';
import { join }                                          from 'node:path';
import { ProgressDocumentUtil }                          from '../../adapters/progress/utils/ProgressDocumentUtil.ts';
import { LogUtil }                                       from '../../adapters/utils/LogUtil.ts';
import type { LogRecord }                                from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }                             from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { Ticket }                                   from '../../lib/tracker-model/@types/Ticket.ts';
import { HtmlEscapeUtil }                                from '../../lib/utils/HtmlEscapeUtil.ts';
import type { PageConcurrency, PagePayload, PageTicket } from '../../shared/@types/PagePayload.ts';
import { OperationRefusal }                              from '../../shared/OperationRefusal.ts';
import { LIMITS }                                        from '../../shared/constants/Limits.ts';

const { escapeHtml, escapeJsonForScriptTag } = HtmlEscapeUtil;

const TEMPLATE_FILE_NAME = 'template.html';

const PROGRESS_TOKEN    = '__PROGRESS__';
const TICKETS_TOKEN     = '__TICKETS__';
const PAGE_SCRIPT_TOKEN = '__PAGE_SCRIPT__';
const TITLE_TOKEN       = '<title>agent-progress</title>';

/** Splitting on all four at once keeps injected content out of the search: a task named `__TICKETS__` would be found by a later replacement. */
const TEMPLATE_TOKEN_PATTERN = /(__PROGRESS__|__TICKETS__|__PAGE_SCRIPT__|<title>agent-progress<\/title>)/;

interface RenderProgressHtmlInput {
  progress:          ProgressFile;
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
    dateAndClockLength:          LIMITS.DATE_AND_CLOCK_LENGTH,
    calendarDateLength:          LIMITS.CALENDAR_DATE_LENGTH,
    monthAndDaySliceStart:       LIMITS.MONTH_AND_DAY_SLICE_START,
    clockSliceStart:             LIMITS.CLOCK_SLICE_START,
    clockSliceEnd:               LIMITS.CLOCK_SLICE_END,
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

export function substituteTemplateTokens(template: string, values: Readonly<Record<string, string>>): string {
  const pieces = template.split(TEMPLATE_TOKEN_PATTERN);
  for (const token of Object.keys(values)) {
    const occurrences = pieces.filter((piece) => piece === token).length;
    if (occurrences !== 1) {
      throw new OperationRefusal('unrepaired', {
        kind:             'template-token-not-unique',
        templateFilePath: `resources/${TEMPLATE_FILE_NAME}`,
        token,
        occurrenceCount:  occurrences,
      });
    }
  }
  return pieces.map((piece) => (Object.hasOwn(values, piece) ? values[piece] ?? '' : piece)).join('');
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
  // Read per call, never at module load, and from the installed package rather than the caller's working directory.
  const template = readFileSync(join(import.meta.dir, '..', '..', '..', 'resources', TEMPLATE_FILE_NAME), 'utf8');

  const payload: PagePayload = {
    progress:                     ProgressDocumentUtil.documentOf(progress, logRecords.map(LogUtil.identifiedEntryOf)),
    generatedAtEpochMilliseconds: generatedAt.getTime(),
    limits:                       pageLimits(),
    concurrency:                  { limit: concurrency.limit, agentsInFlight: concurrency.agentsInFlight },
    pageScriptFailure,
    // Last, so every byte of the island before it stays where it was.
    boardFacts,
  };

  return substituteTemplateTokens(template, {
    [TITLE_TOKEN]:       `<title>${escapeHtml(progress.project)} progress</title>`,
    [PROGRESS_TOKEN]:    escapeJsonForScriptTag(JSON.stringify(payload)),
    [TICKETS_TOKEN]:     escapeJsonForScriptTag(JSON.stringify(pageTicketsFor(tickets, renderMarkdown))),
    [PAGE_SCRIPT_TOKEN]: pageScript ?? bannerOnlyScript(pageScriptFailure ?? 'the page script could not be built'),
  });
}

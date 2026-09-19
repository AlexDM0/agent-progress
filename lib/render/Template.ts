/**
 * Fills `lib/render/page/template.html` — two islands, the page script and the title — from one progress file and its tickets. Both islands go
 * through `escapeJsonForScriptTag` of `lib/utils/HtmlEscapeUtil.ts`, so none can close its script tag; `generatedAt` is a parameter, not a clock.
 */

import { readFileSync }            from 'node:fs';
import { join }                    from 'node:path';
import {
  AXIS_MINIMUM_SPAN_MINUTES,
  AXIS_PADDING_MINUTES,
  CALENDAR_DATE_LENGTH,
  CLOCK_SLICE_END,
  CLOCK_SLICE_START,
  DATE_AND_CLOCK_LENGTH,
  DAY_MINUTES,
  DONE_WORK_VISIBLE_MILLISECONDS,
  HOUR_MINUTES,
  HOURS_AXIS_LABEL_LIMIT_MINUTES,
  MAXIMUM_TICKS_PER_AXIS,
  MINIMUM_BAR_WIDTH_PERCENT,
  MONTH_AND_DAY_SLICE_START,
  TICK_COUNT_SAFETY_BOUND,
  TICK_STEP_LADDER_MINUTES,
  WEEK_AXIS_LABEL_LIMIT_MINUTES,
} from '../constants/Limits.ts';
import type { ProgressFile, Ticket }    from '../constants/Types.ts';
import { OperationRefusal }             from '../platform/OperationRefusal.ts';
import { HtmlEscapeUtil }               from '../utils/HtmlEscapeUtil.ts';
import { renderMarkdown }               from './Markdown.ts';
import type { PagePayload, PageTicket } from './page/PageData.ts';

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
  tickets:           Ticket[];
  pageScript:        string | null;
  pageScriptFailure: string | null;
  generatedAt:       Date;
}

function pageLimits(): PagePayload['limits'] {
  return {
    tickStepLadderMinutes:       TICK_STEP_LADDER_MINUTES,
    maximumTicksPerAxis:         MAXIMUM_TICKS_PER_AXIS,
    axisMinimumSpanMinutes:      AXIS_MINIMUM_SPAN_MINUTES,
    axisPaddingMinutes:          AXIS_PADDING_MINUTES,
    minimumBarWidthPercent:      MINIMUM_BAR_WIDTH_PERCENT,
    hoursAxisLabelLimitMinutes:  HOURS_AXIS_LABEL_LIMIT_MINUTES,
    weekAxisLabelLimitMinutes:   WEEK_AXIS_LABEL_LIMIT_MINUTES,
    hourMinutes:                 HOUR_MINUTES,
    dayMinutes:                  DAY_MINUTES,
    tickCountSafetyBound:        TICK_COUNT_SAFETY_BOUND,
    dateAndClockLength:          DATE_AND_CLOCK_LENGTH,
    calendarDateLength:          CALENDAR_DATE_LENGTH,
    monthAndDaySliceStart:       MONTH_AND_DAY_SLICE_START,
    clockSliceStart:             CLOCK_SLICE_START,
    clockSliceEnd:               CLOCK_SLICE_END,
    doneWorkVisibleMilliseconds: DONE_WORK_VISIBLE_MILLISECONDS,
  };
}

function pageTicketsFor(tickets: readonly Ticket[]): PageTicket[] {
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
      throw new OperationRefusal(
        'unrepaired',
        `the page template lib/render/page/${TEMPLATE_FILE_NAME} holds ${occurrences} occurrences of ${token}, not exactly one`,
      );
    }
  }
  return pieces.map((piece) => (Object.hasOwn(values, piece) ? values[piece] ?? '' : piece)).join('');
}

export function renderProgressHtml(input: RenderProgressHtmlInput): string {
  const {
    progress,
    tickets,
    pageScript,
    pageScriptFailure,
    generatedAt,
  } = input;
  // Read per call, never at module load, and from the installed package rather than the caller's working directory.
  const template = readFileSync(join(import.meta.dir, 'page', TEMPLATE_FILE_NAME), 'utf8');

  const payload: PagePayload = {
    progress,
    generatedAtEpochMilliseconds: generatedAt.getTime(),
    limits:                       pageLimits(),
    pageScriptFailure,
  };

  return substituteTemplateTokens(template, {
    [TITLE_TOKEN]:       `<title>${escapeHtml(progress.project)} progress</title>`,
    [PROGRESS_TOKEN]:    escapeJsonForScriptTag(JSON.stringify(payload)),
    [TICKETS_TOKEN]:     escapeJsonForScriptTag(JSON.stringify(pageTicketsFor(tickets))),
    [PAGE_SCRIPT_TOKEN]: pageScript ?? bannerOnlyScript(pageScriptFailure ?? 'the page script could not be built'),
  });
}

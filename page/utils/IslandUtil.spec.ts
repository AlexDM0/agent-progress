/**
 * Validating the two JSON islands. The cases that matter: the progress island is refused whole, never cast, when anything the chart divides
 * by or prints is missing, or when a Board fact is missing, unknown or points outside the tasks, while the tickets island drops only its
 * unusable entries.
 */

import { describe, expect, test }          from 'bun:test';
import type { Task }                       from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageBoardFacts, PageLimits } from '../../src/shared/@types/PagePayload.ts';
import type { ProgressDocument }           from '../../src/shared/@types/ProgressDocument.ts';
import { IslandUtil }                      from './IslandUtil.ts';

const { pagePayloadFrom, pageTicketsFrom } = IslandUtil;

const EXAMPLE_LIMITS: PageLimits = {
  tickStepLadderMinutes:       [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440],
  maximumTicksPerAxis:         12,
  axisMinimumSpanMinutes:      60,
  axisPaddingMinutes:          15,
  minimumBarWidthPercent:      0.6,
  hoursAxisLabelLimitMinutes:  1440,
  weekAxisLabelLimitMinutes:   10_080,
  hourMinutes:                 60,
  dayMinutes:                  1440,
  tickCountSafetyBound:        500,
  dateAndClockLength:          16,
  calendarDateLength:          10,
  monthAndDaySliceStart:       5,
  clockSliceStart:             11,
  clockSliceEnd:               16,
  doneWorkVisibleMilliseconds: 86_400_000,
};

const EXAMPLE_START_EPOCH_MILLISECONDS = Date.UTC(2026, 8, 18, 18, 0, 0);

function exampleTask(): Task {
  return {
    id:     1,
    name:   'Planning pass',
    status: 'in-progress',
    start:  new Date(EXAMPLE_START_EPOCH_MILLISECONDS).toISOString(),
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
  };
}

function exampleProgress(): ProgressDocument {
  return {
    version:    1,
    trackerId:  'example-tracker-8f21',
    project:    'Example Agency',
    startedAt:  new Date(EXAMPLE_START_EPOCH_MILLISECONDS).toISOString(),
    nextTaskId: 2,
    view:       { kind: 'auto' },
    tasks:      [exampleTask()],
    log:        [],
  };
}

function examplePayload(): Record<string, unknown> {
  return {
    progress:                     exampleProgress(),
    generatedAtEpochMilliseconds: EXAMPLE_START_EPOCH_MILLISECONDS,
    limits:                       EXAMPLE_LIMITS,
    concurrency:                  { limit: 2, agentsInFlight: 0 },
    pageScriptFailure:            null,
    boardFacts:                   exampleBoardFacts(),
  };
}

function exampleBoardFacts(): PageBoardFacts {
  return {
    rows:    [{ displayState: 'in-progress', deliveredRowCountsAsReviewed: false, ownRowPositionOfReviewedTicket: null }],
    tickets: [],
  };
}

function payloadWithBoardFacts(boardFacts: unknown): Record<string, unknown> {
  return { ...examplePayload(), boardFacts };
}

describe('pagePayloadFrom', () => {
  test('accepts the payload the generator writes', () => {
    expect(pagePayloadFrom(examplePayload())).not.toBeNull();
  });

  test('accepts a payload carrying fields the page has never heard of', () => {
    const progress = { ...exampleProgress(), somethingAddedLater: 'x' };

    expect(pagePayloadFrom({ ...examplePayload(), progress, addedAtTheTopLevelToo: 1 })).not.toBeNull();
  });

  test.each([
    ['null', null],
    ['a string', 'not a payload'],
    ['an empty object', {}],
  ])('refuses %s rather than casting it', (_description, value) => {
    expect(pagePayloadFrom(value)).toBeNull();
  });

  test.each([
    ['the progress file', 'progress'],
    ['the limits', 'limits'],
    ['the generated stamp', 'generatedAtEpochMilliseconds'],
    ['the concurrency figures', 'concurrency'],
  ])('refuses a payload missing %s', (_description, missingKey) => {
    const payload: Record<string, unknown> = examplePayload();
    delete payload[missingKey];

    expect(pagePayloadFrom(payload)).toBeNull();
  });

  test('refuses a payload whose concurrency figures are not numbers, since the summary line prints them', () => {
    expect(pagePayloadFrom({ ...examplePayload(), concurrency: { limit: '2', agentsInFlight: 0 } })).toBeNull();
  });

  test('refuses a payload whose limits are not all finite numbers, since every percentage divides by one', () => {
    const limits = { ...EXAMPLE_LIMITS, axisMinimumSpanMinutes: Number.NaN };

    expect(pagePayloadFrom({ ...examplePayload(), limits })).toBeNull();
  });

  test('refuses a payload whose timestamp slice positions are missing', () => {
    const limits: Record<string, unknown> = { ...EXAMPLE_LIMITS };
    delete limits['clockSliceEnd'];

    expect(pagePayloadFrom({ ...examplePayload(), limits })).toBeNull();
  });

  test('refuses a payload whose tick ladder is not a list of numbers', () => {
    const limits = { ...EXAMPLE_LIMITS, tickStepLadderMinutes: ['five'] };

    expect(pagePayloadFrom({ ...examplePayload(), limits })).toBeNull();
  });

  test('refuses a progress file whose tasks and log are not lists', () => {
    const progress = { ...exampleProgress(), tasks: 'none' };

    expect(pagePayloadFrom({ ...examplePayload(), progress })).toBeNull();
  });

  test('refuses a payload without its Board facts', () => {
    const payload: Record<string, unknown> = examplePayload();
    delete payload['boardFacts'];

    expect(pagePayloadFrom(payload)).toBeNull();
  });

  test('refuses row facts whose count differs from the tasks, since each is zipped onto the task at its index', () => {
    const { rows: [rowFacts] } = exampleBoardFacts();

    expect(pagePayloadFrom(payloadWithBoardFacts({ rows: [], tickets: [] }))).toBeNull();
    expect(pagePayloadFrom(payloadWithBoardFacts({ rows: [rowFacts, rowFacts], tickets: [] }))).toBeNull();
  });

  test.each([
    ['negative', -1],
    ['equal to the task count', 1],
    ['fractional', 0.5],
    ['text', '0'],
  ])('refuses a row or ticket position that is %s', (_description, position) => {
    const rowFacts = { displayState: 'in-review', deliveredRowCountsAsReviewed: false, ownRowPositionOfReviewedTicket: position };
    const ticketFacts = {
      ticketId: '003', ownRowPosition: null, reviewBarPositions: [position], displayState: 'in-review' 
    };
    const ownRowFacts = { ...ticketFacts, ownRowPosition: position, reviewBarPositions: [] };

    expect(pagePayloadFrom(payloadWithBoardFacts({ rows: [rowFacts], tickets: [] }))).toBeNull();
    expect(pagePayloadFrom(payloadWithBoardFacts({ ...exampleBoardFacts(), tickets: [ticketFacts] }))).toBeNull();
    expect(pagePayloadFrom(payloadWithBoardFacts({ ...exampleBoardFacts(), tickets: [ownRowFacts] }))).toBeNull();
  });

  test('refuses a display state the page has no label for', () => {
    const rowFacts = { displayState: 'finished', deliveredRowCountsAsReviewed: false, ownRowPositionOfReviewedTicket: null };
    const ticketFacts = {
      ticketId: '003', ownRowPosition: null, reviewBarPositions: [], displayState: 'toString' 
    };

    expect(pagePayloadFrom(payloadWithBoardFacts({ rows: [rowFacts], tickets: [] }))).toBeNull();
    expect(pagePayloadFrom(payloadWithBoardFacts({ ...exampleBoardFacts(), tickets: [ticketFacts] }))).toBeNull();
  });

  test('refuses a ticket fact without a text ticket id or without a list of review bar positions', () => {
    const ticketFacts = {
      ticketId: '003', ownRowPosition: 0, reviewBarPositions: [], displayState: 'in-progress' 
    };

    expect(pagePayloadFrom(payloadWithBoardFacts({ ...exampleBoardFacts(), tickets: [ticketFacts] }))).not.toBeNull();
    expect(pagePayloadFrom(payloadWithBoardFacts({ ...exampleBoardFacts(), tickets: [{ ...ticketFacts, ticketId: 3 }] }))).toBeNull();
    expect(pagePayloadFrom(payloadWithBoardFacts({ ...exampleBoardFacts(), tickets: [{ ...ticketFacts, reviewBarPositions: 0 }] }))).toBeNull();
  });

  test('accepts facts with a ticket, its own row and a review bar', () => {
    const progress = {
      ...exampleProgress(),
      tasks: [exampleTask(), {
        ...exampleTask(), id: 2, name: 'Review 1 #003', reviewOf: '003' 
      }] 
    };
    const boardFacts: PageBoardFacts = {
      rows: [
        { displayState: 'in-review', deliveredRowCountsAsReviewed: false, ownRowPositionOfReviewedTicket: null },
        { displayState: 'in-progress', deliveredRowCountsAsReviewed: false, ownRowPositionOfReviewedTicket: 0 },
      ],
      tickets: [{
        ticketId: '003', ownRowPosition: 0, reviewBarPositions: [1], displayState: 'reviewing' 
      }],
    };

    expect(pagePayloadFrom({ ...examplePayload(), progress, boardFacts })).not.toBeNull();
  });
});

describe('pageTicketsFrom', () => {
  const usable = {
    id:       '003',
    title:    'Split the exporter',
    status:   'in-review',
    bodyHtml: '<p>x</p>',
  };

  test('keeps the usable entries and drops the rest, rather than failing the whole island', () => {
    const tickets = pageTicketsFrom([usable, { id: '004' }, null, 'nonsense']);

    expect(tickets.map((ticket) => ticket.id)).toEqual(['003']);
  });

  test.each([
    ['a non-array', { id: '003' }],
    ['null', null],
  ])('reads %s as no tickets at all', (_description, value) => {
    expect(pageTicketsFrom(value)).toEqual([]);
  });
});

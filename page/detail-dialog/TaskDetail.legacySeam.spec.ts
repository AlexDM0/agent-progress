/**
 * The detail panel reaches `page/legacy/` for id-less notes only. An entry carrying ids, whatever its sentence names, must be claimed
 * by those ids alone, so these claims hold unchanged once the legacy folder and its seam are dropped.
 */

import { expect, test } from 'bun:test';

import type { Task }               from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }         from '../../src/shared/@types/PagePayload.ts';
import type { IdentifiedLogEntry } from '../../src/shared/@types/WordedLogEntry.ts';
import { pageBoardFixture }        from '../testing/PageBoardFixture.ts';
import type { TimestampSlices }    from '../utils/TimeUtil.ts';
import { taskDetailMarkup }        from './TaskDetail.ts';

const EXAMPLE_AT = '2026-09-18T20:26:00+02:00';

const EXAMPLE_SLICES: TimestampSlices = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

const ENTRY_NAMING_OTHERS: IdentifiedLogEntry = {
  at:        EXAMPLE_AT,
  text:      'Review row #9 started: Review 1 #004 — see task #2, row #3, #001 and #002',
  taskIds:   [9],
  ticketIds: ['004'],
};

function exampleTask(id: number, ticket: string | null): Task {
  return {
    id,
    name:   'Example row',
    status: 'in-progress',
    start:  EXAMPLE_AT,
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket,
    tokens: null,
  };
}

function exampleTicket(id: string, task: number | null): PageTicket {
  return {
    id,
    title:       'Example ticket',
    type:        'change',
    status:      'in-progress',
    filed:       EXAMPLE_AT,
    updated:     EXAMPLE_AT,
    started:     EXAMPLE_AT,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}-example.md`,
    bodyHtml:    '',
  };
}

function panelClaimsTheEntry(task: Task | null, ticket: PageTicket | null): boolean {
  const markup = taskDetailMarkup({
    task:              pageBoardFixture({ tasks: task === null ? [] : [task], tickets: ticket === null ? [] : [ticket] }).rows[0] ?? null,
    ticket,
    log:               [ENTRY_NAMING_OTHERS],
    slices:            EXAMPLE_SLICES,
    todayCalendarDate: '2026-09-18',
  });
  return markup.includes(ENTRY_NAMING_OTHERS.text);
}

test('an entry carrying ids is claimed by its own row and ticket', () => {
  expect(panelClaimsTheEntry(exampleTask(9, null), null)).toBe(true);
  expect(panelClaimsTheEntry(null, exampleTicket('004', null))).toBe(true);
});

test('an entry carrying ids is never claimed by the rows and tickets its sentence merely names', () => {
  expect(panelClaimsTheEntry(exampleTask(2, '001'), exampleTicket('001', 2))).toBe(false);
  expect(panelClaimsTheEntry(exampleTask(3, '002'), exampleTicket('002', 3))).toBe(false);
});

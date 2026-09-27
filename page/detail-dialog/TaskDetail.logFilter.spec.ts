/**
 * The detail panel's log filter. An entry that carries ids is claimed only by those ids, whatever its sentence names; a note, which
 * carries none, is claimed by the rows and tickets its sentence names.
 */

import { expect, test } from 'bun:test';

import type { Task }                from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }          from '../../src/shared/@types/PagePayload.ts';
import type { IdentifiedLogEntry }  from '../../src/shared/@types/WordedLogEntry.ts';
import { pageBoardFixture }         from '../testing/PageBoardFixture.ts';
import { EXAMPLE_TIMESTAMP_SLICES } from '../testing/PageLimitsFixture.ts';
import { taskDetailMarkup }         from './TaskDetail.ts';

const EXAMPLE_AT = '2026-09-18T20:26:00+02:00';

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

const NOTE_NAMING_A_ROW: IdentifiedLogEntry = { at: EXAMPLE_AT, text: 'Task #9 waits on the API' };

function panelClaimsTheEntry(task: Task | null, ticket: PageTicket | null, entry: IdentifiedLogEntry = ENTRY_NAMING_OTHERS): boolean {
  const markup = taskDetailMarkup({
    task:              pageBoardFixture({ tasks: task === null ? [] : [task], tickets: ticket === null ? [] : [ticket] }).rows[0] ?? null,
    ticket,
    log:               [entry],
    slices:            EXAMPLE_TIMESTAMP_SLICES,
    todayCalendarDate: '2026-09-18',
  });
  return markup.includes(entry.text);
}

test('an entry carrying ids is claimed by its own row and ticket', () => {
  expect(panelClaimsTheEntry(exampleTask(9, null), null)).toBe(true);
  expect(panelClaimsTheEntry(null, exampleTicket('004', null))).toBe(true);
});

test('an entry carrying ids is never claimed by the rows and tickets its sentence merely names', () => {
  expect(panelClaimsTheEntry(exampleTask(2, '001'), exampleTicket('001', 2))).toBe(false);
  expect(panelClaimsTheEntry(exampleTask(3, '002'), exampleTicket('002', 3))).toBe(false);
});

test('a note, which carries no ids, is claimed by the row its sentence names and by no other', () => {
  expect(panelClaimsTheEntry(exampleTask(9, null), null, NOTE_NAMING_A_ROW)).toBe(true);
  expect(panelClaimsTheEntry(exampleTask(3, null), null, NOTE_NAMING_A_ROW)).toBe(false);
});

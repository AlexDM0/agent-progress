/**
 * The tracker page's detail registration table, frozen before the panel moved onto the generic controller. A wrong selector only loses the
 * selection mark and the focus return, which no other spec sees, so every opener selector, every `selectorFor('X')` and the link openers'
 * order must stay what they were. Taken at 9802bfd from `page/detail-dialog/DetailDialogController.ts`'s `OPENER_SELECTOR` parts,
 * `openerSelectorOf({ kind, id: 'X' })` and `clickedEpicOrTicketLinkOf`'s `closest` calls in order (an epic opened only through a link);
 * retake only in a commit meant to change what opens the panel, by printing the same at that commit and pasting it below.
 */

import { describe, expect, test } from 'bun:test';

import { EXAMPLE_PAGE_LIMITS }                                 from '../testing/PageLimitsFixture.ts';
import { TRACKER_DETAIL_LINK_OPENERS, trackerDetailTargetsOf } from './DetailDialogController.ts';

const FROZEN_OPENER_SELECTORS = {
  'task':        '#ap-rows > .ap-row[data-task-id]',
  'ticket':      '#ap-ticket-rows > tr[data-ticket-id]',
  'kanban-card': '#ap-kanban .ap-kanban-card',
  'epic':        null,
};

const FROZEN_SELECTORS_FOR_X = {
  'task':        '#ap-rows > .ap-row[data-task-id][data-task-id="X"]',
  'ticket':      '#ap-ticket-rows > tr[data-ticket-id][data-ticket-id="X"]',
  'kanban-card': '#ap-kanban .ap-kanban-card[data-ticket-id="X"]',
  'epic':        '#ap-epics [data-open-epic="X"]',
};

const FROZEN_LINK_OPENERS = [
  { kind: 'epic',   selector: '.ap-epic-chip[data-epic], [data-open-epic]' },
  { kind: 'ticket', selector: '[data-open-ticket]' },
];

const TARGETS = trackerDetailTargetsOf({
  rows:                  [],
  tickets:               [],
  epics:                 [],
  log:                   [],
  limits:                EXAMPLE_PAGE_LIMITS,
  readTodayCalendarDate: () => '2026-10-07',
  readKanbanCards:       () => [],
  updateKanbanOverflow:  () => undefined,
});

describe('the tracker page detail registration table, frozen', () => {
  test('every kind keeps its opener selector, in the order the openers are matched', () => {
    expect(Object.entries(TARGETS).map(([kind, registration]) => [kind, registration.openerSelector])).toEqual(Object.entries(FROZEN_OPENER_SELECTORS));
  });

  test('every kind keeps its selector for the selection mark and the focus return', () => {
    expect(Object.fromEntries(Object.entries(TARGETS).map(([kind, registration]) => [kind, registration.selectorFor('X')]))).toEqual(FROZEN_SELECTORS_FOR_X);
  });

  test('an epic link is checked before a ticket link', () => {
    expect(TRACKER_DETAIL_LINK_OPENERS.map(({ kind, selector }): { kind: string; selector: string } => ({ kind, selector }))).toEqual(FROZEN_LINK_OPENERS);
  });

  test('an id the board does not hold has nothing to open', () => {
    expect(Object.values(TARGETS).map((registration) => registration.markupOf('404'))).toEqual(['', '', '', '']);
  });
});

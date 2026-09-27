/** The row and card ids are what a link's fragment and a shared URL point at, so each format must stay what the page has always written. */

import { describe, expect, test } from 'bun:test';
import { TemplateIdUtil }         from './TemplateIdUtil.ts';

describe('the row and card ids', () => {
  test('name a task row, a ticket card and a Kanban card by their id', () => {
    expect(TemplateIdUtil.taskRowElementIdOf(12)).toBe('ap-task-12');
    expect(TemplateIdUtil.ticketCardElementIdOf('003')).toBe('ap-ticket-003');
    expect(TemplateIdUtil.kanbanCardElementIdOf('003')).toBe('ap-kanban-003');
  });
});

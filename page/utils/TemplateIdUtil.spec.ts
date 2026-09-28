/** The row, card and ticket ids are what a link's fragment and a shared URL point at, so each format must stay what the page has always written. */

import { describe, expect, test } from 'bun:test';
import { TemplateIdUtil }         from './TemplateIdUtil.ts';

describe('the row, card and ticket ids', () => {
  test('name a task row, a ticket and a Kanban card by their id', () => {
    expect(TemplateIdUtil.taskRowElementIdOf(12)).toBe('ap-task-12');
    expect(TemplateIdUtil.ticketFragmentIdOf('003')).toBe('ap-ticket-003');
    expect(TemplateIdUtil.kanbanCardElementIdOf('003')).toBe('ap-kanban-003');
  });

  test('reads the ticket id back from a ticket fragment, and nothing from any other', () => {
    expect(TemplateIdUtil.ticketIdOfFragment('ap-ticket-060')).toBe('060');
    expect(TemplateIdUtil.ticketIdOfFragment('ap-ticket-')).toBeNull();
    expect(TemplateIdUtil.ticketIdOfFragment('ap-task-60')).toBeNull();
    expect(TemplateIdUtil.ticketIdOfFragment('tickets')).toBeNull();
  });
});

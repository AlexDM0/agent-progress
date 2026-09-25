/**
 * Which open dependencies each ticket waits on. The case that matters is a closed ticket, whose list is history and never shows as waiting.
 */

import { describe, expect, test } from 'bun:test';
import { IslandUtil }             from './IslandUtil.ts';
import { WaitingOnUtil }          from './WaitingOnUtil.ts';

const { waitingOnByTicketId } = WaitingOnUtil;
const { pageTicketsFrom }     = IslandUtil;

describe('waitingOnByTicketId', () => {
  function ticketsFrom(entries: Array<{ id: string; status: string; dependsOn?: string[] }>): ReturnType<typeof pageTicketsFrom> {
    return pageTicketsFrom(entries.map((entry) => ({ title: `Ticket ${entry.id}`, bodyHtml: '', ...entry })));
  }

  test('maps a ticket to the dependencies that are not reviewed or delivered yet', () => {
    const tickets = ticketsFrom([
      { id: '001', status: 'reviewed' },
      { id: '002', status: 'in-progress' },
      { id: '003', status: 'pending', dependsOn: ['001', '002'] },
    ]);

    expect(waitingOnByTicketId(tickets)).toEqual(new Map([['003', ['002']]]));
  });

  // A closed ticket's list is history; showing it as waiting would suggest work that is not coming.
  test('leaves out tickets that are closed and tickets whose dependencies are all settled', () => {
    const tickets = ticketsFrom([
      { id: '001', status: 'pending' },
      { id: '002', status: 'reviewed', dependsOn: ['001'] },
      { id: '003', status: 'abandoned', dependsOn: ['001'] },
      { id: '004', status: 'pending' },
    ]);

    expect(waitingOnByTicketId(tickets).size).toBe(0);
  });
});

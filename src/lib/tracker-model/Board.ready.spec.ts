/**
 * `readyDraftTickets` is the one way out of `draft` but abandoning: every named draft becomes `pending` with a row at every priority and
 * logs `ticket-readied`, or nothing changes. A ticket not in `draft` is refused before the body is read, and an incomplete body is
 * refused for every ticket at once. Refusals are asserted by reason code, never by wording.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { ReadinessGap }                            from './@types/Ticket.ts';
import { TICKET_STATUSES }                              from './constants/Statuses.ts';

const READIED_AT = '2026-09-18T10:00:00+02:00';

const COMPLETE_BODY   = 'complete';
const NO_GAPS         = (): readonly ReadinessGap[] => [];
const GAPS_BY_BODY    = (body: string): readonly ReadinessGap[] => (body === COMPLETE_BODY ? [] : ['acceptance-unnumbered', 'brief-missing']);

describe('readyDraftTickets', () => {
  test('every named draft, at every priority, becomes pending with a pending row and logs ticket-readied', () => {
    const { board, progress, records } = boardFixture({
      tickets: [
        ticketFixture({
          id: '001', status: 'draft', priority: 'low', title: 'Example basket badge'
        }),
        ticketFixture({ id: '002', status: 'draft', priority: 'high' }),
      ],
    });
    const readied = board.readyDraftTickets(['001', '002', '001'], NO_GAPS, READIED_AT);

    expect(readied.tickets.map((ticket) => [ticket.frontmatter.status, ticket.frontmatter.updated])).toEqual([
      ['pending', READIED_AT],
      ['pending', READIED_AT],
    ]);
    expect(progress.tasks.map((task) => [task.name, task.status, task.ticket])).toEqual([
      ['#001 Example basket badge', 'pending', '001'],
      ['#002 Example checkout page', 'pending', '002'],
    ]);
    expect(readied.tickets.map((ticket) => ticket.frontmatter.task)).toEqual(progress.tasks.map((task) => task.id));
    expect(records.map((record) => [record.kind, 'ticketId' in record ? record.ticketId : null])).toEqual([
      ['ticket-readied', '001'],
      ['ticket-readied', '002'],
    ]);
  });

  test('a ticket in any status but draft is refused naming its status, and the drafts named beside it stay drafts', () => {
    for (const status of TICKET_STATUSES.filter((candidate) => candidate !== 'draft')) {
      const {
        board, progress, records, tickets
      } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'draft' }), ticketFixture({ id: '002', status })], });

      expect(refusalDetailOf(() => board.readyDraftTickets(['001', '002'], NO_GAPS, READIED_AT)), status)
        .toEqual({ reason: 'ready-of-a-ticket-not-in-draft', ticketId: '002', status });
      expect(tickets[0]?.frontmatter.status).toBe('draft');
      expect(progress.tasks).toEqual([]);
      expect(records).toEqual([]);
    }
  });

  test('every incomplete ticket is named with its gaps, and nothing is readied, not even the complete one', () => {
    const complete = ticketFixture({ id: '001', status: 'draft' });
    complete.body  = COMPLETE_BODY;
    const {
      board, progress, records, tickets
    } = boardFixture({ tickets: [complete, ticketFixture({ id: '002', status: 'draft' }), ticketFixture({ id: '003', status: 'draft' })], });

    expect(refusalDetailOf(() => board.readyDraftTickets(['001', '002', '003'], GAPS_BY_BODY, READIED_AT))).toEqual({
      reason:            'incomplete-tickets',
      incompleteTickets: [
        { ticketId: '002', gaps: ['acceptance-unnumbered', 'brief-missing'] },
        { ticketId: '003', gaps: ['acceptance-unnumbered', 'brief-missing'] },
      ],
    });
    expect(tickets.map((ticket) => ticket.frontmatter.status)).toEqual(['draft', 'draft', 'draft']);
    expect(progress.tasks).toEqual([]);
    expect(records).toEqual([]);
  });
});

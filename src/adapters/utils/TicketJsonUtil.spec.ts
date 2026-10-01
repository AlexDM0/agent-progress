/**
 * The ticket document `status --json` and the ticket commands print: a script reads the priority and the epics without knowing what an absent
 * key means, so an absent priority is spelled out as normal and absent epics as an empty list, while written ones are kept, and the keys
 * keep their printed order, the frontmatter's, then priority, then epics, then filePath.
 */
import { expect, test } from 'bun:test';

import { ticketFixture }  from '../../testing/BoardFixtures.ts';
import { TicketJsonUtil } from './TicketJsonUtil.ts';

const { ticketDocumentOf } = TicketJsonUtil;

test('a ticket filed without a priority reads normal', () => {
  expect(ticketDocumentOf(ticketFixture()).priority).toBe('normal');
});

test('a written priority is kept as written', () => {
  expect(ticketDocumentOf(ticketFixture({ priority: 'low' })).priority).toBe('low');
  expect(ticketDocumentOf(ticketFixture({ priority: 'high' })).priority).toBe('high');
});

test('a ticket in no epic reads an empty list, and a written list keeps its order, the primary epic first', () => {
  expect(ticketDocumentOf(ticketFixture()).epics).toEqual([]);
  expect(ticketDocumentOf(ticketFixture({ epics: ['loyalty-programme', 'checkout-redesign'] })).epics).toEqual(['loyalty-programme', 'checkout-redesign']);
});

test('the keys are the frontmatter\'s in order, then priority, then epics, then filePath', () => {
  const ticket = ticketFixture();

  expect(Object.keys(ticketDocumentOf(ticket))).toEqual([...Object.keys(ticket.frontmatter), 'priority', 'epics', 'filePath']);
  expect(ticketDocumentOf(ticket).filePath).toBe(ticket.filePath);
});

test('a stored priority and stored epics keep their places among the frontmatter keys rather than moving to the end', () => {
  const ticket = ticketFixture({ priority: 'high', epics: ['checkout-redesign'] });

  expect(Object.keys(ticketDocumentOf(ticket))).toEqual([...Object.keys(ticket.frontmatter), 'filePath']);
});

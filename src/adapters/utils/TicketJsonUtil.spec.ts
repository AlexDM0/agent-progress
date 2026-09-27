/**
 * The ticket document `status --json` and the ticket commands print: a script reads the priority without knowing the default, so an absent
 * one is spelled out as normal while a written one is kept, and the keys keep their printed order, the frontmatter's, then priority, then filePath.
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

test('the keys are the frontmatter\'s in order, then priority, then filePath', () => {
  const ticket = ticketFixture();

  expect(Object.keys(ticketDocumentOf(ticket))).toEqual([...Object.keys(ticket.frontmatter), 'priority', 'filePath']);
  expect(ticketDocumentOf(ticket).filePath).toBe(ticket.filePath);
});

test('a stored priority keeps its place among the frontmatter keys rather than moving to the end', () => {
  const ticket = ticketFixture({ priority: 'high' });

  expect(Object.keys(ticketDocumentOf(ticket))).toEqual([...Object.keys(ticket.frontmatter), 'filePath']);
});

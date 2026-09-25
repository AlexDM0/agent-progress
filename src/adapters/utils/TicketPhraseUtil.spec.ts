/**
 * These phrases appear inside refusals, warnings and log sentences alike, so what callers rely on is the agreement: one ticket reads in
 * the singular and several in the plural, and every id keeps the stored, padded form behind its `#`.
 */
import { expect, test } from 'bun:test';

import { TicketPhraseUtil } from './TicketPhraseUtil';

const {
  agentPairText,
  lowPriorityHeldBackText,
  namedTicketsText,
  ticketReferencesText,
  waitingOnText,
} = TicketPhraseUtil;

test('ticket ids are listed as written, each behind a hash, separated by commas', () => {
  expect(ticketReferencesText(['004', '005'])).toBe('#004, #005');
  expect(ticketReferencesText(['004'])).toBe('#004');
});

test('the waiting phrase lists every ticket waited on', () => {
  expect(waitingOnText(['004', '005'])).toBe('waiting on #004, #005');
});

test('one ticket is named in the singular and several in the plural', () => {
  expect(namedTicketsText(['003'])).toBe('Ticket #003');
  expect(namedTicketsText(['003', '004'])).toBe('Tickets #003, #004');
});

test('a low ticket held back by one ticket takes "is", and by several takes "are"', () => {
  expect(lowPriorityHeldBackText('002', ['001'])).toBe('Ticket #002 is low priority, and #001 is normal or high and not delivered or abandoned yet');
  expect(lowPriorityHeldBackText('002', ['001', '003'])).toBe('Ticket #002 is low priority, and #001, #003 are normal or high and not delivered or abandoned yet');
});

test('an agent pair reads as model then effort, joined by a slash', () => {
  expect(agentPairText({ model: 'sonnet', effort: 'high' })).toBe('sonnet/high');
});

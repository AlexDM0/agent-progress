/**
 * What a ticket's absent optional fields read as. What callers rely on: one default for every reader, and a field that is
 * present is returned as written rather than overridden.
 */
import { expect, test } from 'bun:test';

import { TicketDefaultsUtil } from './TicketDefaultsUtil';

const { agentEffortOf, agentModelOf, ticketPriorityOf } = TicketDefaultsUtil;

// A ticket file written before priorities existed carries no key, and must read as the middle priority rather than as the lowest.
test('an absent priority reads as normal, and a present one is returned as written', () => {
  expect(ticketPriorityOf({})).toBe('normal');
  expect(ticketPriorityOf({ priority: 'low' })).toBe('low');
});

test('an absent model and effort read as opus and medium, and a present one is returned as written', () => {
  expect(agentModelOf({})).toBe('opus');
  expect(agentEffortOf({})).toBe('medium');
  expect(agentModelOf({ model: 'sonnet' })).toBe('sonnet');
  expect(agentEffortOf({ effort: 'xhigh' })).toBe('xhigh');
});

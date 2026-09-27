/**
 * What the ticket subcommands print for a ticket under `--json`: the ticket document with the body appended last, so a script reading keys
 * in order meets the frontmatter first.
 */
import { describe, expect, test } from 'bun:test';

import { TicketJsonUtil }   from '../../../src/adapters/utils/TicketJsonUtil.ts';
import { ticketFixture }    from '../../../src/testing/BoardFixtures.ts';
import { TicketOutputUtil } from './TicketOutputUtil.ts';

const { ticketAsJson } = TicketOutputUtil;

describe('TicketOutputUtil.ticketAsJson', () => {
  test('is the ticket document with the body appended as the last key', () => {
    const ticket   = { ...ticketFixture({ id: '003', priority: 'high' }), body: '## Example\n\nThe body.\n' };
    const document = ticketAsJson(ticket);

    expect(document).toEqual({ ...TicketJsonUtil.ticketDocumentOf(ticket), body: '## Example\n\nThe body.\n' });
    expect(Object.keys(document).at(-1)).toBe('body');
    expect(Object.keys(document).at(-2)).toBe('filePath');
  });
});

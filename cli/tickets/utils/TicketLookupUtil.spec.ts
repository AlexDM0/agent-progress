/**
 * How the ticket command turns a reference into a ticket inside a write: `3`, `003` and `#3` name one ticket. A reference with no ticket is
 * the caller's to fix (refused, exit 1), while a file of that id that will not parse is a hand edit the tool will not repair (unrepaired,
 * exit 2, naming the file). The refused text is frozen from `cli/ticket/TicketCommand.ts` at 6284cab; retake it with `git show`.
 */
import { describe, expect, test } from 'bun:test';

import type { MalformedTicketFile }                         from '../../../src/services/tracker/TicketStore.ts';
import { refusalIsOperationRefusal, type OperationRefusal } from '../../../src/shared/OperationRefusal.ts';
import { boardFixture, ticketFixture }                      from '../../../src/testing/BoardFixtures.ts';
import { TicketLookupUtil }                                 from './TicketLookupUtil.ts';

const { requireTicket, refuseAMissingTicket } = TicketLookupUtil;

const MALFORMED_THIRD_TICKET: MalformedTicketFile = {
  filePath: '/example-agency/storefront/.agent-progress/tickets/004-broken.md',
  reason:   'the frontmatter has no closing fence',
  line:     1,
};

function refusalFrom(action: () => unknown): OperationRefusal {
  try {
    action();
  } catch (error) {
    if (refusalIsOperationRefusal(error)) return error;
    throw error;
  }
  throw new Error('the call was expected to refuse and it returned instead');
}

describe('TicketLookupUtil.requireTicket', () => {
  test('3, 003 and #3 resolve to the one ticket 003', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '003', title: 'Example basket page' })] });

    for (const reference of ['3', '003', '#3']) {
      expect(requireTicket({ board, malformedTickets: [] }, reference).frontmatter.title, reference).toBe('Example basket page');
    }
  });

  test('a reference with no ticket and no broken file is refused, pointing at ticket list', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });

    const refusal = refusalFrom(() => requireTicket({ board, malformedTickets: [MALFORMED_THIRD_TICKET] }, '2'));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe(
      'There is no readable ticket 2. Run `agent-progress ticket list` to see what this tracker holds; a file that will not parse is reported there as malformed.',
    );
  });

  test('a reference whose file will not parse is unrepaired, naming the file, its line and why', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });

    const refusal = refusalFrom(() => requireTicket({ board, malformedTickets: [MALFORMED_THIRD_TICKET] }, '#4'));

    expect(refusal.status).toBe('unrepaired');
    expect(refusal.message).toBe(
      'Ticket file ignored: /example-agency/storefront/.agent-progress/tickets/004-broken.md (line 1): the frontmatter has no closing fence',
    );
  });
});

describe('TicketLookupUtil.refuseAMissingTicket', () => {
  test('a reference that is not an id at all is refused as missing, never matched to a broken file', () => {
    const refusal = refusalFrom(() => refuseAMissingTicket('broken', [MALFORMED_THIRD_TICKET]));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toStartWith('There is no readable ticket broken.');
  });

  test('a broken file named by its bare padded id is matched as well as one with a slug', () => {
    const bareFile: MalformedTicketFile = { filePath: '/example-agency/storefront/.agent-progress/tickets/004.md', reason: 'unreadable', line: 0 };

    const refusal = refusalFrom(() => refuseAMissingTicket('004', [bareFile]));

    expect(refusal.status).toBe('unrepaired');
    expect(refusal.message).toBe('Ticket file ignored: /example-agency/storefront/.agent-progress/tickets/004.md: unreadable');
  });
});

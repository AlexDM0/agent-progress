/**
 * The control contract as data: one example of every kind, typed so a new kind needs one, survives JSON unchanged, which a relay file and an
 * HTTP body depend on; and a ticket reference the hold cannot resolve leaves the service as a wordless detail, refused when nothing is
 * there and unrepaired when a file of that id will not parse, worded only by the adapter's refusal-wording util.
 */
import { describe, expect, test } from 'bun:test';

import { OperationRefusalWordingUtil }               from '../../adapters/utils/OperationRefusalWordingUtil.ts';
import type { ControlCommandKind, ControlCommandOf } from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }                          from '../../shared/OperationRefusal.ts';
import { boardFixture, ticketFixture }               from '../../testing/BoardFixtures.ts';
import { CONTROL_COMMAND_KINDS }                     from './ControlService.ts';
import { ticketIdOfReference }                       from './ControlTicketLookup.ts';

const EXAMPLE_OF_KIND: { readonly [Kind in ControlCommandKind]: ControlCommandOf<Kind> } = {
  'ticket-add': {
    kind:          'ticket-add',
    title:         'Example basket page',
    type:          'bug',
    priority:      'high',
    size:          'S',
    model:         'opus',
    effort:        'medium',
    group:         'storefront',
    dependsOn:     ['001'],
    epics:         ['checkout-redesign'],
    network:       ['example.com'],
    introducedBy:  '001',
    foundInReview: null,
    bodyText:      '## Report\nAlex Example saw the basket empty itself.\n',
  },
  'ticket-edit': {
    kind: 'ticket-edit', ticketReference: '#3', title: 'Example title', bodyText: null, appendsBody: false, allowsPastPending: true
  },
  'ticket-depends': {
    kind: 'ticket-depends', ticketReference: '3', edit: 'add', ticketIds: ['001', '002']
  },
  'ticket-priority': { kind: 'ticket-priority', ticketReference: '3', priority: 'low' },
  'ticket-epic':     {
    kind: 'ticket-epic', ticketReference: '3', edit: 'replace', epicKeys: []
  },
  'ticket-abandon': {
    kind: 'ticket-abandon', ticketReference: '3', reason: 'Example Agency dropped it', tokens: 1200
  },
  'ticket-ready':   { kind: 'ticket-ready', ticketReferences: ['3', '#4'] },
  'ticket-network': { kind: 'ticket-network', ticketReference: '3', domains: [] },
  'ticket-hold':    { kind: 'ticket-hold', ticketReference: '3', reason: '' },
  'ticket-unhold':  { kind: 'ticket-unhold', ticketReference: '3' },
  'epic-add':       {
    kind: 'epic-add', key: 'checkout-redesign', title: 'Checkout redesign', bodyText: ''
  },
  'draft-open': {
    kind: 'draft-open', title: 'Example intake', request: 'Alex Example asks for a basket.\n', owner: 'opus'
  },
  'draft-claim': {
    kind: 'draft-claim', draftId: 'D1', owner: 'opus', forces: false
  },
  'draft-release': { kind: 'draft-release', draftId: 'D1' },
  'draft-note':    {
    kind: 'draft-note', draftId: 'D1', text: 'The basket is a page.', noteKind: 'assumption'
  },
  'draft-ask': {
    kind:    'draft-ask',
    draftId: 'D1',
    asking:  {
      question: 'Which page?', context: 'Two exist.', optionTexts: ['Basket', 'Checkout'], multiple: false, recommendedLetters: ['a'], underQuestionId: null
    },
  },
  'draft-answer': {
    kind: 'draft-answer', draftId: 'D1', questionId: 'Q1', answer: 'a'
  },
  'draft-drop':          { kind: 'draft-drop', draftId: 'D1', itemId: 'N1' },
  'draft-close':         { kind: 'draft-close', draftId: 'D1', ticketReferences: ['3'] },
  'draft-abandon':       { kind: 'draft-abandon', draftId: 'D1', reason: 'Filed elsewhere' },
  'runner-pause':        { kind: 'runner-pause' },
  'runner-resume':       { kind: 'runner-resume' },
  'runner-stop':         { kind: 'runner-stop', now: true },
  'runner-restart':      { kind: 'runner-restart', now: false },
  'concurrency-set':     { kind: 'concurrency-set', limit: 3 },
  'checks-set':          { kind: 'checks-set', command: null, restamps: true },
  'install-command-set': { kind: 'install-command-set', command: 'bun install' },
};

function refusalOf(attempt: () => unknown): OperationRefusal {
  try {
    attempt();
  } catch (error) {
    if (error instanceof OperationRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('ControlCommand', () => {
  test('the examples cover every kind the service applies', () => {
    expect(Object.keys(EXAMPLE_OF_KIND).sort()).toEqual([...CONTROL_COMMAND_KINDS].sort());
  });

  test('every command is JSON and comes back from a round trip unchanged', () => {
    for (const command of Object.values(EXAMPLE_OF_KIND)) {
      expect(JSON.parse(JSON.stringify(command)), command.kind).toEqual(command);
    }
  });
});

describe('ticketIdOfReference', () => {
  const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '003' })] });
  const malformedTickets = [{ filePath: '/example-agency/.agent-progress/tickets/004-broken.md', reason: 'the frontmatter has no closing fence', line: 1 }];

  test('3, 003 and #3 resolve to ticket 003', () => {
    for (const reference of ['3', '003', '#3']) expect(ticketIdOfReference({ board, malformedTickets }, reference), reference).toBe('003');
  });

  test('a reference with nothing there is refused with a wordless detail the adapter words', () => {
    const refusal = refusalOf(() => ticketIdOfReference({ board, malformedTickets }, '2'));

    expect(refusal.status).toBe('refused');
    expect(refusal.detail).toEqual({ kind: 'no-readable-ticket', reference: '2' });
    expect(OperationRefusalWordingUtil.messageOf(refusal)).toStartWith('There is no readable ticket 2.');
  });

  test('a reference whose file will not parse is unrepaired, naming the file, its line and why', () => {
    const refusal = refusalOf(() => ticketIdOfReference({ board, malformedTickets }, '#4'));

    expect(refusal.status).toBe('unrepaired');
    expect(OperationRefusalWordingUtil.messageOf(refusal)).toBe(
      'Ticket file ignored: /example-agency/.agent-progress/tickets/004-broken.md (line 1): the frontmatter has no closing fence',
    );
  });
});

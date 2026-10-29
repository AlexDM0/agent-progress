/**
 * The detail panel model. What matters: log lines are claimed by their `taskIds` or `ticketIds` alone, a note by its sentence, newest first
 * with a backfilled line in its place; every stamp is sliced and shortened through `TimeUtil` against the viewer's day, never re-parsed, so
 * a stamp from another zone shows the wall clock it was written in; the controls follow the stored status (network only while `draft` or
 * `pending`); and the body document escapes nothing of the body and only the title by hand.
 */
import { describe, expect, test } from 'bun:test';

import { exampleTicketsBoard, exampleTicketsTicket } from '../../testing/TicketsBoardFixture.ts';
import { DetailPanelModel }                          from './DetailPanelModel.ts';

const TODAY = '2026-09-18';

const BOARD = exampleTicketsBoard({
  tickets: [
    exampleTicketsTicket('012', {
      status:   'in-review',
      started:  '2026-09-18T10:15:00-05:00',
      finished: '2026-09-18T23:30:00-05:00',
      filed:    '2025-12-31T23:48:00+01:00',
      hold:     '',
      branch:   'ticket-012',
      task:     9,
      epics:    ['checkout'],
      network:  ['registry.example.com'],
    }),
    exampleTicketsTicket('013', { status: 'draft' }),
    exampleTicketsTicket('014', { status: 'delivered', delivered: '2026-09-17T08:00:00+02:00' }),
  ],
  waitingOn:     { '012': ['003'] },
  displayStates: { '012': 're-review' },
  ownRows:       {
    '012': {
      id:      9,
      status:  're-review',
      note:    '',
      history: [
        { status: 'pending', at: '2026-09-17T09:00:00+02:00' },
        { status: 'in-progress', at: '2026-09-18T10:15:00+02:00' },
        { status: 'in-review', at: '2026-09-18T11:00:00+02:00' },
        { status: 're-review', at: '2026-09-18T12:00:00+02:00' },
      ],
    },
  },
  log: [
    {
      at: '2026-09-18T09:00:00+02:00', text: 'Ticket #012 started', taskIds: [9], ticketIds: ['012']
    },
    {
      at: '2026-09-18T09:30:00+02:00', text: 'Ticket #013 waits on #012', taskIds: [], ticketIds: ['013']
    },
    { at: '2026-09-18T10:00:00+02:00', text: 'Note naming task #9 by its sentence' },
    { at: '2026-09-18T10:00:00+02:00', text: 'Note naming ticket #0120 alone' },
    {
      at: '2026-09-17T08:00:00+02:00', text: 'Backfilled line about the row', taskIds: [9], ticketIds: []
    },
  ],
});

function modelOf(ticketId: string) {
  const model = DetailPanelModel.detailPanelModelOf(BOARD, ticketId, TODAY);
  if (model === null) throw new Error(`no model for ${ticketId}`);
  return model;
}

describe('the log', () => {
  test('claims a line by its ids or, for a note, its sentence, never by a number an id-carrying line names, newest first', () => {
    expect(modelOf('012').logLines.map((line) => line.text)).toEqual([
      'Note naming task #9 by its sentence',
      'Ticket #012 started',
      'Backfilled line about the row',
    ]);
  });

  test('a ticket no line names has an empty log', () => {
    expect(modelOf('014').logLines).toEqual([]);
  });
});

describe('the stamps', () => {
  test('are sliced as written and shortened against the viewer\'s day, the full stamp kept for the hover', () => {
    const stamps = Object.fromEntries(modelOf('012').facts.flatMap((fact) => (fact.kind === 'stamp' ? [[fact.label, [fact.stamp.shortText, fact.stamp.fullText]]] : [])));
    expect(stamps).toEqual({
      filed:    ['2025-12-31 23:48', '2025-12-31 23:48'],
      started:  ['10:15', '2026-09-18 10:15'],
      finished: ['23:30', '2026-09-18 23:30'],
    });
    expect(modelOf('014').facts.find((fact) => fact.label === 'done')).toEqual({ kind: 'stamp', label: 'done', stamp: { shortText: '09-17 08:00', fullText: '2026-09-17 08:00' } });
  });

  test('the phases its own row recorded each carry their state, a repeat review its round', () => {
    expect(modelOf('012').phases.map((phase) => [phase.label, phase.stamp.shortText])).toEqual([
      ['To do', '09-17 09:00'],
      ['In progress', '10:15'],
      ['Awaiting review', '11:00'],
      ['Reviewing (round 2)', '12:00'],
    ]);
  });
});

describe('the facts', () => {
  test('carry the epics, a hold without reason, what it waits on, its branch, task and network', () => {
    const facts = modelOf('012').facts.filter((fact) => fact.kind !== 'stamp');
    expect(facts).toEqual([
      { kind: 'epics', label: 'epics', epics: [{ key: 'checkout', title: 'Example checkout', slot: 2 }] },
      { kind: 'text', label: 'held', text: 'no reason given' },
      { kind: 'tickets', label: 'waiting on', ticketIds: ['003'] },
      { kind: 'text', label: 'branch', text: 'ticket-012' },
      { kind: 'text', label: 'task', text: '#9' },
      { kind: 'text', label: 'network', text: 'registry.example.com' },
    ]);
  });

  test('the head takes the Board\'s display state', () => {
    expect([modelOf('012').stateToken, modelOf('012').stateLabel]).toEqual(['re-review', 'Reviewing (round 2)']);
  });
});

describe('the controls', () => {
  test('a draft offers Ready, Hold, Park and network', () => {
    expect(modelOf('013').controls).toEqual({
      readies: true, holdMove: 'hold', parks: true, setsNetwork: true, network: []
    });
  });

  test('a held ticket under review offers Unhold and Park, and no network', () => {
    expect(modelOf('012').controls).toEqual({
      readies: false, holdMove: 'unhold', parks: true, setsNetwork: false, network: ['registry.example.com']
    });
  });

  test('a closed ticket offers nothing', () => {
    expect(modelOf('014').controls).toEqual({
      readies: false, holdMove: null, parks: false, setsNetwork: false, network: []
    });
  });

  test('typed domains split at commas and white space', () => {
    expect(DetailPanelModel.networkDomainsOf(' a.example.com,b.example.com  c.example.com ')).toEqual(['a.example.com', 'b.example.com', 'c.example.com']);
  });
});

describe('the body document', () => {
  test('carries the body as rendered and the title escaped, links opening outside the frame', () => {
    const sourceDocument = DetailPanelModel.bodySourceDocumentOf('<script>x</script> & co', '<p>Body &amp; <em>text</em></p>');
    expect(sourceDocument).toContain('<title>&lt;script&gt;x&lt;/script&gt; &amp; co</title>');
    expect(sourceDocument).toContain('<base target="_blank">');
    expect(sourceDocument).toContain('<body><p>Body &amp; <em>text</em></p></body>');
  });

  test('an unknown ticket has no panel', () => {
    expect(DetailPanelModel.detailPanelModelOf(BOARD, '999', TODAY)).toBeNull();
  });
});

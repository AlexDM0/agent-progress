/**
 * The detail panel in a happy-dom document, against a fake command client. What matters: the body reaches the DOM only as the `srcdoc` of
 * a frame whose `sandbox` is exactly the design's, and a planted payload (an `onerror` image, a script, a `javascript:` link) in it runs
 * nothing and never reaches the panel's own document; the log shows only the lines claimed for the ticket, stamps short with the full stamp
 * on hover; Ready, Hold, Park and network each post their `ControlCommand`, network only while `draft` or `pending`; a refusal shows
 * verbatim; and every control is disabled while the stream is down.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { TicketsBoardState }                    from '../../@types/TicketsBoardState.ts';
import { ControlSurroundingsContext }                from '../../shell/ControlAvailability.ts';
import type { ControlAvailability }                  from '../../shell/ControlAvailability.ts';
import { fakeControlSurroundingsOf }                 from '../../testing/FakeControlSurroundings.ts';
import { exampleTicketsBoard, exampleTicketsTicket } from '../../testing/TicketsBoardFixture.ts';
import { DetailPanel }                               from './DetailPanel.tsx';
import { TICKET_BODY_SANDBOX }                       from './TicketBodyFrame.tsx';

const PLANTED_BODY = [
  '<p>Example body</p>',
  '<img src=x onerror="window.parent.plantedRan = true">',
  '<script>window.parent.plantedRan = true</script>',
  '<a href="javascript:window.parent.plantedRan = true">a planted link</a>',
].join('');

const BOARD = exampleTicketsBoard({
  tickets: [
    exampleTicketsTicket('013', { status: 'draft', bodyHtml: PLANTED_BODY, title: '<b>Planted title</b>' }),
    exampleTicketsTicket('014', { status: 'in-progress', started: '2026-09-18T10:15:00+02:00' }),
    exampleTicketsTicket('015', { status: 'pending', hold: 'waiting on the example vendor' }),
  ],
  log: [
    {
      at: '2026-09-18T09:00:00+02:00', text: 'Ticket #014 started', taskIds: [], ticketIds: ['014']
    },
    {
      at: '2026-09-18T09:30:00+02:00', text: 'Ticket #013 waits on #014', taskIds: [], ticketIds: ['013']
    },
  ],
});

interface RenderedPanel {
  readonly sent:       ReturnType<typeof fakeControlSurroundingsOf>['sent'];
  readonly answerWith: ReturnType<typeof fakeControlSurroundingsOf>['answerWith'];
}

function renderPanel(ticketId: string, availability: ControlAvailability = 'enabled', boardState: TicketsBoardState = BOARD): RenderedPanel {
  const fake = fakeControlSurroundingsOf(availability);
  render(
    <ControlSurroundingsContext.Provider value={fake.surroundings}>
      <DetailPanel boardState={boardState} ticketId={ticketId} todayCalendarDate="2026-09-18" tab="tickets" />
    </ControlSurroundingsContext.Provider>,
  );
  return { sent: fake.sent, answerWith: fake.answerWith };
}

async function clicked(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

function typedInto(label: string, text: string): void {
  act(() => {
    fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: text } });
  });
}

afterEach(() => {
  cleanup();
});

describe('the body', () => {
  test('reaches the DOM only as the srcdoc of a frame sandboxed exactly as designed', () => {
    renderPanel('013');
    const frame = document.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    expect(TICKET_BODY_SANDBOX).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    expect(frame?.getAttribute('srcdoc')).toContain(PLANTED_BODY);
    expect(frame?.getAttribute('srcdoc')).toContain('<title>&lt;b&gt;Planted title&lt;/b&gt;</title>');
  });

  test('a planted payload in the body runs nothing and never reaches the panel\'s own document', async () => {
    renderPanel('013');
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });
    const panel = screen.getByRole('complementary');
    expect(panel.querySelector('img, script, a[href^="javascript:"]')).toBeNull();
    expect(panel.textContent).not.toContain('a planted link');
    expect((window as unknown as { plantedRan?: boolean }).plantedRan).toBeUndefined();
  });

  test('a planted title shows as text in the head', () => {
    renderPanel('013');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('<b>Planted title</b>');
    expect(document.querySelector('.bridge-detail-head b')).toBeNull();
  });
});

describe('the log and the stamps', () => {
  test('shows only the lines claimed for the ticket, each stamp short with the full stamp on hover', () => {
    renderPanel('014');
    const log = within(screen.getByRole('region', { name: 'Log' }));
    expect(log.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['09:00Ticket #014 started']);
    expect(log.getByText('09:00').getAttribute('title')).toBe('2026-09-18 09:00');
    expect(screen.getByText('10:15').getAttribute('title')).toBe('2026-09-18 10:15');
  });

  test('a ticket no line claims says so', () => {
    renderPanel('015');
    expect(within(screen.getByRole('region', { name: 'Log' })).getByText('No log line names this ticket or its row.')).toBeTruthy();
  });
});

describe('the controls', () => {
  test('a draft posts ticket-ready, ticket-hold and ticket-park with the typed reason, and ticket-network with the typed domains', async () => {
    const panel = renderPanel('013');
    await clicked(screen.getByRole('button', { name: 'Ready' }));
    typedInto('Reason', 'waiting on the example vendor');
    await clicked(screen.getByRole('button', { name: 'Hold' }));
    await clicked(screen.getByRole('button', { name: 'Park' }));
    typedInto('Network domains', 'registry.example.com, api.example.com');
    await clicked(screen.getByRole('button', { name: 'Set network' }));
    expect(panel.sent).toEqual([
      { kind: 'ticket-ready', ticketReferences: ['013'] },
      { kind: 'ticket-hold', ticketReference: '013', reason: 'waiting on the example vendor' },
      { kind: 'ticket-park', ticketReference: '013', reason: 'waiting on the example vendor' },
      { kind: 'ticket-network', ticketReference: '013', domains: ['registry.example.com', 'api.example.com'] },
    ]);
  });

  test('a held pending ticket offers Unhold and network; a ticket being built offers only Park', async () => {
    const held = renderPanel('015');
    await clicked(screen.getByRole('button', { name: 'Unhold' }));
    expect(held.sent).toEqual([{ kind: 'ticket-unhold', ticketReference: '015' }]);
    expect(screen.getByRole('button', { name: 'Set network' })).toBeTruthy();
    cleanup();
    renderPanel('014');
    const controls = within(screen.getByRole('group', { name: 'Ticket controls' }));
    expect(controls.getAllByRole('button').map((button) => button.textContent)).toEqual(['Park']);
  });

  test('a refusal shows verbatim beside the control that drew it', async () => {
    const panel = renderPanel('013');
    panel.answerWith({ verdict: 'refused', refusal: 'Ticket 013 has no Brief: it cannot be readied.' });
    await clicked(screen.getByRole('button', { name: 'Ready' }));
    const ready = screen.getByRole('button', { name: 'Ready' }).closest('.bridge-control') as HTMLElement;
    expect(within(ready).getByRole('status').textContent).toBe('Ticket 013 has no Brief: it cannot be readied.');
  });

  test('every control is disabled while the stream is down', () => {
    renderPanel('013', 'stream-down');
    const buttons = within(screen.getByRole('group', { name: 'Ticket controls' })).getAllByRole<HTMLButtonElement>('button');
    expect(buttons.length).toBe(4);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});

test('an id the board does not hold says so and offers the way back', () => {
  renderPanel('999');
  expect(screen.getByText('No ticket #999 on this board.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Close' }).getAttribute('href')).toBe('#tickets');
});

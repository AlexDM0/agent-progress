/**
 * The Kanban against a fake command client, in a happy-dom document. What matters: the seven lanes with their counts; the card anatomy
 * (id, size mark, priority, type, tokens, epics, waiting-on, hold, the draft labels) as text, a planted payload included; a draft's Ready,
 * the Drafts lane's multi-select Ready, and a ready card's Hold, Unhold and priority each post their `ControlCommand`; a refusal shows
 * verbatim; the controls are disabled while the stream is down; pressing an epic chip narrows the lanes and stores the choice under the
 * static page's key; and a card whose state moved on the next board is marked changed.
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

import { PRODUCT_NAMES }                           from '../../../src/shared/constants/ProductNames.ts';
import type { KanbanBoardState }                   from '../../@types/KanbanBoardState.ts';
import type { CommandOutcome, ControlCommandBody } from '../../api/CommandClient.ts';
import { boardPreferenceStoreOf }                  from '../../preferences/PreferenceStore.ts';
import { ControlSurroundingsContext }              from '../../shell/ControlAvailability.ts';
import type { ControlAvailability }                from '../../shell/ControlAvailability.ts';
import { exampleBoard, exampleTicket }             from '../../testing/KanbanBoardFixture.ts';
import { KanbanView }                              from './KanbanView.tsx';

const PLANTED_TITLE = '<img src=x onerror="window.plantedRan = true">';

const BOARD = exampleBoard({
  tickets: [
    exampleTicket('001', { status: 'draft' }),
    exampleTicket('002', { status: 'draft' }),
    exampleTicket('003', {
      size: 'L', priority: 'high', type: 'bug', epics: ['checkout']
    }),
    exampleTicket('004', { hold: 'waiting on the example vendor', title: PLANTED_TITLE }),
    exampleTicket('005', { status: 'in-progress', epics: ['billing'] }),
  ],
  waitingOn:  { '004': ['003'] },
  tokensById: { '005': 2_500 },
});

interface RenderedKanban {
  readonly sent:       ControlCommandBody[];
  readonly storage:    Map<string, string>;
  readonly answerWith: (outcome: CommandOutcome) => void;
  readonly rerender:   (boardState: KanbanBoardState) => void;
}

function renderKanban(availability: ControlAvailability = 'enabled', storedEntries: readonly [string, string][] = []): RenderedKanban {
  const sent: ControlCommandBody[] = [];
  const storage = new Map<string, string>(storedEntries);
  let nextOutcome: CommandOutcome = { verdict: 'applied', outcome: 'done', result: null };
  const surroundings = {
    availability,
    commandClient: {
      send: (command: ControlCommandBody) => {
        sent.push(command);
        return Promise.resolve(nextOutcome);
      },
    },
    onInstallHeld: () => undefined,
  };
  const boardStore = boardPreferenceStoreOf('example-tracker', () => ({
    getItem:    (key) => storage.get(key) ?? null,
    setItem:    (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }));
  const tree = (boardState: KanbanBoardState) => (
    <ControlSurroundingsContext.Provider value={surroundings}>
      <KanbanView boardState={boardState} boardStore={boardStore} />
    </ControlSurroundingsContext.Provider>
  );
  const rendered = render(tree(BOARD));
  return {
    sent,
    storage,
    answerWith: (outcome) => {
      nextOutcome = outcome;
    },
    rerender: (boardState) => rendered.rerender(tree(boardState)),
  };
}

function laneNamed(title: string): HTMLElement {
  return screen.getByRole('region', { name: title });
}

function cardNamed(namePrefix: string): HTMLElement {
  return screen.getAllByRole('article').find((card) => card.getAttribute('aria-label')?.startsWith(namePrefix) === true)
    ?? (() => {
      throw new Error(`no card named ${namePrefix}`);
    })();
}

async function clicked(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
});

describe('the lanes and the cards', () => {
  test('the seven lanes show in order, each with its count', () => {
    renderKanban();
    const lanes = screen.getAllByRole('region').filter((region) => region.hasAttribute('data-lane'));
    expect(lanes.map((lane) => [lane.getAttribute('aria-label'), lane.querySelector('.bridge-lane-count')?.textContent])).toEqual([
      ['Drafts', '3'],
      ['Ready', '2'],
      ['Building', '1'],
      ['In review', '0'],
      ['Merge queue', '0'],
      ['Done', '0'],
      ['Abandoned', '0'],
    ]);
    expect(within(laneNamed('In review')).getByText('Nothing in review.')).toBeTruthy();
  });

  test('a card shows its id, size mark, priority, type, epics, waiting-on and hold, and its tokens', () => {
    renderKanban();
    const card = cardNamed('#003');
    expect(card.querySelector('.bridge-kanban-id')?.textContent).toBe('#003');
    const size = card.querySelector('.bridge-kanban-size');
    expect([size?.textContent, size?.getAttribute('data-size'), size?.getAttribute('title')]).toEqual(['L', 'L', 'Size L']);
    expect(card.querySelector('.bridge-kanban-priority')?.textContent).toBe('high');
    expect(card.querySelector('.bridge-kanban-type')?.textContent).toBe('bug');
    expect(card.querySelector('.bridge-epic-chip')?.textContent).toBe('Example checkout');
    const held = cardNamed('#004');
    expect(held.querySelector('.bridge-kanban-waiting')?.textContent).toBe('waits on #003');
    expect(held.querySelector('.bridge-kanban-held')?.getAttribute('title')).toBe('Held: waiting on the example vendor');
    expect(cardNamed('#005').querySelector('.bridge-kanban-tokens')?.textContent).toBe('2.5k tokens');
  });

  test('a normal-priority card shows no priority mark, and an unsized one no size mark', () => {
    renderKanban();
    expect(cardNamed('#005').querySelector('.bridge-kanban-priority')).toBeNull();
    expect(cardNamed('#005').querySelector('.bridge-kanban-size')).toBeNull();
  });

  test('draft tickets read "draft ticket" and the filing draft "filing draft" with its state line', () => {
    renderKanban();
    expect(cardNamed('#001').querySelector('.bridge-kanban-label')?.textContent).toBe('draft ticket');
    const filingDraft = cardNamed('Draft D7');
    expect(filingDraft.querySelector('.bridge-kanban-label')?.textContent).toBe('filing draft');
    expect(filingDraft.querySelector('.bridge-kanban-note')?.textContent).toBe('Waiting on you · 2 open questions');
  });

  test('a planted payload in a title reaches the DOM only as text', () => {
    renderKanban();
    const card = cardNamed('#004');
    expect(card.querySelector('.bridge-kanban-title')?.textContent).toBe(PLANTED_TITLE);
    expect(card.querySelector('img')).toBeNull();
    expect((window as unknown as { plantedRan?: boolean }).plantedRan).toBeUndefined();
  });
});

describe('the controls', () => {
  test('a draft ticket\'s Ready posts ticket-ready for it, and a filing draft offers no Ready', async () => {
    const kanban = renderKanban();
    await clicked(within(cardNamed('#001')).getByRole('button', { name: 'Ready' }));
    expect(kanban.sent).toEqual([{ kind: 'ticket-ready', ticketReferences: ['001'] }]);
    expect(within(cardNamed('Draft D7')).queryByRole('button')).toBeNull();
  });

  test('the Drafts lane\'s Ready selected waits for a selection, then posts one ticket-ready for every selected draft ticket', async () => {
    const kanban = renderKanban();
    const readySelected = within(laneNamed('Drafts')).getByRole<HTMLButtonElement>('button', { name: 'Ready selected' });
    expect(readySelected.disabled).toBe(true);
    await clicked(screen.getByRole('checkbox', { name: 'Select #002' }));
    await clicked(screen.getByRole('checkbox', { name: 'Select #001' }));
    expect(readySelected.disabled).toBe(false);
    await clicked(readySelected);
    expect(kanban.sent).toEqual([{ kind: 'ticket-ready', ticketReferences: ['001', '002'] }]);
    expect(screen.queryAllByRole('checkbox').map((checkbox) => checkbox.getAttribute('aria-label'))).toEqual(['Select #001', 'Select #002']);
  });

  test('a ready card posts ticket-hold, ticket-unhold and ticket-priority', async () => {
    const kanban = renderKanban();
    await clicked(within(cardNamed('#003')).getByRole('button', { name: 'Hold' }));
    await clicked(within(cardNamed('#004')).getByRole('button', { name: 'Unhold' }));
    await clicked(within(cardNamed('#003')).getByRole('button', { name: 'Priority low' }));
    expect(kanban.sent).toEqual([
      { kind: 'ticket-hold', ticketReference: '003', reason: '' },
      { kind: 'ticket-unhold', ticketReference: '004' },
      { kind: 'ticket-priority', ticketReference: '003', priority: 'low' },
    ]);
    expect(within(cardNamed('#003')).queryByRole('button', { name: 'Priority high' })).toBeNull();
    expect(within(cardNamed('#005')).queryAllByRole('button')).toEqual([]);
  });

  test('a refusal shows verbatim beside the control that drew it', async () => {
    const kanban = renderKanban();
    kanban.answerWith({ verdict: 'refused', refusal: 'Ticket 001 has no Brief: it cannot be readied.' });
    await clicked(within(cardNamed('#001')).getByRole('button', { name: 'Ready' }));
    expect(within(cardNamed('#001')).getByRole('status').textContent).toBe('Ticket 001 has no Brief: it cannot be readied.');
  });

  test('every card control is disabled while the stream is down', () => {
    renderKanban('stream-down');
    const buttons = screen.getAllByRole<HTMLButtonElement>('button').filter((button) => button.closest('.bridge-kanban-card') !== null);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});

describe('the epic chips', () => {
  const STORAGE_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:kanban-epics`;

  test('pressing an epic chip narrows the lanes to its tickets and stores the choice under the static page\'s key', async () => {
    const kanban = renderKanban();
    const chip = within(screen.getByRole('group', { name: 'Epics' })).getByRole('button', { name: /Example billing/ });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await clicked(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(laneNamed('Ready').querySelectorAll('.bridge-kanban-card').length).toBe(0);
    expect(laneNamed('Building').querySelectorAll('.bridge-kanban-card').length).toBe(1);
    expect(kanban.storage.get(STORAGE_KEY)).toBe('["billing"]');
    await clicked(chip);
    expect(kanban.storage.has(STORAGE_KEY)).toBe(false);
  });

  test('a stored choice is read back on render', () => {
    renderKanban('enabled', [[STORAGE_KEY, '["checkout"]']]);
    expect(screen.getByRole('button', { name: /Example checkout/ }).getAttribute('aria-pressed')).toBe('true');
    expect(laneNamed('Ready').querySelectorAll('.bridge-kanban-card').length).toBe(1);
  });
});

describe('the change highlight', () => {
  test('a card whose state moved on the next board is marked changed, and the others are not', () => {
    const kanban = renderKanban();
    expect(document.querySelectorAll('[data-changed]').length).toBe(0);
    const next = exampleBoard({
      tickets: [
        exampleTicket('001', { status: 'draft' }),
        exampleTicket('002', { status: 'draft' }),
        exampleTicket('003', {
          status: 'in-progress', size: 'L', priority: 'high', type: 'bug', epics: ['checkout']
        }),
        exampleTicket('004', { hold: 'waiting on the example vendor', title: PLANTED_TITLE }),
        exampleTicket('005', { status: 'in-progress', epics: ['billing'] }),
      ],
    });
    act(() => kanban.rerender(next));
    expect([...document.querySelectorAll('[data-changed]')].map((card) => card.getAttribute('data-card'))).toEqual(['ticket:003']);
  });
});

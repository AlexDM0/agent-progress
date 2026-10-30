/**
 * The Kanban against a fake command client, in a happy-dom document. What matters: the seven lanes with their counts; the card anatomy
 * (id, size mark, priority, type, tokens, epics, waiting-on, hold, the draft labels) as text, a planted payload included; a draft's Ready,
 * the Drafts lane's multi-select Ready, and a ready card's Hold, Unhold and priority each post their `ControlCommand`; a refusal shows
 * verbatim; the controls are disabled while the stream is down; pressing an epic chip narrows the lanes and stores the choice under the
 * static page's key; and a card whose state moved on the next board is marked changed. Ported from the static page's Kanban: "needed first" and
 * `↦ N` on the cards, the hover marks and arrows (against stubbed card boxes, since happy-dom lays nothing out), the Ready lane by wave,
 * a closed lane's pages and the Abandoned lane's fold, each choice stored under the static page's key.
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

function renderKanban(availability: ControlAvailability = 'enabled', storedEntries: readonly [string, string][] = [], initialBoard: KanbanBoardState = BOARD): RenderedKanban {
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
  const rendered = render(tree(initialBoard));
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

const DEPENDENCY_BOARD = exampleBoard({
  tickets: [
    exampleTicket('110'),
    exampleTicket('111', { status: 'in-progress' }),
    exampleTicket('112', { dependsOn: ['110', '111'] }),
    exampleTicket('113', { dependsOn: ['112'] }),
  ],
  readyTicketIds: ['110'],
});

describe('the dependency marks and arrows', () => {
  const CARD_LEFT_BY_LANE: Readonly<Record<string, number>> = { ready: 0, building: 300 };
  const originalBoundingBox = Element.prototype.getBoundingClientRect;

  /** happy-dom lays nothing out, so each card gets a box: its lane's column, stacked by its place in the lane. */
  function layOutCards(): void {
    Element.prototype.getBoundingClientRect = function boxOf(this: Element) {
      const lane = this.closest('[data-lane]');
      if (!this.hasAttribute('data-card') || lane === null) return DOMRect.fromRect({
        x: 0, y: 0, width: 0, height: 0
      });
      const place = [...lane.querySelectorAll('[data-card]')].indexOf(this);
      return DOMRect.fromRect({
        x: CARD_LEFT_BY_LANE[lane.getAttribute('data-lane') ?? ''] ?? 0, y: place * 100, width: 200, height: 30
      });
    };
  }

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalBoundingBox;
  });

  test('a ticket another depends on carries "needed first", shown only while a dependent is hovered, and ↦ N counts what waits on it', () => {
    renderKanban('enabled', [], DEPENDENCY_BOARD);
    expect(cardNamed('#110').querySelector('.bridge-kanban-needed-first')?.textContent).toBe('needed first');
    expect(cardNamed('#113').querySelector('.bridge-kanban-needed-first')).toBeNull();
    const heldCount = cardNamed('#110').querySelector('.bridge-kanban-held-count');
    expect([heldCount?.textContent, heldCount?.getAttribute('title')]).toEqual(['↦ 2', '2 tickets wait on this one, directly or further down the chain']);
    expect(cardNamed('#113').querySelector('.bridge-kanban-held-count')).toBeNull();
    expect(document.querySelectorAll('[data-needed-first]').length).toBe(0);
  });

  test('hovering a card marks the cards it depends on needed first and draws an arrow from each, and leaving the board removes both', () => {
    layOutCards();
    renderKanban('enabled', [], DEPENDENCY_BOARD);
    act(() => {
      fireEvent.mouseOver(cardNamed('#112').querySelector('.bridge-kanban-title') ?? cardNamed('#112'));
    });
    expect([...document.querySelectorAll('[data-needed-first]')].map((card) => card.getAttribute('data-card'))).toEqual(['ticket:110', 'ticket:111']);
    const arrows = [...document.querySelectorAll('.bridge-kanban-arrows g')];
    expect(arrows.map((arrow) => arrow.getAttribute('data-route'))).toEqual(['same-lane', 'leftward']);
    expect(arrows.every((arrow) => arrow.querySelector('.bridge-kanban-arrow-line')?.getAttribute('d')?.startsWith('M ') === true)).toBe(true);
    act(() => {
      fireEvent.mouseLeave(document.querySelector('.bridge-kanban-frame') ?? document.body);
    });
    expect(document.querySelector('.bridge-kanban-arrows')).toBeNull();
    expect(document.querySelectorAll('[data-needed-first]').length).toBe(0);
  });
});

describe('the Ready lane by wave', () => {
  const STORAGE_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:kanban-todo-order`;

  test('a board without dependencies offers no order switch', () => {
    renderKanban();
    expect(screen.queryByRole('group', { name: 'Order Ready' })).toBeNull();
  });

  test('By wave divides the Ready lane into its waves, the one-ticket ones narrow, and stores the choice under the static page\'s key', async () => {
    const kanban = renderKanban('enabled', [], DEPENDENCY_BOARD);
    const order = screen.getByRole('group', { name: 'Order Ready' });
    expect(within(order).getByRole('button', { name: 'Filed' }).getAttribute('aria-pressed')).toBe('true');
    expect(laneNamed('Ready').querySelector('.bridge-lane-wave')).toBeNull();
    await clicked(within(order).getByRole('button', { name: 'By wave' }));
    const waves = [...laneNamed('Ready').querySelectorAll('.bridge-lane-wave')];
    expect(waves.map((wave) => [
      wave.querySelector('.bridge-lane-wave-head')?.textContent,
      wave.hasAttribute('data-narrow'),
      [...wave.querySelectorAll('.bridge-kanban-id')].map((id) => id.textContent),
    ])).toEqual([
      ['Now 1 ready · 2 side by side', false, ['#110']],
      ['Wave 2 one at a time', true, ['#112']],
      ['Wave 3 one at a time', true, ['#113']],
    ]);
    expect(kanban.storage.get(STORAGE_KEY)).toBe('by-wave');
  });
});

describe('the closed lanes\' pages', () => {
  const STORAGE_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:kanban-done-shown`;
  const deliveredStampOf = (minute: number) => `2026-10-01T10:${String(minute).padStart(2, '0')}:00+02:00`;
  const deliveredTickets = Array.from({ length: 20 }, (_ticket, i) => exampleTicket(String(400 + i), { status: 'delivered', delivered: deliveredStampOf(i) }));
  const DONE_BOARD = exampleBoard({ tickets: deliveredTickets });

  test('a closed lane shows its first page and counts every card; Show more adds the rest and Latest goes back to the first page', async () => {
    const kanban = renderKanban('enabled', [], DONE_BOARD);
    const done = laneNamed('Done');
    expect(done.querySelector('.bridge-lane-count')?.textContent).toBe('20');
    expect(done.querySelectorAll('.bridge-kanban-card').length).toBe(15);
    expect(done.querySelector('.bridge-lane-more span')?.textContent).toBe('15 of 20 shown');
    await clicked(within(done).getByRole('button', { name: 'Show 5 more' }));
    expect(done.querySelectorAll('.bridge-kanban-card').length).toBe(20);
    expect(kanban.storage.get(STORAGE_KEY)).toBe('20');
    await clicked(within(done).getByRole('button', { name: 'Latest 15' }));
    expect(done.querySelectorAll('.bridge-kanban-card').length).toBe(15);
    expect(kanban.storage.has(STORAGE_KEY)).toBe(false);
  });
});

describe('the Abandoned lane\'s fold', () => {
  const STORAGE_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:kanban-abandoned`;
  const ABANDONED_BOARD = exampleBoard({ tickets: [exampleTicket('500', { status: 'abandoned', abandonedAt: '2026-10-02T10:00:00+02:00' })] });

  test('the Abandoned lane is folded to its head and count until opened, and the choice is stored under the static page\'s key', async () => {
    const kanban = renderKanban('enabled', [], ABANDONED_BOARD);
    const abandoned = laneNamed('Abandoned');
    expect(abandoned.hasAttribute('data-collapsed')).toBe(true);
    expect(abandoned.querySelector('.bridge-lane-count')?.textContent).toBe('1');
    expect(abandoned.querySelector('.bridge-kanban-card')).toBeNull();
    const toggle = within(abandoned).getByRole('button', { name: 'Show the abandoned tickets' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await clicked(toggle);
    expect(abandoned.hasAttribute('data-collapsed')).toBe(false);
    expect(abandoned.querySelectorAll('.bridge-kanban-card').length).toBe(1);
    expect(within(abandoned).getByRole('button', { name: 'Collapse the abandoned tickets' }).getAttribute('aria-expanded')).toBe('true');
    expect(kanban.storage.get(STORAGE_KEY)).toBe('open');
  });

  test('a stored open choice is read back on render', () => {
    renderKanban('enabled', [[STORAGE_KEY, 'open']], ABANDONED_BOARD);
    expect(laneNamed('Abandoned').querySelectorAll('.bridge-kanban-card').length).toBe(1);
  });
});

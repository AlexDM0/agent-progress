/**
 * The Tickets view in a happy-dom document, holding what the static page's view did as behaviour: the table newest first, each id linking to its
 * detail panel; typing a search narrows the table and marks the match, an id query marking nothing; the type, epic and status chips narrow
 * as OR inside a group and AND across, with their counts; the empty table says what was asked and its Clear restores every row; a header
 * sorts and reverses; grouping by epic is stored under the static page's key; a planted title stays text.
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

import { PRODUCT_NAMES }                             from '../../../src/shared/constants/ProductNames.ts';
import { boardPreferenceStoreOf }                    from '../../preferences/PreferenceStore.ts';
import { exampleTicketsBoard, exampleTicketsTicket } from '../../testing/TicketsBoardFixture.ts';
import { TicketsView }                               from './TicketsView.tsx';

const PLANTED_TITLE = '<img src=x onerror="window.plantedRan = true">';

const BOARD = exampleTicketsBoard({
  tickets: [
    exampleTicketsTicket('001', { title: 'Add dark mode', branch: 'ticket-001', status: 'delivered' }),
    exampleTicketsTicket('002', {
      title: 'Fix the export', type: 'bug', epics: ['billing'], priority: 'high'
    }),
    exampleTicketsTicket('003', { title: 'Research a vendor', type: 'research', epics: ['checkout'] }),
    exampleTicketsTicket('004', { title: PLANTED_TITLE, status: 'in-progress' }),
  ],
  waitingOn: { '003': ['002'] },
});

const GROUPING_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:ticket-grouping`;

function renderTickets(storedEntries: readonly [string, string][] = []): Map<string, string> {
  const storage = new Map<string, string>(storedEntries);
  const boardStore = boardPreferenceStoreOf('example-tracker', () => ({
    getItem:    (key) => storage.get(key) ?? null,
    setItem:    (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }));
  render(<TicketsView boardState={BOARD} boardStore={boardStore} />);
  return storage;
}

function shownIds(): (string | null)[] {
  return [...document.querySelectorAll('tbody tr[data-ticket-id]')].map((row) => row.getAttribute('data-ticket-id'));
}

function chipNamed(group: string, name: RegExp): HTMLElement {
  return within(screen.getByRole('group', { name: group })).getByRole('button', { name });
}

function typed(text: string): void {
  act(() => {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), { target: { value: text } });
  });
}

function clicked(element: HTMLElement): void {
  act(() => {
    fireEvent.click(element);
  });
}

afterEach(() => {
  cleanup();
});

describe('the table', () => {
  test('shows every ticket newest first, each id linking to its detail panel, with the count', () => {
    renderTickets();
    expect(shownIds()).toEqual(['004', '003', '002', '001']);
    expect(screen.getByRole('link', { name: '#002' }).getAttribute('href')).toBe('#tickets/002');
    expect(screen.getByText('4 of 4 tickets · 1 in progress')).toBeTruthy();
  });

  test('a row shows its state badge, priority, type, epics and waiting-on', () => {
    renderTickets();
    const row = document.querySelector('tr[data-ticket-id="002"]');
    expect(row?.querySelector('.bridge-state-badge')?.textContent).toBe('To do');
    expect(row?.querySelector('.bridge-ticket-priority')?.textContent).toBe('high');
    expect(row?.querySelector('.bridge-ticket-type')?.textContent).toBe('bug');
    expect(row?.querySelector('.bridge-epic-chip')?.textContent).toBe('Example billing');
    expect(document.querySelector('tr[data-ticket-id="003"] .bridge-ticket-waiting')?.textContent).toBe('waits on #002');
  });

  test('a planted payload in a title reaches the DOM only as text', () => {
    renderTickets();
    expect(document.querySelector('tr[data-ticket-id="004"] td:nth-child(2)')?.textContent).toBe(PLANTED_TITLE);
    expect(document.querySelector('tbody img')).toBeNull();
    expect((window as unknown as { plantedRan?: boolean }).plantedRan).toBeUndefined();
  });
});

describe('the search', () => {
  test('typing narrows the table and marks each match in the title and branch', () => {
    renderTickets();
    typed('DARK');
    expect(shownIds()).toEqual(['001']);
    expect([...document.querySelectorAll('mark.bridge-match')].map((mark) => mark.textContent)).toEqual(['dark']);
    expect(screen.getByText('1 of 4 tickets · 1 in progress')).toBeTruthy();
  });

  test('an id query looks at the id alone and marks nothing', () => {
    renderTickets();
    typed('#1');
    expect(shownIds()).toEqual(['001']);
    expect(document.querySelectorAll('mark').length).toBe(0);
  });
});

describe('the chips', () => {
  test('type chips are alternatives, and their counts ignore their own group', () => {
    renderTickets();
    clicked(chipNamed('Type', /^bug/));
    clicked(chipNamed('Type', /^research/));
    expect(shownIds()).toEqual(['003', '002']);
    expect(chipNamed('Type', /^ticket/).querySelector('.bridge-chip-count')?.textContent).toBe('2');
    expect(chipNamed('Type', /^bug/).getAttribute('aria-pressed')).toBe('true');
  });

  test('an epic chip and a status chip hold together, and the no-epic chip keeps the tickets in none', () => {
    renderTickets();
    clicked(chipNamed('Epic', /^no epic/));
    expect(shownIds()).toEqual(['004', '001']);
    clicked(chipNamed('Status', /^In progress/));
    expect(shownIds()).toEqual(['004']);
  });

  test('a table nothing matches says what was asked, and its Clear brings every row back', () => {
    renderTickets();
    typed('nothing like it');
    clicked(chipNamed('Type', /^bug/));
    expect(shownIds()).toEqual([]);
    const empty = document.querySelector('.bridge-ticket-empty');
    expect(empty?.querySelector('p')?.textContent).toBe('No ticket matches “nothing like it”, type bug.');
    clicked(within(empty as HTMLElement).getByRole('button', { name: 'Clear search and filters' }));
    expect(shownIds()).toEqual(['004', '003', '002', '001']);
    expect(screen.queryByRole('button', { name: 'Clear search and filters' })).toBeNull();
  });
});

describe('the sort and the grouping', () => {
  test('a header sorts ascending, marks itself sorted, and a second press reverses it', () => {
    renderTickets();
    const titleButton = screen.getByRole('button', { name: 'title' });
    clicked(titleButton);
    expect(shownIds()).toEqual(['004', '001', '002', '003']);
    expect(titleButton.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('button', { name: 'id' }).closest('th')?.hasAttribute('aria-sort')).toBe(false);
    clicked(titleButton);
    expect(shownIds()).toEqual(['003', '002', '001', '004']);
  });

  test('grouping by epic puts each epic\'s tickets under its head and stores the choice under the static page\'s key', () => {
    const storage = renderTickets();
    clicked(screen.getByRole('button', { name: 'Group by epic' }));
    expect([...document.querySelectorAll('.bridge-ticket-epic-head')].map((head) => head.textContent)).toEqual(['Example billing', 'Example checkout', 'No epic']);
    expect(storage.get(GROUPING_KEY)).toBe('epic');
    clicked(screen.getByRole('button', { name: 'Group by epic' }));
    expect(storage.has(GROUPING_KEY)).toBe(false);
  });

  test('a stored grouping is read back on render', () => {
    renderTickets([[GROUPING_KEY, 'epic']]);
    expect(screen.getByRole('button', { name: 'Group by epic' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.bridge-ticket-epic-head').length).toBe(3);
  });
});

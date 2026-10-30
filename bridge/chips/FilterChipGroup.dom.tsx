/**
 * A row of filter chips, in a happy-dom document, behaving as the static page's chips did. What matters: each chip shows whether it is pressed and
 * its count, a chip of no count is marked empty, a click hands its value on, a state chip leads with its lane dot and an epic chip with
 * its swatch, and a label is text, never markup.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { FilterChipGroup } from './FilterChipGroup.tsx';

const CHIPS = [
  { value: 'pending', label: 'To do', stateToken: 'pending' },
  { value: 'checkout', label: 'Example checkout', slot: 3 },
  { value: 'planted', label: '<b>planted</b>' },
];

function renderChips(pressed: readonly string[], onToggle: (value: string) => void = () => undefined): void {
  render(
    <FilterChipGroup
      label="Example filters"
      chips={CHIPS}
      pressed={pressed}
      countByChip={new Map([['pending', 4], ['checkout', 0], ['planted', 1]])}
      onToggle={onToggle}
    />,
  );
}

function chipOf(value: string): HTMLElement {
  const chip = screen.getByRole('group', { name: 'Example filters' }).querySelector<HTMLElement>(`[data-chip="${value}"]`);
  if (chip === null) throw new Error(`no chip ${value}`);
  return chip;
}

afterEach(() => {
  cleanup();
});

describe('the filter chips', () => {
  test('each chip shows whether it is pressed and its count, and a chip of no count is marked empty', () => {
    renderChips(['checkout']);
    expect(CHIPS.map((chip) => [chipOf(chip.value).getAttribute('aria-pressed'), chipOf(chip.value).querySelector('.bridge-chip-count')?.textContent])).toEqual([
      ['false', '4'],
      ['true', '0'],
      ['false', '1'],
    ]);
    expect(CHIPS.map((chip) => chipOf(chip.value).hasAttribute('data-empty'))).toEqual([false, true, false]);
  });

  test('a click hands the chip\'s value on', () => {
    const toggled: string[] = [];
    renderChips([], (value) => toggled.push(value));
    fireEvent.click(chipOf('checkout'));
    fireEvent.click(chipOf('pending'));
    expect(toggled).toEqual(['checkout', 'pending']);
  });

  test('a state chip leads with its lane dot and an epic chip with its swatch', () => {
    renderChips([]);
    expect(chipOf('pending').querySelector('.bridge-lane-dot')?.getAttribute('data-state')).toBe('pending');
    expect(chipOf('checkout').querySelector('.bridge-chip-swatch')?.getAttribute('data-epic-slot')).toBe('3');
    expect(chipOf('planted').querySelector('.bridge-lane-dot, .bridge-chip-swatch')).toBeNull();
  });

  test('a label is text, never markup', () => {
    renderChips([]);
    expect(chipOf('planted').querySelector('b')).toBeNull();
    expect(chipOf('planted').textContent).toBe('<b>planted</b> 1');
  });
});

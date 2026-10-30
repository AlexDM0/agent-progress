/**
 * The chart-head menu in a happy-dom document. What matters: the button opens and closes it and says so in `aria-expanded`; Esc closes it
 * and hands the focus back to the button; a click or focus outside closes it; an item marked to close it closes it, handing the focus back
 * or leaving it as marked, while an unmarked item, a toggle, leaves it open; and a button named apart from its glyph keeps that name.
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

import { CLOSES_MENU_KEEPING_FOCUS, CLOSES_MENU_RETURNING_FOCUS, HeadMenu } from './HeadMenu.tsx';

function renderMenu() {
  render(
    <>
      <HeadMenu label="Example options" buttonName="Example options" buttonContent="⋯">
        <button type="button" data-closes-menu={CLOSES_MENU_RETURNING_FOCUS}>Choose</button>
        <button type="button" data-closes-menu={CLOSES_MENU_KEEPING_FOCUS}>Open elsewhere</button>
        <button type="button">Toggle</button>
      </HeadMenu>
      <button type="button">Outside</button>
    </>,
  );
  const button = screen.getByRole('button', { name: 'Example options' });
  return { button, menu: () => screen.queryByRole('dialog', { name: 'Example options' }) };
}

afterEach(cleanup);

describe('the head menu', () => {
  test('opens and closes from its button, saying so', () => {
    const { button, menu } = renderMenu();
    expect(menu()).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    expect(menu()).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(button);
    expect(menu()).toBeNull();
  });

  test('closes on Esc and hands the focus back to its button', () => {
    const { button, menu } = renderMenu();
    fireEvent.click(button);
    screen.getByRole('button', { name: 'Toggle' }).focus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test('closes on a click or focus outside', () => {
    const { button, menu } = renderMenu();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(menu()).toBeNull();

    fireEvent.click(button);
    fireEvent.focusIn(screen.getByRole('button', { name: 'Outside' }));
    expect(menu()).toBeNull();
  });

  test('stays open on a click inside it and on an unmarked item', () => {
    const { button, menu } = renderMenu();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Toggle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));

    expect(menu()).not.toBeNull();
  });

  test('closes on a marked item, handing the focus back or leaving it as the item says', () => {
    const { button, menu } = renderMenu();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button);

    const outside = screen.getByRole('button', { name: 'Outside' });
    fireEvent.click(button);
    outside.focus();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Open elsewhere' }));
    expect(menu()).toBeNull();
    expect(document.activeElement).not.toBe(button);
  });
});

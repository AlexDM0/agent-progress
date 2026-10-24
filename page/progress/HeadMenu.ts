/** A chart-head menu: a button that opens a small popover under itself, closed by Esc, a choice, or a click or focus outside. */

import { placeUnderAnchor } from './PopoverPlacement.ts';

export interface HeadMenuElementIds {
  buttonElementId: string;
  menuElementId:   string;
}

export interface HeadMenu {
  wire(): void;
  isOpen(): boolean;
  close(returnFocus: boolean): void;
}

export function createHeadMenu(elementIds: HeadMenuElementIds): HeadMenu {
  const { buttonElementId, menuElementId } = elementIds;
  const menu   = (): HTMLElement | null => document.getElementById(menuElementId);
  const button = (): HTMLElement | null => document.getElementById(buttonElementId);
  const isOpen = (): boolean => menu()?.hidden === false;

  const open = (): void => {
    const menuElement   = menu();
    const buttonElement = button();
    if (menuElement === null || buttonElement === null) {
      return;
    }
    menuElement.hidden = false;
    buttonElement.setAttribute('aria-expanded', 'true');
    placeUnderAnchor(menuElement, buttonElement);
  };

  const close = (returnFocus: boolean): void => {
    const menuElement = menu();
    if (menuElement === null || menuElement.hidden) {
      return;
    }
    menuElement.hidden = true;
    const buttonElement = button();
    buttonElement?.setAttribute('aria-expanded', 'false');
    if (returnFocus) {
      buttonElement?.focus();
    }
  };

  const wire = (): void => {
    const menuElement   = menu();
    const buttonElement = button();
    if (menuElement === null || buttonElement === null) {
      return;
    }
    buttonElement.addEventListener('click', () => {
      if (isOpen()) {
        close(false);
      } else {
        open();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen()) {
        event.preventDefault();
        close(true);
      }
    });
    const leavesMenu = (target: EventTarget | null): boolean => target instanceof Node && !menuElement.contains(target) && !buttonElement.contains(target);
    document.addEventListener('pointerdown', (event) => {
      if (isOpen() && leavesMenu(event.target)) {
        close(false);
      }
    });
    document.addEventListener('focusin', (event) => {
      if (isOpen() && leavesMenu(event.target)) {
        close(false);
      }
    });
  };

  return {
    wire,
    isOpen,
    close,
  };
}

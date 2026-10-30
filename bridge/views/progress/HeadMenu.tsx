/**
 * A chart-head menu, as the static page's was: a button that opens a small popover under itself, closed by Esc,
 * which hands the focus back to the button, by a choice, or by a click or focus outside. An item closes it by its `data-closes-menu`:
 * `return-focus` hands the focus back to the button, `keep-focus` leaves it to whatever the item opened; an item without one, a toggle,
 * leaves the menu open.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject
} from 'react';

export interface HeadMenuProps {
  readonly buttonContent: ReactNode;
  /** The menu's label. */
  readonly label:         string;
  /** The button's accessible name when its content is a glyph rather than words. */
  readonly buttonName?:   string;
  readonly buttonTitle?:  string;
  /** Lets the chart hand the focus back to the button after a popover the menu opened. */
  readonly buttonRef?:    RefObject<HTMLButtonElement | null>;
  readonly children:      ReactNode;
}

/** The `data-closes-menu` values. */
export const CLOSES_MENU_RETURNING_FOCUS = 'return-focus';
export const CLOSES_MENU_KEEPING_FOCUS = 'keep-focus';

export function HeadMenu({
  buttonContent, label, buttonName, buttonTitle, buttonRef, children
}: HeadMenuProps) {
  const [menuIsOpen, setMenuIsOpen] = useState(false);
  const ownButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuElementId = useId();
  const buttonElement = (): HTMLButtonElement | null => buttonRef?.current ?? ownButtonRef.current;

  const closeOnChoice = (event: MouseEvent<HTMLDivElement>): void => {
    const item = event.target instanceof Element ? event.target.closest('[data-closes-menu]') : null;
    if (item === null) return;
    setMenuIsOpen(false);
    if (item.getAttribute('data-closes-menu') === CLOSES_MENU_RETURNING_FOCUS) buttonElement()?.focus();
  };

  useEffect(() => {
    if (!menuIsOpen) return undefined;
    const leavesMenu = (target: EventTarget | null): boolean => target instanceof Node
      && menuRef.current?.contains(target) !== true && buttonElement()?.contains(target) !== true;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuIsOpen(false);
      buttonElement()?.focus();
    };
    const closeOnLeaving = (event: Event): void => {
      if (leavesMenu(event.target)) setMenuIsOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnLeaving);
    document.addEventListener('focusin', closeOnLeaving);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnLeaving);
      document.removeEventListener('focusin', closeOnLeaving);
    };
  });

  return (
    <div className="bridge-head-menu">
      <button
        ref={(element) => {
          ownButtonRef.current = element;
          if (buttonRef !== undefined) buttonRef.current = element;
        }}
        type="button"
        className="bridge-head-menu-button"
        aria-label={buttonName}
        aria-haspopup="dialog"
        aria-expanded={menuIsOpen}
        aria-controls={menuElementId}
        title={buttonTitle}
        onClick={() => setMenuIsOpen((wasOpen) => !wasOpen)}
      >
        {buttonContent}
      </button>
      {/* The items are buttons; their click is read as it bubbles, to close the menu after the item acted. */}
      <div ref={menuRef} id={menuElementId} className="bridge-head-menu-popover" role="dialog" aria-label={label} hidden={!menuIsOpen} onClick={closeOnChoice}>
        {menuIsOpen ? children : null}
      </div>
    </div>
  );
}

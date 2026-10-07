/** The detail panel on either page: which registered opener opens it, how it slides in and out, and how it closes and returns the focus. */

import { DETAIL_BODY_ELEMENT_ID }                          from '../constants/TemplateIds.ts';
import { DomUtil }                                         from '../utils/DomUtil.ts';
import type { DetailLinkOpener, DetailTargetRegistration } from './@types/DetailTargetRegistration.ts';
import type { PanelRoomScroller }                          from './PanelRoomController.ts';
import { createPanelRoomController }                       from './PanelRoomController.ts';

const DETAIL_DIALOG_ELEMENT_ID = 'ap-detail';
const DETAIL_CLOSE_ELEMENT_ID  = 'ap-detail-close';
const MOTION_ATTRIBUTE         = 'data-motion';
const SWAPPED_ATTRIBUTE        = 'data-swapped';
const SELECTED_ATTRIBUTE       = 'data-selected';
const MILLISECONDS_PER_SECOND  = 1000;

/** A click on one of these inside a row belongs to it: a row carries its ticket badge and its "waiting on" links. */
const OWN_CLICK_SELECTOR = 'a, button, input, select, textarea, label, summary';

export interface DetailPanelTarget<Kind extends string> {
  kind: Kind;
  id:   string;
}

export interface DetailPanelSettings<Kind extends string> {
  targets:              Readonly<Record<Kind, DetailTargetRegistration>>;
  /** Checked in order, before the openers, on every click. */
  linkOpeners:          readonly DetailLinkOpener<Kind>[];
  /** Refilled on every layout, which drops the selection mark on what the panel shows. */
  observedContainerIds: readonly string[];
  panelRoomScrollers:   readonly PanelRoomScroller[];
  updateOverflow:       () => void;
}

export interface DetailPanelController<Kind extends string> {
  wire(): void;
  readOpenTarget(): DetailPanelTarget<Kind> | null;
  /** Opens the panel on the target again; a target the page no longer shows opens nothing and answers false. */
  reopen(target: DetailPanelTarget<Kind>): boolean;
  /** Opens the panel as a link does, the focus returning to what held it; a target with nothing to show opens nothing and answers false. */
  open(target: DetailPanelTarget<Kind>): boolean;
}

function isSameTarget<Kind extends string>(first: DetailPanelTarget<Kind> | null, second: DetailPanelTarget<Kind>): boolean {
  return first !== null && first.kind === second.kind && first.id === second.id;
}

function slideDurationMillisecondsOf(dialog: HTMLElement): number {
  return (Number.parseFloat(getComputedStyle(dialog).transitionDuration) || 0) * MILLISECONDS_PER_SECOND;
}

export function createDetailPanelController<Kind extends string>(settings: DetailPanelSettings<Kind>): DetailPanelController<Kind> {
  const { targets, linkOpeners } = settings;
  const registeredKinds = Object.keys(targets) as Kind[];
  const openerSelector  = registeredKinds
    .map((kind) => targets[kind].openerSelector)
    .filter((selector): selector is string => selector !== null)
    .join(', ');
  const panelRoom = createPanelRoomController(settings.panelRoomScrollers, settings.updateOverflow);
  let openTarget: DetailPanelTarget<Kind> | null = null;
  let returnFocusTo: HTMLElement | null = null;
  let pendingCloseTimer = 0;

  const detailDialog = (): HTMLDialogElement | null => {
    const dialog = document.getElementById(DETAIL_DIALOG_ELEMENT_ID);
    return dialog instanceof HTMLDialogElement ? dialog : null;
  };

  const selectorOf = (target: DetailPanelTarget<Kind>): string => targets[target.kind].selectorFor(CSS.escape(target.id));

  const targetOfOpener = (opener: HTMLElement): DetailPanelTarget<Kind> | null => {
    const kind = registeredKinds.find((candidate) => {
      const candidateSelector = targets[candidate].openerSelector;
      return candidateSelector !== null && opener.matches(candidateSelector);
    });
    return kind === undefined ? null : { kind, id: targets[kind].idOf(opener) };
  };

  const clickedLinkTargetOf = (event: MouseEvent): DetailPanelTarget<Kind> | null => {
    if (!(event.target instanceof Element)) {
      return null;
    }
    for (const linkOpener of linkOpeners) {
      const link = event.target.closest(linkOpener.selector);
      if (link instanceof HTMLElement) {
        return { kind: linkOpener.kind, id: linkOpener.idOf(link) };
      }
    }
    return null;
  };

  const clickedOpenerOf = (event: MouseEvent): HTMLElement | null => {
    // The second click of a double-click would close what the first one opened.
    if (openerSelector === '' || event.detail > 1 || !(event.target instanceof Element)
      || event.target.closest(`${OWN_CLICK_SELECTOR}, #${DETAIL_DIALOG_ELEMENT_ID}`) !== null) {
      return null;
    }
    const opener = event.target.closest(openerSelector);
    // A click that ends a text selection selected text; it opens nothing.
    if (!(opener instanceof HTMLElement) || (window.getSelection()?.toString() ?? '') !== '') {
      return null;
    }
    return opener;
  };

  /** Enter and Space count only on the focused opener itself, so a key on a link inside it still follows the link. */
  const keyActivatedOpenerOf = (event: KeyboardEvent): HTMLElement | null => {
    if ((event.key !== 'Enter' && event.key !== ' ') || openerSelector === '' || !(event.target instanceof HTMLElement)
      || !event.target.matches(openerSelector)) {
      return null;
    }
    return event.target;
  };

  const reflectSelection = (): void => {
    for (const element of document.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`)) {
      element.removeAttribute(SELECTED_ATTRIBUTE);
    }
    if (openTarget !== null) {
      document.querySelector(selectorOf(openTarget))?.setAttribute(SELECTED_ATTRIBUTE, '');
    }
  };

  // Slides in from the right when closed or closing; while open only the contents cross-fade.
  const present = (dialog: HTMLDialogElement, target: DetailPanelTarget<Kind>): void => {
    const body            = document.getElementById(DETAIL_BODY_ELEMENT_ID);
    const panelIsShowing  = dialog.open && !dialog.hasAttribute(MOTION_ATTRIBUTE);
    window.clearTimeout(pendingCloseTimer);
    if (panelIsShowing) {
      body?.removeAttribute(SWAPPED_ATTRIBUTE);
      void body?.offsetWidth;
      body?.setAttribute(SWAPPED_ATTRIBUTE, '');
    } else {
      panelRoom.dockBelowTabBar();
      if (!dialog.open) {
        dialog.setAttribute(MOTION_ATTRIBUTE, 'out');
        dialog.show();
      }
      void dialog.offsetWidth;
      dialog.removeAttribute(MOTION_ATTRIBUTE);
    }
    if (body !== null) {
      body.scrollTop = 0;
    }
    openTarget = target;
    reflectSelection();
  };

  const showTarget = (target: DetailPanelTarget<Kind>): boolean => {
    const dialog = detailDialog();
    if (dialog === null) {
      return false;
    }
    const registration = targets[target.kind];
    const markup       = registration.markupOf(target.id);
    if (markup === '') {
      return false;
    }
    DomUtil.setMarkup(DETAIL_BODY_ELEMENT_ID, markup);
    present(dialog, target);
    registration.afterShown?.();
    return true;
  };

  const openAndMakeRoom = (target: DetailPanelTarget<Kind>, opener: HTMLElement | null): boolean => {
    if (!showTarget(target)) {
      return false;
    }
    requestAnimationFrame(() => {
      panelRoom.makeRoom();
      if (opener !== null && opener.isConnected) {
        panelRoom.scrollClearOfPanel(opener);
      }
    });
    return true;
  };

  const openFromOpener = (opener: HTMLElement, focusStaysOnOpener: boolean): void => {
    const target = targetOfOpener(opener);
    if (target === null || !openAndMakeRoom(target, opener)) {
      return;
    }
    returnFocusTo = opener;
    // show() moves focus into the panel, which a pointer did not ask for.
    if (focusStaysOnOpener) {
      opener.focus({ preventScroll: true });
    }
  };

  const close = (returnFocus: boolean): void => {
    const dialog = detailDialog();
    if (dialog === null || !dialog.open || dialog.hasAttribute(MOTION_ATTRIBUTE)) {
      return;
    }
    const closedTarget   = openTarget;
    const slideDuration  = slideDurationMillisecondsOf(dialog);
    const finishClosing  = (): void => {
      dialog.close();
      dialog.removeAttribute(MOTION_ATTRIBUTE);
    };
    if (slideDuration === 0) {
      finishClosing();
    } else {
      dialog.setAttribute(MOTION_ATTRIBUTE, 'out');
      pendingCloseTimer = window.setTimeout(finishClosing, slideDuration);
    }
    openTarget = null;
    reflectSelection();
    panelRoom.releaseRoom(() => openTarget !== null);
    // A layout since the panel opened replaced the opener with an equal one.
    const openerNow   = closedTarget === null ? null : document.querySelector(selectorOf(closedTarget));
    const focusTarget = returnFocusTo !== null && returnFocusTo.isConnected ? returnFocusTo : openerNow;
    if (returnFocus && focusTarget instanceof HTMLElement) {
      focusTarget.focus({ preventScroll: true });
    }
    returnFocusTo = null;
  };

  const wire = (): void => {
    const dialog = detailDialog();
    if (dialog === null) {
      return;
    }
    document.addEventListener('click', (event) => {
      const linkedTarget = clickedLinkTargetOf(event);
      if (linkedTarget !== null) {
        const opener = document.activeElement;
        if (openAndMakeRoom(linkedTarget, null)) {
          returnFocusTo = opener instanceof HTMLElement && !(detailDialog()?.contains(opener) ?? false) ? opener : returnFocusTo;
        }
        return;
      }
      const opener = clickedOpenerOf(event);
      if (opener === null) {
        return;
      }
      const clickedTarget = targetOfOpener(opener);
      if (clickedTarget !== null && isSameTarget(openTarget, clickedTarget)) {
        close(false);
        return;
      }
      openFromOpener(opener, true);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && openTarget !== null && !event.defaultPrevented) {
        event.preventDefault();
        close(true);
        return;
      }
      const opener = keyActivatedOpenerOf(event);
      if (opener !== null) {
        event.preventDefault();
        openFromOpener(opener, false);
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(true);
    });
    document.getElementById(DETAIL_CLOSE_ELEMENT_ID)?.addEventListener('click', () => {
      close(true);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a') !== null) {
        close(false);
      }
    });

    const selectionObserver = new MutationObserver(reflectSelection);
    for (const elementId of settings.observedContainerIds) {
      const container = document.getElementById(elementId);
      if (container !== null) {
        selectionObserver.observe(container, { childList: true, subtree: true });
      }
    }
    window.addEventListener('scroll', () => {
      if (openTarget !== null) {
        panelRoom.dockBelowTabBar();
      }
    }, { passive: true });
    window.addEventListener('resize', () => {
      if (openTarget === null) {
        return;
      }
      targets[openTarget.kind].afterShown?.();
      panelRoom.dockBelowTabBar();
      // After the page's own resize layout, which measures the chart without the room.
      requestAnimationFrame(panelRoom.remakeRoom);
    });
  };

  return {
    wire,
    readOpenTarget: () => (detailDialog()?.open === true ? openTarget : null),
    reopen:         (target) => openAndMakeRoom(target, null),
    open:           (target) => {
      const opener = document.activeElement;
      if (!openAndMakeRoom(target, null)) {
        return false;
      }
      returnFocusTo = opener instanceof HTMLElement ? opener : null;
      return true;
    },
  };
}

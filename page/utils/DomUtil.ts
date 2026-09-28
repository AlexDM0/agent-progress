/** The page's element writes and its handle on the template's own behaviour: the one util that touches the document. */

import type { ShortenedText } from './MarkupUtil.ts';

export interface TemplateBehaviour {
  selectTab:              (name: string) => void;
  restoreTicketOpenState: () => void;
  onBeforeReload:         (callback: () => void) => void;
}

function templateBehaviour(): TemplateBehaviour | null {
  const candidate = (window as unknown as Record<string, unknown>)['agentProgressTemplate'];
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const behaviour = candidate as Partial<TemplateBehaviour>;
  if (typeof behaviour.selectTab !== 'function' || typeof behaviour.restoreTicketOpenState !== 'function' || typeof behaviour.onBeforeReload !== 'function') {
    return null;
  }
  return { selectTab: behaviour.selectTab, restoreTicketOpenState: behaviour.restoreTicketOpenState, onBeforeReload: behaviour.onBeforeReload };
}

function setText(elementId: string, text: string): void {
  const element = document.getElementById(elementId);
  if (element !== null) {
    element.textContent = text;
  }
}

function setShortenedText(elementId: string, shortened: ShortenedText): void {
  setText(elementId, shortened.text);
  const element = document.getElementById(elementId);
  if (element === null) {
    return;
  }
  if (shortened.title === null) {
    element.removeAttribute('title');
  } else {
    element.setAttribute('title', shortened.title);
  }
}

/** `innerHTML` is safe here because the markup modules escaped every value once and ticket bodies arrive sanitised. */
function setMarkup(elementId: string, markup: string): void {
  const element = document.getElementById(elementId);
  if (element !== null) {
    element.innerHTML = markup;
  }
}

/** Adds markup after the element's last child, leaving what it already holds in place. Safe for the reason `setMarkup` is. */
function appendMarkup(elementId: string, markup: string): void {
  document.getElementById(elementId)?.insertAdjacentHTML('beforeend', markup);
}

function setHidden(elementId: string, hidden: boolean): void {
  const element = document.getElementById(elementId);
  if (element !== null) {
    element.hidden = hidden;
  }
}

function reflectSegment(containerId: string, attributeName: string, selectedValue: string): void {
  const container = document.getElementById(containerId);
  if (container === null) {
    return;
  }
  for (const button of container.querySelectorAll(`[data-${attributeName}]`)) {
    if (button instanceof HTMLElement) {
      button.setAttribute('aria-pressed', String(button.dataset[attributeName] === selectedValue));
    }
  }
}

export const DomUtil = {
  templateBehaviour,
  setText,
  setShortenedText,
  setMarkup,
  appendMarkup,
  setHidden,
  reflectSegment,
} as const;

/**
 * What the page entry starts with: reading a JSON island, showing the template's error banner, starting once the document is ready,
 * clearing the containers it owns, and showing or hiding a tab button.
 */

import { DomUtil } from '../utils/DomUtil.ts';

function showLayoutFailure(message: string): void {
  const banner = document.getElementById('ap-error');
  const text   = document.getElementById('ap-error-text');
  if (text !== null) {
    text.textContent = message;
  }
  if (banner !== null) {
    banner.hidden = false;
  }
}

function islandContentsOf(elementId: string): unknown {
  const island = document.getElementById(elementId);
  if (island === null) {
    return null;
  }
  try {
    return JSON.parse(island.textContent ?? '') as unknown;
  } catch {
    return null;
  }
}

/** Runs `start` once the document is parsed, and turns anything it throws into the error banner. */
function startWhenReady(start: () => void): void {
  function startSafely(): void {
    try {
      start();
    } catch (failure) {
      showLayoutFailure(failure instanceof Error ? failure.message : String(failure));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSafely);
  } else {
    startSafely();
  }
}

function clearOwnedContainers(markupIds: readonly string[], textIds: readonly string[]): void {
  for (const elementId of markupIds) {
    DomUtil.setMarkup(elementId, '');
  }
  for (const elementId of textIds) {
    DomUtil.setText(elementId, '');
  }
}

/** A tab with nothing to show is hidden, and a viewer whose stored tab was it lands on `fallbackTab` instead. */
function showTabButton(tabElementId: string, isShown: boolean, fallbackTab: string): void {
  const tabElement = document.getElementById(tabElementId);
  if (tabElement === null) {
    return;
  }
  tabElement.hidden = !isShown;
  if (!isShown && tabElement.getAttribute('aria-selected') === 'true') {
    DomUtil.templateBehaviour()?.selectTab(fallbackTab);
  }
}

export const PageShell = {
  showLayoutFailure, islandContentsOf, startWhenReady, clearOwnedContainers, showTabButton
} as const;

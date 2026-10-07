/** What every page edition's entry shares: reading a JSON island, showing the template's error banner, and starting once the document is ready. */

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

export const PageShell = { showLayoutFailure, islandContentsOf, startWhenReady } as const;

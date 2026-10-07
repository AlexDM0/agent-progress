/** The spec page's browser entry: it reads the spec island of `resources/spec-template.html` and fills the spec view's one container. */
import { PageShell } from '../shell/PageShell.ts';

const SPEC_ISLAND_ELEMENT_ID = 'ap-spec-data';
const SPEC_MAIN_ELEMENT_ID   = 'ap-spec-main';

function specCountOf(islandContents: unknown): number | null {
  if (typeof islandContents !== 'object' || islandContents === null || !('snapshot' in islandContents) || !('limits' in islandContents)) {
    return null;
  }
  const { snapshot } = islandContents;
  if (typeof snapshot !== 'object' || snapshot === null || !('specs' in snapshot) || !Array.isArray(snapshot.specs)) {
    return null;
  }
  return snapshot.specs.length;
}

function startSpecPage(): void {
  const specCount = specCountOf(PageShell.islandContentsOf(SPEC_ISLAND_ELEMENT_ID));
  const main      = document.getElementById(SPEC_MAIN_ELEMENT_ID);
  if (specCount === null || main === null) {
    PageShell.showLayoutFailure('The spec data island is missing or could not be read, so the spec view could not be built.');
    return;
  }
  main.textContent = specCount === 1 ? '1 spec' : `${specCount} specs`;
}

// The one deliberate exception to "no work at module load": a browser entry has no caller.
PageShell.startWhenReady(startSpecPage);

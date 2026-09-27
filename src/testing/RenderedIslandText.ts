/** Reads a JSON island back out of a rendered page, for the render and page specs. Test-only: nothing that ships may import `src/testing/`. */

/** `[^<]*` rather than a lazy any: every `<` inside an island is escaped, so the real element holds none. */
export function islandTextOf(document: string, elementId: string): string {
  const match = new RegExp(`<script type="application/json" id="${elementId}">([^<]*)</script>`).exec(document);
  return match?.[1] ?? '';
}

/** The island parsed, `null` when the page holds no such island. */
export function islandContentsOf(document: string, elementId: string): unknown {
  const islandText = islandTextOf(document, elementId);
  return islandText === '' ? null : JSON.parse(islandText) as unknown;
}

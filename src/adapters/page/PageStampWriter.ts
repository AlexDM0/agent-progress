/**
 * Writes `progress.stamp.js`, the one line the open page polls to learn whether a newer render exists; it is a script, not JSON,
 * because `fetch` is blocked on `file://`.
 */
import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';

export function pageStampTextOf(generatedAt: Date): string {
  return `window.apStamp = ${generatedAt.getTime()};\n`;
}

export function createPageStampWriter(stampFilePath: string): { write(generatedAt: Date): void } {
  function write(generatedAt: Date): void {
    writeFileAtomically(stampFilePath, pageStampTextOf(generatedAt));
  }

  return { write };
}

/** A block owned by a caller inside a CLAUDE.md, written between two markers so everything outside them is untouched. */
import { existsSync, readFileSync } from 'node:fs';

import { writeFileAtomicallyThroughLinks } from '../atomic-file/AtomicFile.ts';

export type WriteManagedBlockOutcome = 'created' | 'appended' | 'replaced' | 'refused-start-without-end';

export interface ManagedBlockMarkers {
  start: string;
  end:   string;
}

function managedBlockFrom(blockBody: string, markers: ManagedBlockMarkers): string {
  return `${markers.start}\n${blockBody}\n${markers.end}`;
}

/**
 * A start marker with no end marker is refused and the file left exactly as it was, because nothing
 * can tell where the caller's content ends there. Only the first marker pair is ever replaced.
 */
export function writeManagedBlock(claudeFilePath: string, blockBody: string, markers: ManagedBlockMarkers): WriteManagedBlockOutcome {
  const block = managedBlockFrom(blockBody, markers);

  if (!existsSync(claudeFilePath)) {
    writeFileAtomicallyThroughLinks(claudeFilePath, `${block}\n`);
    return 'created';
  }

  const existingContent = readFileSync(claudeFilePath, 'utf8');
  const startOffset = existingContent.indexOf(markers.start);
  if (startOffset < 0) {
    writeFileAtomicallyThroughLinks(claudeFilePath, `${existingContent.replace(/\n*$/, '')}\n\n${block}\n`);
    return 'appended';
  }

  const endOffset = existingContent.indexOf(markers.end, startOffset + markers.start.length);
  if (endOffset < 0) return 'refused-start-without-end';

  const contentBefore = existingContent.slice(0, startOffset);
  const contentAfter = existingContent.slice(endOffset + markers.end.length);
  writeFileAtomicallyThroughLinks(claudeFilePath, `${contentBefore}${block}${contentAfter}`);
  return 'replaced';
}

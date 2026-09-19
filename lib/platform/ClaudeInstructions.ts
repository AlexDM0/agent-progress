/**
 * The block `agent-progress init` owns inside a repository's `CLAUDE.md`, written between two markers
 * so everything outside them is untouched, and written in place rather than through
 * `lib/platform/AtomicFile.ts`, so a symlinked `CLAUDE.md` stays a symlink.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';

import { CLAUDE_MANAGED_END, CLAUDE_MANAGED_START } from '../constants/Statuses';

export type WriteManagedBlockOutcome = 'created' | 'appended' | 'replaced' | 'refused-start-without-end';

function managedBlockFrom(blockBody: string): string {
  return `${CLAUDE_MANAGED_START}\n${blockBody}\n${CLAUDE_MANAGED_END}`;
}

/**
 * A start marker with no end marker is refused and the file left exactly as it was, because the tool
 * cannot tell where its own content ends there. Only the first marker pair is ever replaced.
 */
export function writeManagedBlock(claudeFilePath: string, blockBody: string): WriteManagedBlockOutcome {
  const block = managedBlockFrom(blockBody);

  if (!existsSync(claudeFilePath)) {
    writeFileSync(claudeFilePath, `${block}\n`);
    return 'created';
  }

  const existingContent = readFileSync(claudeFilePath, 'utf8');
  const startOffset = existingContent.indexOf(CLAUDE_MANAGED_START);
  if (startOffset < 0) {
    writeFileSync(claudeFilePath, `${existingContent.replace(/\n*$/, '')}\n\n${block}\n`);
    return 'appended';
  }

  const endOffset = existingContent.indexOf(CLAUDE_MANAGED_END, startOffset + CLAUDE_MANAGED_START.length);
  if (endOffset < 0) return 'refused-start-without-end';

  const contentBefore = existingContent.slice(0, startOffset);
  const contentAfter = existingContent.slice(endOffset + CLAUDE_MANAGED_END.length);
  writeFileSync(claudeFilePath, `${contentBefore}${block}${contentAfter}`);
  return 'replaced';
}

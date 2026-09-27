import { createFileAtomically, writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import type { ProgressFile }                         from '../../lib/tracker-model/@types/ProgressFile.ts';
import { LIMITS }                                    from '../../shared/constants/Limits.ts';
import { ProgressFileMappingUtil }                   from './utils/ProgressFileMappingUtil.ts';

/** Always the current version, indented and ending with a newline, because people repair the file by hand. */
function documentTextOf(progress: ProgressFile): string {
  return `${JSON.stringify(ProgressFileMappingUtil.storedDocumentOf(progress), null, LIMITS.JSON_INDENT_SPACES)}\n`;
}

export function createProgressFileWriter(progressFilePath: string): {
  write(progress: ProgressFile): void;
  create(progress: ProgressFile): 'created' | 'already-exists';
} {
  /** Through `src/lib/atomic-file/AtomicFile.ts`, because a subagent in another worktree may be reading this exact file right now. */
  function write(progress: ProgressFile): void {
    writeFileAtomically(progressFilePath, documentTextOf(progress));
  }

  /** `init`'s write: it never replaces a progress file, whatever path led to it, and says so instead. */
  function create(progress: ProgressFile): 'created' | 'already-exists' {
    return createFileAtomically(progressFilePath, documentTextOf(progress));
  }

  return { write, create };
}

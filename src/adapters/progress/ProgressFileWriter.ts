import { createFileAtomically, writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import type { TrackerProgress }                      from '../../lib/tracker-model/@types/TrackerProgress.ts';
import { JsonTextUtil }                              from '../../shared/utils/JsonTextUtil.ts';
import { ProgressFileMappingUtil }                   from './utils/ProgressFileMappingUtil.ts';

/** Always the current version, indented and ending with a newline, because people repair the file by hand. */
function documentTextOf(progress: TrackerProgress): string {
  return JsonTextUtil.storedFileTextOf(ProgressFileMappingUtil.storedDocumentOf(progress));
}

export function createProgressFileWriter(progressFilePath: string): {
  write(progress: TrackerProgress): void;
  create(progress: TrackerProgress): 'created' | 'already-exists';
} {
  /** Through `src/lib/atomic-file/AtomicFile.ts`, because a subagent in another worktree may be reading this exact file right now. */
  function write(progress: TrackerProgress): void {
    writeFileAtomically(progressFilePath, documentTextOf(progress));
  }

  /** `init`'s write: it never replaces a progress file, whatever path led to it, and says so instead. */
  function create(progress: TrackerProgress): 'created' | 'already-exists' {
    return createFileAtomically(progressFilePath, documentTextOf(progress));
  }

  return { write, create };
}

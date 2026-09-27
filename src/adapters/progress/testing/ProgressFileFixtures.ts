/**
 * The tracker as the current progress.json format stores it, for the progress.json adapter specs. Test-only: nothing that ships may import
 * `src/adapters/progress/testing/`.
 */
import type { ProgressFile }       from '../../../lib/tracker-model/@types/ProgressFile.ts';
import { emptyProgress }           from '../../../testing/ProgressFixtures.ts';
import type { StoredProgressFile } from '../@types/StoredProgressFile.ts';

/** The progress as the writer stores it, `version` first; the tasks array is the progress's own, so a row filed on either shows in both. */
export function versionTwoDocumentOf(progress: ProgressFile): StoredProgressFile {
  return { version: 2, ...progress };
}

export function emptyDocument(): StoredProgressFile {
  return versionTwoDocumentOf(emptyProgress());
}

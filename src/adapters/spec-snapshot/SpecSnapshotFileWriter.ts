import { join } from 'node:path';

import { writeFileAtomically }         from '../../lib/atomic-file/AtomicFile.ts';
import type { SpecSnapshot }           from '../../lib/spec-snapshot/@types/SpecSnapshot.ts';
import { JsonTextUtil }                from '../../shared/utils/JsonTextUtil.ts';
import { SPEC_SNAPSHOT_FILE_NAME }     from './constants/SpecSnapshotFile.ts';
import { SpecSnapshotFileMappingUtil } from './utils/SpecSnapshotFileMappingUtil.ts';

/** Writes the snapshot whole into `trackerDirectory`, creating the folder when it is missing, and writes nothing else. */
export function createSpecSnapshotFileWriter(trackerDirectory: string): { write(snapshot: SpecSnapshot): void } {
  const specSnapshotFilePath = join(trackerDirectory, SPEC_SNAPSHOT_FILE_NAME);

  /** Through `src/lib/atomic-file/AtomicFile.ts`, because the open page may be reading this exact file right now. */
  function write(snapshot: SpecSnapshot): void {
    writeFileAtomically(specSnapshotFilePath, JsonTextUtil.storedFileTextOf(SpecSnapshotFileMappingUtil.storedDocumentOf(snapshot)));
  }

  return { write };
}

import type { SpecSnapshot }                  from '../../../lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { StoredSpecSnapshotFile }        from '../@types/StoredSpecSnapshotFile.ts';
import { CURRENT_SPEC_SNAPSHOT_FILE_VERSION } from '../constants/SpecSnapshotFile.ts';

/** The version leads, so a reader sees which format it holds before anything else. */
function storedDocumentOf(snapshot: SpecSnapshot): StoredSpecSnapshotFile {
  return { version: CURRENT_SPEC_SNAPSHOT_FILE_VERSION, ...snapshot };
}

function snapshotOf(storedDocument: StoredSpecSnapshotFile): SpecSnapshot {
  const { version: _storedVersion, ...snapshot } = storedDocument;
  return snapshot;
}

export const SpecSnapshotFileMappingUtil = { snapshotOf, storedDocumentOf } as const;

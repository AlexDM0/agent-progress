import type { SpecSnapshot }                       from '../../../lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { CURRENT_SPEC_SNAPSHOT_FILE_VERSION } from '../constants/SpecSnapshotFile.ts';

export interface StoredSpecSnapshotFile extends SpecSnapshot {
  readonly version: typeof CURRENT_SPEC_SNAPSHOT_FILE_VERSION;
}

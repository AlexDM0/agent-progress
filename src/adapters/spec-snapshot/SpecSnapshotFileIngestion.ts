/** progress-spec.json read back into the snapshot: read, validate, map. */
import { join } from 'node:path';

import type { SpecSnapshot }              from '../../lib/spec-snapshot/@types/SpecSnapshot.ts';
import { storedFileTextOf }               from '../StoredFileText.ts';
import { StoredValueUtil }                from '../utils/StoredValueUtil.ts';
import { SPEC_SNAPSHOT_FILE_NAME }        from './constants/SpecSnapshotFile.ts';
import { SpecSnapshotFileMappingUtil }    from './utils/SpecSnapshotFileMappingUtil.ts';
import { SpecSnapshotFileValidationUtil } from './utils/SpecSnapshotFileValidationUtil.ts';

export type SpecSnapshotFileReading =
  | { verdict: 'readable'; snapshot: SpecSnapshot }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

export class SpecSnapshotFileIngestion {
  constructor(private readonly trackerDirectory: string) {}

  /** Never throws: an unreadable document comes back as a verdict whose reason names the offending field. */
  read(): SpecSnapshotFileReading {
    const storedText = storedFileTextOf(join(this.trackerDirectory, SPEC_SNAPSHOT_FILE_NAME));
    if (storedText.verdict !== 'readable') return storedText;

    const parsedJson = StoredValueUtil.parsedJsonOf(storedText.text);
    if (parsedJson.verdict === 'unparseable') return { verdict: 'unreadable', reason: parsedJson.problem };

    const validated = SpecSnapshotFileValidationUtil.readingOf(parsedJson.value);
    if (validated.verdict === 'unreadable') return validated;
    return { verdict: 'readable', snapshot: SpecSnapshotFileMappingUtil.snapshotOf(validated.document) };
  }
}

import { statSync } from 'node:fs';

import type { FileTimes }                from '../adapters/spec-kit/@types/SpecKitScan.ts';
import { createSpecKitRepositoryScan }   from '../adapters/spec-kit/SpecKitRepositoryScan.ts';
import type { SpecSnapshotSource }       from '../lib/spec-snapshot/@types/SpecSnapshotSource.ts';
import { writeExampleSpecKitRepository } from './SpecKitRepositoryFixtures.ts';

/** A file system may keep the real birth time however far back the modification time is set, so the planted time stands in for both. */
function plantedFileTimesOf(path: string): FileTimes {
  const modificationTimeMs = statSync(path).mtimeMs;
  return { birthTimeMs: modificationTimeMs, modificationTimeMs };
}

/** Writes the example spec-kit repository into `directory`, dated days before `now`, and returns its scan as the snapshot's source. */
export function scannedExampleSpecKitRepository(directory: string, now: Date): SpecSnapshotSource {
  writeExampleSpecKitRepository(directory, { datesFilesInThePast: true, now });
  return createSpecKitRepositoryScan(plantedFileTimesOf).scan(directory);
}

import { createSpecKitRepositoryScan }   from '../adapters/spec-kit/SpecKitRepositoryScan.ts';
import type { SpecSnapshotSource }       from '../lib/spec-snapshot/@types/SpecSnapshotSource.ts';
import { writeExampleSpecKitRepository } from './SpecKitRepositoryFixtures.ts';

/** Writes the example spec-kit repository into `directory`, dated in the past, and returns its scan as the snapshot's source. */
export function scannedExampleSpecKitRepository(directory: string): SpecSnapshotSource {
  writeExampleSpecKitRepository(directory, { datesFilesInThePast: true });
  return createSpecKitRepositoryScan().scan(directory);
}

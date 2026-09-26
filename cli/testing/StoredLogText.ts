/** The tracker's log.jsonl exactly as stored, for a command spec to check that a refused command left the log byte-identical. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { TRACKER_FILES } from '../../src/services/tracker/constants/TrackerFiles';

export function storedLogTextOf(repositoryDirectory: string): string {
  return readFileSync(join(repositoryDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, TRACKER_FILES.LOG_FILE_NAME), 'utf8');
}

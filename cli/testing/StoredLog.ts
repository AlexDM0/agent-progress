/** The tracker's log as people read it, whatever file it is stored in, for a command spec to check what a command logged. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { TRACKER_FILES }       from '../../src/services/tracker/constants/TrackerFiles';
import type { WordedLogEntry } from '../../src/shared/@types/WordedLogEntry';

export function storedLogEntriesOf(repositoryDirectory: string): WordedLogEntry[] {
  const progressFilePath = join(repositoryDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, TRACKER_FILES.PROGRESS_FILE_NAME);
  return (JSON.parse(readFileSync(progressFilePath, 'utf8')) as { log: WordedLogEntry[] }).log;
}

/** The tracker's log as people read it, whatever file it is stored in, for a command spec to check what a command logged. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import type { LogEntry, ProgressFile } from '../../src/lib/tracker-model/@types/ProgressFile';
import { TRACKER_FILES }               from '../../src/services/tracker/constants/TrackerFiles';

export function storedLogEntriesOf(repositoryDirectory: string): LogEntry[] {
  const progressFilePath = join(repositoryDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, TRACKER_FILES.PROGRESS_FILE_NAME);
  return (JSON.parse(readFileSync(progressFilePath, 'utf8')) as ProgressFile).log;
}

/** The tracker's log.jsonl as people read it, each record worded through LogUtil, for a command spec to check what a command logged. */
import { join } from 'node:path';

import { LogFileIngestion }    from '../../src/adapters/log/LogFileIngestion';
import { LogUtil }             from '../../src/adapters/utils/LogUtil';
import { TRACKER_FILES }       from '../../src/services/tracker/constants/TrackerFiles';
import type { WordedLogEntry } from '../../src/shared/@types/WordedLogEntry';

export function storedLogEntriesOf(repositoryDirectory: string): WordedLogEntry[] {
  const logFilePath = join(repositoryDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, TRACKER_FILES.LOG_FILE_NAME);
  const reading     = new LogFileIngestion(logFilePath).read();
  if (reading.verdict === 'absent') return [];
  if (reading.verdict === 'unreadable') throw new Error(`the stored log cannot be read: ${reading.reason}`);
  return reading.records.map(LogUtil.wordedEntryOf);
}

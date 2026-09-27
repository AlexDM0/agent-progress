/** Which log a tracker has, from its log.jsonl reading: the file's records, an empty log when it is absent, or its own unreadable verdict. */
import type { LogFileReading, StoredLogReading } from '../@types/StoredLog.ts';

function storedLogOf(logFileReading: LogFileReading): StoredLogReading {
  if (logFileReading.verdict === 'unreadable') return logFileReading;
  const records = logFileReading.verdict === 'readable' ? logFileReading.records : [];
  return { verdict: 'readable', records, logFileMustBeRewritten: false };
}

export const TrackerLogUtil = { storedLogOf } as const;

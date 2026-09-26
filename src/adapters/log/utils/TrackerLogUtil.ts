/** Which log a tracker has, from its progress reading's carried-over log and its log.jsonl reading. */
import type { LogRecord }        from '../../../lib/tracker-model/@types/LogRecord.ts';
import { EmbeddedLogUtil }       from '../../legacy/utils/EmbeddedLogUtil.ts';
import type { StoredLogReading } from '../@types/StoredLog.ts';
import type { LogFileReading }   from '../LogFileIngestion.ts';

/** `carriedOverLog` is the log an older progress file carried, as notes, or null when it carried none. */
function storedLogOf(
  carriedOverLog: readonly LogRecord[] | null,
  logFileReading: LogFileReading,
  locations: { logFilePath: string; progressFilePath: string },
): StoredLogReading {
  // The seam: dropping src/adapters/legacy/ removes this line, and the carriedOverLog and locations parameters only it reads.
  if (carriedOverLog !== null) return EmbeddedLogUtil.storedLogBesideAnEmbeddedLog(carriedOverLog, logFileReading, locations);

  if (logFileReading.verdict === 'unreadable') return logFileReading;
  const records = logFileReading.verdict === 'readable' ? logFileReading.records : [];
  return { verdict: 'readable', records, logFileMustBeRewritten: false };
}

export const TrackerLogUtil = { storedLogOf } as const;

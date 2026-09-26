/** Which log a tracker has, from its progress reading's carried-over log and its log.jsonl reading. */
import type { LogRecord }      from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { LogFileReading } from '../LogFileIngestion.ts';

export interface StoredLog {
  records:                LogRecord[];
  logFileMustBeRewritten: boolean;
}

export type StoredLogReading = ({ verdict: 'readable' } & StoredLog) | { verdict: 'unreadable'; reason: string };

/** The notes are copied before progress.json is written and a command's records after it, so a copy cut short holds at most the embedded notes. */
function logFileIsAStartOfTheEmbeddedLog(carriedOverLog: readonly LogRecord[], logFileRecords: readonly LogRecord[]): boolean {
  if (logFileRecords.length > carriedOverLog.length) return false;
  return logFileRecords.every((logFileRecord, index) => {
    const embeddedRecord = carriedOverLog[index];
    return logFileRecord.kind === 'note'
      && embeddedRecord?.kind === 'note'
      && logFileRecord.at === embeddedRecord.at
      && logFileRecord.fields.text === embeddedRecord.fields.text;
  });
}

/**
 * `carriedOverLog` is the log an older progress file carried, as notes, or null when it carried none. A log.jsonl beside a file carrying one
 * is a migration cut short only when it holds the start of that log, or all of it; one holding anything more is refused naming both files, so
 * nothing is dropped silently.
 */
function storedLogOf(
  carriedOverLog: readonly LogRecord[] | null,
  logFileReading: LogFileReading,
  locations: { logFilePath: string; progressFilePath: string },
): StoredLogReading {
  if (carriedOverLog === null) {
    if (logFileReading.verdict === 'unreadable') return logFileReading;
    const records = logFileReading.verdict === 'readable' ? logFileReading.records : [];
    return { verdict: 'readable', records, logFileMustBeRewritten: false };
  }

  if (logFileReading.verdict === 'absent' || (logFileReading.verdict === 'readable' && logFileIsAStartOfTheEmbeddedLog(carriedOverLog, logFileReading.records))) {
    return { verdict: 'readable', records: [...carriedOverLog], logFileMustBeRewritten: true };
  }
  return {
    verdict: 'unreadable',
    reason:  `${locations.logFilePath} sits beside a version 1 ${locations.progressFilePath} and holds records its log does not: `
      + 'remove log.jsonl to keep the progress file\'s log, or restore the version 2 progress.json it belongs to',
  };
}

export const TrackerLogUtil = { storedLogOf } as const;

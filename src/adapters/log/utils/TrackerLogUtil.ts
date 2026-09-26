/** Which log a tracker has, from its two stored readings: a version 1 progress.json owns its log, a version 2 one leaves it to log.jsonl. */
import type { LogRecord }      from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { LogFileReading } from '../LogFileIngestion.ts';

export interface StoredLog {
  records:                LogRecord[];
  logFileMustBeRewritten: boolean;
}

export type StoredLogReading = ({ verdict: 'readable' } & StoredLog) | { verdict: 'unreadable'; reason: string };

/** Only a prefix can be checked: one command's records may carry different `at` stamps, so no count or stamp tells its lines apart. */
function logFileContinuesTheEmbeddedLog(embeddedLog: readonly LogRecord[], logFileRecords: readonly LogRecord[]): boolean {
  if (logFileRecords.length < embeddedLog.length) return false;
  return embeddedLog.every((embeddedRecord, i) => {
    const logFileRecord = logFileRecords[i];
    return embeddedRecord.kind === 'note'
      && logFileRecord?.kind === 'note'
      && logFileRecord.at === embeddedRecord.at
      && logFileRecord.fields.text === embeddedRecord.fields.text;
  });
}

/**
 * `embeddedLog` is the version 1 file's log as notes, or null for a version 2 file. A log.jsonl beside a version 1 file is a
 * migration cut short only when it begins with that log; any other one is refused naming both files, so nothing is dropped silently.
 */
function storedLogOf(
  embeddedLog: readonly LogRecord[] | null,
  logFileReading: LogFileReading,
  locations: { logFilePath: string; progressFilePath: string },
): StoredLogReading {
  if (embeddedLog === null) {
    if (logFileReading.verdict === 'unreadable') return logFileReading;
    const records = logFileReading.verdict === 'readable' ? logFileReading.records : [];
    return { verdict: 'readable', records, logFileMustBeRewritten: false };
  }

  if (logFileReading.verdict === 'absent' || (logFileReading.verdict === 'readable' && logFileContinuesTheEmbeddedLog(embeddedLog, logFileReading.records))) {
    return { verdict: 'readable', records: [...embeddedLog], logFileMustBeRewritten: true };
  }
  return {
    verdict: 'unreadable',
    reason:  `${locations.logFilePath} sits beside a version 1 ${locations.progressFilePath} and does not continue its log: `
      + 'remove log.jsonl to keep the progress file\'s log, or restore the version 2 progress.json it belongs to',
  };
}

export const TrackerLogUtil = { storedLogOf } as const;

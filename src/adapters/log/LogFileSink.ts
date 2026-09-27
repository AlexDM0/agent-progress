/** The log sink that collects the Board's records for log.jsonl and answers what the file should hold once the command is done. */
import type { LogRecord } from '../../lib/tracker-model/@types/LogRecord.ts';
import type { StoredLog } from './@types/StoredLog.ts';

/** `recordsToWrite` is null when the file must stay as it is, so a command that logs nothing leaves log.jsonl alone. */
export function createLogFileSink(storedLog: StoredLog): {
  record(record: LogRecord): void;
  recordsToWrite(): LogRecord[] | null;
} {
  const recordedRecords: LogRecord[] = [];

  function record(logRecord: LogRecord): void {
    recordedRecords.push(logRecord);
  }

  function recordsToWrite(): LogRecord[] | null {
    // A cleared tracker's log starts again with the clearing itself; the Board only reports the event, so the sink decides.
    const lastClearingIndex = recordedRecords.findLastIndex((recordedRecord) => recordedRecord.kind === 'tracker-cleared');
    if (lastClearingIndex !== -1) return recordedRecords.slice(lastClearingIndex);
    if (storedLog.logFileMustBeRewritten || recordedRecords.length > 0) return [...storedLog.records, ...recordedRecords];
    return null;
  }

  return { record, recordsToWrite };
}

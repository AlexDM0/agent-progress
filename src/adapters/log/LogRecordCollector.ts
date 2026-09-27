/**
 * Collects the records the Board logs during one command and answers what log.jsonl should hold once it is done; writing the file is
 * `src/adapters/log/LogFileWriter.ts`'s.
 */
import type { LogRecord } from '../../lib/tracker-model/@types/LogRecord.ts';
import type { StoredLog } from './@types/StoredLog.ts';

/** `recordsToWrite` is null when the file must stay as it is, so a command that logs nothing leaves log.jsonl alone. */
export function createLogRecordCollector(storedLog: StoredLog): {
  collect(record: LogRecord): void;
  recordsToWrite(): LogRecord[] | null;
} {
  const collectedRecords: LogRecord[] = [];

  function collect(record: LogRecord): void {
    collectedRecords.push(record);
  }

  function recordsToWrite(): LogRecord[] | null {
    // A cleared tracker's log starts again with the clearing itself; the Board only reports the event, so the collector decides.
    const lastClearingIndex = collectedRecords.findLastIndex((collectedRecord) => collectedRecord.kind === 'tracker-cleared');
    if (lastClearingIndex !== -1) return collectedRecords.slice(lastClearingIndex);
    if (collectedRecords.length > 0) return [...storedLog.records, ...collectedRecords];
    return null;
  }

  return { collect, recordsToWrite };
}

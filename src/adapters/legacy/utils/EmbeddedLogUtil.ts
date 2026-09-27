/**
 * Reads the log array a version 1 progress.json holds, its worded entries becoming note records, and believes a log.jsonl beside it only as a
 * migration cut short. It can be deleted once every tracker has been rewritten by `agent-progress update`, with the progress ingestion's
 * `carriedOverLog` and `StoredLog.logFileMustBeRewritten`, which only a carried-over log sets.
 */
import type { LogRecord }        from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { StoredLogReading } from '../../log/@types/StoredLog.ts';
import type { LogFileReading }   from '../../log/LogFileIngestion.ts';
import type { StoredLogEntry }   from '../@types/StoredProgressFileVersionOne.ts';

function logArrayProblemOf(log: unknown): string | null {
  return Array.isArray(log) ? null : 'log is not an array';
}

function logEntryProblemOf(value: unknown, index: number): string | null {
  // An array entry is let through to the field checks, so its reason names the first field it lacks.
  if (typeof value !== 'object' || value === null) return `log[${index}] is not an object`;
  const entry = value as Record<string, unknown>;
  if (typeof entry['at'] !== 'string') return `log[${index}].at is not a timestamp`;
  if (typeof entry['text'] !== 'string') return `log[${index}].text is not a string`;
  return null;
}

function logEntriesProblemOf(log: readonly unknown[]): string | null {
  for (const [index, entry] of log.entries()) {
    const problem = logEntryProblemOf(entry, index);
    if (problem !== null) return problem;
  }
  return null;
}

/** A sentence cannot be parsed back into the event it words, so each one is kept as a note, in order, with its stamp. */
function notesOf(entries: readonly StoredLogEntry[]): LogRecord[] {
  return entries.map((entry) => ({ at: entry.at, kind: 'note', fields: { text: entry.text } }));
}

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
 * Null when no log was carried over. A log.jsonl beside a version 1 file is a migration cut short only when it holds the start of that
 * file's log, or all of it; one holding anything more is refused naming both files, so nothing is dropped silently.
 */
function storedLogBesideAnEmbeddedLog(
  carriedOverLog: readonly LogRecord[] | null,
  logFileReading: LogFileReading,
  locations: { logFilePath: string; progressFilePath: string },
): StoredLogReading | null {
  if (carriedOverLog === null) return null;
  if (logFileReading.verdict === 'absent' || (logFileReading.verdict === 'readable' && logFileIsAStartOfTheEmbeddedLog(carriedOverLog, logFileReading.records))) {
    return { verdict: 'readable', records: [...carriedOverLog], logFileMustBeRewritten: true };
  }
  return {
    verdict: 'unreadable',
    reason:  `${locations.logFilePath} sits beside a version 1 ${locations.progressFilePath} and holds records its log does not: `
      + 'remove log.jsonl to keep the progress file\'s log, or restore the version 2 progress.json it belongs to',
  };
}

export const EmbeddedLogUtil = {
  logArrayProblemOf,
  logEntriesProblemOf,
  notesOf,
  storedLogBesideAnEmbeddedLog,
} as const;

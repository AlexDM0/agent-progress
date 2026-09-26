/**
 * Reads the log array a version 1 progress.json holds, its worded entries becoming note records.
 * It can be deleted once every tracker has been rewritten by `agent-progress update`.
 */
import type { LogRecord }      from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { StoredLogEntry } from '../@types/StoredProgressFileVersionOne.ts';

function logArrayProblemOf(log: unknown): string | null {
  return Array.isArray(log) ? null : 'log is not an array';
}

function logEntryProblemOf(value: unknown, index: number): string | null {
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

export const EmbeddedLogUtil = { logArrayProblemOf, logEntriesProblemOf, notesOf } as const;

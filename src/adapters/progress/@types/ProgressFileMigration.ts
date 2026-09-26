import type { LogRecord }          from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { StoredProgressFile } from './StoredProgressFile.ts';

/**
 * The migrate step's answer: `current` means nothing older was found and the current path reads the document as parsed; `migrated` hands
 * over the document in the current format, already validated, with the log records the older file carried.
 */
export type ProgressFileMigration =
  | { verdict: 'current' }
  | { verdict: 'migrated'; document: StoredProgressFile; carriedOverLog: LogRecord[] | null }
  | { verdict: 'unreadable'; reason: string };

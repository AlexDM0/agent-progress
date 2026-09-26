import type { ProgressFile }   from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { WordedLogEntry } from './WordedLogEntry.ts';

/** What `status --json` prints and the page's progress island holds: the progress in its own shape version, with the log worded. */
export type ProgressDocument = ProgressFile & { version: number; log: WordedLogEntry[] };

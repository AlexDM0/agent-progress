import type { TrackerProgress } from '../../lib/tracker-model/@types/TrackerProgress.ts';
import type { WordedLogEntry }  from './WordedLogEntry.ts';

/** What `status --json` prints and the page's progress island holds: the progress in its own shape version, with the log worded. */
export type WordedProgressDocument<Entry extends WordedLogEntry = WordedLogEntry> = TrackerProgress & { version: number; log: Entry[] };

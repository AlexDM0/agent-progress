/** Words why a tracker's stored files could not be read, for the person who ran the command; the reading carries only the file and the reason. */
import type { UnreadableTracker } from '../../shared/@types/UnreadableTracker.ts';

function refusalMessageOf(reading: UnreadableTracker): string {
  if (reading.verdict === 'absent') return `${reading.filePath} cannot be read: it is not there`;
  if (reading.unreadableFile === 'log-file') return `The log cannot be read: ${reading.reason}`;
  return `${reading.filePath} cannot be read: ${reading.reason}`;
}

export const TrackerReadingWordingUtil = { refusalMessageOf } as const;

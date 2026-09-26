/** Words why a tracker's stored files could not be read, as a refusal or as why a render gave up; the reading carries only the file and the reason. */
import type { UnreadableTracker } from '../../shared/@types/UnreadableTracker.ts';

function refusalMessageOf(reading: UnreadableTracker): string {
  if (reading.verdict === 'absent') return `${reading.filePath} cannot be read: it is not there`;
  if (reading.unreadableFile === 'log-file') return `The log cannot be read: ${reading.reason}`;
  return `${reading.filePath} cannot be read: ${reading.reason}`;
}

/** A fragment that continues "The dashboard … regenerated: ", so its words run on in lower case. */
function renderReasonOf(reading: UnreadableTracker): string {
  if (reading.verdict === 'absent') return `there is no progress file at ${reading.filePath}`;
  if (reading.unreadableFile === 'log-file') return `the log cannot be read: ${reading.reason}`;
  return `${reading.filePath} could not be read: ${reading.reason}`;
}

export const TrackerReadingWordingUtil = { refusalMessageOf, renderReasonOf } as const;

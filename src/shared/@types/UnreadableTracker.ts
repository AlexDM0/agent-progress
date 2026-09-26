/** Why a tracker's stored files could not be read: the file that failed and, when it is there but broken, the adapter's own reason. */
export type UnreadableTracker =
  | { verdict: 'absent'; filePath: string }
  | { verdict: 'unreadable'; unreadableFile: 'progress-file' | 'log-file'; filePath: string; reason: string };

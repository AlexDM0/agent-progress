/** The names of the tracker's own files and folders, each a bare name joined onto the directory that holds it. */
export const TRACKER_FILES = {
  PROGRESS_FILE_NAME:     'progress.json',
  LOG_FILE_NAME:          'log.jsonl',
  HTML_FILE_NAME:         'progress.html',
  TRACKER_DIRECTORY_NAME: '.agent-progress',
  TICKETS_DIRECTORY_NAME: 'tickets',
  LOCK_DIRECTORY_NAME:    '.lock',
} as const;

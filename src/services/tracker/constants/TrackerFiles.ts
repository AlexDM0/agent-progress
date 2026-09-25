/** The names of the tracker's own files and folders, each a bare name joined onto the directory that holds it. */
export const TRACKER_FILES = {
  PROGRESS_FILE_NAME:     'progress.json',
  HTML_FILE_NAME:         'progress.html',
  TRACKER_DIRECTORY_NAME: '.agent-progress',
  TICKETS_DIRECTORY_NAME: 'tickets',
  // Beside the tickets rather than in the repository's own tree: it is guidance for agents, not source, and the tracker is git-ignored.
  AGENT_BRIEF_FILE_NAME:  'agent-brief.md',
  LOCK_DIRECTORY_NAME:    '.lock',
} as const;

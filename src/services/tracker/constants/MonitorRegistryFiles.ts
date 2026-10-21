/** Where the machine-wide registry of every tracker whose page this machine wrote lives, under the home folder, and the version it is written in. */
export const MONITOR_REGISTRY_FILES = {
  REGISTRY_DIRECTORY_NAME: '.agent-progress-monitor',
  REGISTRY_FILE_NAME:      'projects.json',
  LOCK_DIRECTORY_NAME:     '.lock',
  ENTRIES_KEY:             'projects',
  SUPPORTED_VERSION:       1,
} as const;

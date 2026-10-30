import { join } from 'node:path';

export interface OverseerFiles {
  /** `<data>/overseer/`, made owner-only: it holds the Batons and the API token. */
  overseerDirectory: string;
  tokenFilePath:     string;
  /** `<data>/overseer.log`, appended in place. */
  logFilePath:       string;
}

export function overseerFilesIn(trackerDirectory: string): OverseerFiles {
  const overseerDirectory = join(trackerDirectory, 'overseer');
  return {
    overseerDirectory,
    tokenFilePath: join(overseerDirectory, 'token'),
    logFilePath:   join(trackerDirectory, 'overseer.log'),
  };
}

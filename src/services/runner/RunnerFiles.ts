import { join } from 'node:path';

export interface RunnerFiles {
  /** `<data>/runner/`, made owner-only: it holds the leases and the API token. */
  runnerDirectory: string;
  tokenFilePath:   string;
  /** `<data>/runner.log`, appended in place. */
  logFilePath:     string;
}

export function runnerFilesIn(trackerDirectory: string): RunnerFiles {
  const runnerDirectory = join(trackerDirectory, 'runner');
  return {
    runnerDirectory,
    tokenFilePath: join(runnerDirectory, 'token'),
    logFilePath:   join(trackerDirectory, 'runner.log'),
  };
}

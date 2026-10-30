import { join } from 'node:path';

/** Every file one Watcher instance reads or writes, all inside its job folder. */
export interface WatcherFiles {
  readonly watcherRecordPath: string;
  readonly launchPath:        string;
  readonly eventLogPath:      string;
  readonly watcherLogPath:    string;
}

export function watcherFilesOf(jobFolder: string, instance: number): WatcherFiles {
  return {
    watcherRecordPath: join(jobFolder, `watcher-${instance}.json`),
    launchPath:        join(jobFolder, `launch-${instance}.json`),
    eventLogPath:      join(jobFolder, `events-${instance}.ndjson`),
    watcherLogPath:    join(jobFolder, `watcher-${instance}.log`),
  };
}

import { join } from 'node:path';

/** Every file one host instance reads or writes, all inside its job folder. */
export interface HostFiles {
  readonly hostRecordPath: string;
  readonly launchPath:     string;
  readonly eventLogPath:   string;
  readonly hostLogPath:    string;
}

export function hostFilesOf(jobFolder: string, instance: number): HostFiles {
  return {
    hostRecordPath: join(jobFolder, `host-${instance}.json`),
    launchPath:     join(jobFolder, `launch-${instance}.json`),
    eventLogPath:   join(jobFolder, `events-${instance}.ndjson`),
    hostLogPath:    join(jobFolder, `host-${instance}.log`),
  };
}

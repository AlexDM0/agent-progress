/**
 * A scratch job folder and monitor folder for specs that spawn the Watcher binary as the Overseer does: the launch file, the spawn and a client
 * attached with the job's secret. The monitor folder has a short scratch name of its own, so a socket path under a long temporary folder
 * stays inside the 104 bytes macOS allows. Test-only.
 */
import { writeFileSync } from 'node:fs';

import type { StandingReply }                             from '../lib/watcher/StandingReplies.ts';
import { watcherFilesOf }                                 from '../lib/watcher/WatcherFiles.ts';
import type { WatcherKind }                               from '../lib/watcher/WatcherLaunch.ts';
import { watcherSocketPathOf }                            from '../lib/watcher/WatcherSocketPath.ts';
import { WATCHER_PROTOCOL_VERSION }                       from '../lib/watcher/constants/WatcherProtocol.ts';
import { createScratchDirectory, removeScratchDirectory } from './ScratchWorkspace.ts';
import { type WatcherProtocolClient, connectToWatcher }   from './WatcherProtocolClient.ts';

const WATCHER_BINARY_PATH = new URL('../../watcher.ts', import.meta.url).pathname;

export const WATCHER_JOB_SECRET = 'example-secret';
export const WATCHER_JOB_IDENTIFIER = 'J-1';
export const WATCHER_JOB_CODE_VERSION = 'code-example';

export type SpawnedWatcher = Bun.Subprocess<'ignore', 'pipe', 'pipe'>;

export interface WatcherJob {
  readonly jobFolder:       string;
  readonly monitorFolder:   string;
  readonly socketPathOf:    (instance: number) => string;
  readonly writeLaunchFile: (instance: number, kind: WatcherKind, argv: readonly string[], standingReplies?: readonly StandingReply[]) => void;
  /** A launch whose child is `bun -e <childScript>`. */
  readonly writeLaunch:     (instance: number, kind: WatcherKind, childScript: string, standingReplies?: readonly StandingReply[]) => void;
  readonly spawnWatcher:    (instance: number) => SpawnedWatcher;
  /** Connected, with `hello` sent from the given cursor and the job's secret. */
  readonly attach:          (instance: number, sinceSequence?: number) => Promise<WatcherProtocolClient>;
  readonly remove:          () => void;
}

export function createWatcherJob(): WatcherJob {
  const jobFolder = createScratchDirectory('watcher');
  const monitorFolder = createScratchDirectory('h');
  const socketPathOf = (instance: number): string => watcherSocketPathOf(monitorFolder, 'tracker-example', WATCHER_JOB_IDENTIFIER, instance);
  const writeLaunchFile: WatcherJob['writeLaunchFile'] = (instance, kind, argv, standingReplies = []) => {
    const launch = {
      kind,
      argv,
      environment:        {},
      workingDirectory:   jobFolder,
      standingReplies,
      protocolVersion:    WATCHER_PROTOCOL_VERSION,
      jobId:              WATCHER_JOB_IDENTIFIER,
      watcherCodeVersion: WATCHER_JOB_CODE_VERSION,
      socketPath:         socketPathOf(instance),
      watcherSecret:      WATCHER_JOB_SECRET,
    };
    writeFileSync(watcherFilesOf(jobFolder, instance).launchPath, JSON.stringify(launch));
  };
  return {
    jobFolder,
    monitorFolder,
    socketPathOf,
    writeLaunchFile,
    writeLaunch: (instance, kind, childScript, standingReplies = []) => {
      writeLaunchFile(instance, kind, [process.execPath, '-e', childScript], standingReplies);
    },
    spawnWatcher: (instance) => Bun.spawn([process.execPath, WATCHER_BINARY_PATH, jobFolder, String(instance)], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }),
    attach:       async (instance, sinceSequence = 0) => {
      const client = await connectToWatcher(socketPathOf(instance));
      client.send({
        kind: 'hello', protocolVersion: WATCHER_PROTOCOL_VERSION, sinceSequence, watcherSecret: WATCHER_JOB_SECRET
      });
      return client;
    },
    remove: () => {
      removeScratchDirectory(jobFolder);
      removeScratchDirectory(monitorFolder);
    },
  };
}

/**
 * A scratch job folder and monitor folder for specs that spawn the host binary as the runner does: the launch file, the spawn and a client
 * attached with the job's secret. The monitor folder has a short scratch name of its own, so a socket path under a long temporary folder
 * stays inside the 104 bytes macOS allows. Test-only.
 */
import { writeFileSync } from 'node:fs';

import { hostFilesOf }                                    from '../lib/agent-host/HostFiles.ts';
import type { HostKind }                                  from '../lib/agent-host/HostLaunch.ts';
import { hostSocketPathOf }                               from '../lib/agent-host/HostSocketPath.ts';
import type { StandingReply }                             from '../lib/agent-host/StandingReplies.ts';
import { HOST_PROTOCOL_VERSION }                          from '../lib/agent-host/constants/HostProtocol.ts';
import { type HostProtocolClient, connectToHost }         from './HostProtocolClient.ts';
import { createScratchDirectory, removeScratchDirectory } from './ScratchWorkspace.ts';

const HOST_BINARY_PATH = new URL('../../agent-host.ts', import.meta.url).pathname;

export const HOST_JOB_SECRET = 'example-secret';
export const HOST_JOB_IDENTIFIER = 'J-1';
export const HOST_JOB_CODE_VERSION = 'code-example';

export type SpawnedHost = Bun.Subprocess<'ignore', 'pipe', 'pipe'>;

export interface HostJob {
  readonly jobFolder:       string;
  readonly monitorFolder:   string;
  readonly socketPathOf:    (instance: number) => string;
  readonly writeLaunchFile: (instance: number, kind: HostKind, argv: readonly string[], standingReplies?: readonly StandingReply[]) => void;
  /** A launch whose child is `bun -e <childScript>`. */
  readonly writeLaunch:     (instance: number, kind: HostKind, childScript: string, standingReplies?: readonly StandingReply[]) => void;
  readonly spawnHost:       (instance: number) => SpawnedHost;
  /** Connected, with `hello` sent from the given cursor and the job's secret. */
  readonly attach:          (instance: number, sinceSequence?: number) => Promise<HostProtocolClient>;
  readonly remove:          () => void;
}

export function createHostJob(): HostJob {
  const jobFolder = createScratchDirectory('agent-host');
  const monitorFolder = createScratchDirectory('h');
  const socketPathOf = (instance: number): string => hostSocketPathOf(monitorFolder, 'tracker-example', HOST_JOB_IDENTIFIER, instance);
  const writeLaunchFile: HostJob['writeLaunchFile'] = (instance, kind, argv, standingReplies = []) => {
    const launch = {
      kind,
      argv,
      environment:      {},
      workingDirectory: jobFolder,
      standingReplies,
      protocolVersion:  HOST_PROTOCOL_VERSION,
      jobId:            HOST_JOB_IDENTIFIER,
      hostCodeVersion:  HOST_JOB_CODE_VERSION,
      socketPath:       socketPathOf(instance),
      hostSecret:       HOST_JOB_SECRET,
    };
    writeFileSync(hostFilesOf(jobFolder, instance).launchPath, JSON.stringify(launch));
  };
  return {
    jobFolder,
    monitorFolder,
    socketPathOf,
    writeLaunchFile,
    writeLaunch: (instance, kind, childScript, standingReplies = []) => {
      writeLaunchFile(instance, kind, [process.execPath, '-e', childScript], standingReplies);
    },
    spawnHost: (instance) => Bun.spawn([process.execPath, HOST_BINARY_PATH, jobFolder, String(instance)], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }),
    attach:    async (instance, sinceSequence = 0) => {
      const client = await connectToHost(socketPathOf(instance));
      client.send({
        kind: 'hello', protocolVersion: HOST_PROTOCOL_VERSION, sinceSequence, hostSecret: HOST_JOB_SECRET
      });
      return client;
    },
    remove: () => {
      removeScratchDirectory(jobFolder);
      removeScratchDirectory(monitorFolder);
    },
  };
}

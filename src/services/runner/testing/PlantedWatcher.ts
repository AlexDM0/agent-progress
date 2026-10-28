/**
 * A job folder whose Watcher reads as live, this test process standing in for it, and a socket that answers in its place: a spec sends to
 * it before it listens to see a refused connection, then listens to see which frames arrive.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer }             from 'node:net';
import { dirname }                  from 'node:path';

import { hostFilesOf }                                     from '../../../lib/agent-host/HostFiles.ts';
import { readHostLaunch }                                  from '../../../lib/agent-host/HostLaunch.ts';
import { type HostRecord, hostRecordTextOf }               from '../../../lib/agent-host/HostRecord.ts';
import { EVENT_LOG_FORMAT_VERSION, HOST_PROTOCOL_VERSION } from '../../../lib/agent-host/constants/HostProtocol.ts';
import { identityOf }                                      from '../../../lib/process-identity/ProcessIdentity.ts';
import { HostFleet }                                       from '../HostFleet.ts';

export interface PlantedWatcherRequest {
  trackerDirectory: string;
  monitorFolder:    string;
  jobId:            string;
  instance:         number;
}

/** Writes the instance's launch file and a host record naming this process, answering the socket path the launch file names. */
function plantLiveWatcher(request: PlantedWatcherRequest): string {
  const jobFolder = HostFleet.jobFolderOf(request.trackerDirectory, request.jobId);
  HostFleet.writeLaunchFiles({
    jobFolder,
    instance:         request.instance,
    jobId:            request.jobId,
    trackerId:        'example-tracker',
    monitorFolder:    request.monitorFolder,
    hostCodeVersion:  'code-example',
    workingDirectory: request.trackerDirectory,
    plan:             {
      argv: ['true'], environment: {}, files: [], standingReplies: []
    },
  });
  const record: HostRecord = {
    protocolVersion: HOST_PROTOCOL_VERSION, eventLogFormatVersion: EVENT_LOG_FORMAT_VERSION, hostInstance: request.instance, state: 'running', host: identityOf(process.pid),
  };
  writeFileSync(hostFilesOf(jobFolder, request.instance).hostRecordPath, hostRecordTextOf(record));
  const reading = readHostLaunch(hostFilesOf(jobFolder, request.instance).launchPath);
  if (reading.verdict !== 'read') throw new Error('the planted launch file is unreadable');
  return reading.launch.socketPath;
}

/** Listens on the socket while `during` runs, answering every frame line it received, the hello included. */
async function framesReceivedWhile(socketPath: string, during: () => Promise<void>): Promise<readonly string[]> {
  const received: string[] = [];
  const watcher = createServer((socket) => socket.on('data', (chunk) => received.push(chunk.toString())));
  mkdirSync(dirname(socketPath), { recursive: true });
  await new Promise<void>((resolve) => watcher.listen(socketPath, resolve));
  try {
    await during();
  } finally {
    await new Promise<void>((resolve) => watcher.close(() => resolve()));
  }
  return received.join('').split('\n').filter((line) => line !== '');
}

export const PlantedWatcher = Object.freeze({ plantLiveWatcher, framesReceivedWhile });

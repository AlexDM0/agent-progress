/**
 * The runner's side of its hosts, read and spawned through the job folder `<data>/jobs/<J>/` alone: whether a host instance is live by
 * the identity in its claimed host file, the events it logged past a cursor, and the spawn of a new instance from the pinned bundle,
 * detached in its own process group so it outlives the runner.
 */
import { spawn }       from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync
} from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join }    from 'node:path';

import type { ActingFrame }                      from '../../lib/agent-host/@types/HostFrame.ts';
import { type EventLogEntry, eventLogEntriesOf } from '../../lib/agent-host/EventLog.ts';
import { hostFilesOf }                           from '../../lib/agent-host/HostFiles.ts';
import { type HostLaunch, readHostLaunch }       from '../../lib/agent-host/HostLaunch.ts';
import type { HostEnd, HostRecord }              from '../../lib/agent-host/HostRecord.ts';
import { hostSocketPathOf }                      from '../../lib/agent-host/HostSocketPath.ts';
import { HOST_PROTOCOL_VERSION }                 from '../../lib/agent-host/constants/HostProtocol.ts';
import type { AgentLaunchPlan }                  from '../../lib/agent-launch/AgentLaunchPlan.ts';
import { writeFileAtomically }                   from '../../lib/atomic-file/AtomicFile.ts';
import { identityOf, sameProcess }               from '../../lib/process-identity/ProcessIdentity.ts';

export type HostLiveness =
  | { verdict: 'unclaimed' }
  | { verdict: 'live' }
  | { verdict: 'ended'; end: HostEnd }
  /** Claimed, never recorded as ended, and its process is gone: a host killed or lost to a reboot. */
  | { verdict: 'lost' };

export interface HostSpawnRequest {
  bundlePath: string;
  jobFolder:  string;
  instance:   number;
}

export interface HostLaunchFileRequest {
  jobFolder:        string;
  instance:         number;
  jobId:            string;
  trackerId:        string;
  monitorFolder:    string;
  hostCodeVersion:  string;
  workingDirectory: string;
  plan:             AgentLaunchPlan;
}

const HOST_SECRET_BYTES = 24;

/** How long the runner waits on a host to take its frames; a schedule only, never a decision. */
const HOST_FRAME_TIMEOUT_MILLISECONDS = 2000;

function jobFolderOf(trackerDirectory: string, jobId: string): string {
  return join(trackerDirectory, 'jobs', jobId);
}

function hostRecordOf(jobFolder: string, instance: number): HostRecord | null {
  try {
    return JSON.parse(readFileSync(hostFilesOf(jobFolder, instance).hostRecordPath, 'utf8')) as HostRecord;
  } catch {
    return null;
  }
}

/** The host's own identity decides, never a clock: a reused process id or a reboot reads as lost. */
function livenessOf(jobFolder: string, instance: number): HostLiveness {
  if (!existsSync(hostFilesOf(jobFolder, instance).hostRecordPath)) return { verdict: 'unclaimed' };
  const record = hostRecordOf(jobFolder, instance);
  if (record?.end !== undefined) return { verdict: 'ended', end: record.end };
  // A claim being replaced atomically is never half-read, so an unreadable record is a host that died mid-claim.
  if (record === null || record.host === null) return { verdict: 'lost' };
  const current = identityOf(record.host.processId);
  return current !== null && sameProcess(current, record.host) ? { verdict: 'live' } : { verdict: 'lost' };
}

/** Every entry past `afterSequence`; a malformed log is reported to the caller rather than read in part. */
function eventsAfter(jobFolder: string, instance: number, afterSequence: number): readonly EventLogEntry[] | 'malformed' {
  let text: string;
  try {
    text = readFileSync(hostFilesOf(jobFolder, instance).eventLogPath, 'utf8');
  } catch {
    return [];
  }
  const reading = eventLogEntriesOf(text);
  if (reading.verdict === 'malformed') return 'malformed';
  return reading.entries.filter((entry) => entry.sequence > afterSequence);
}

/** Written fresh for each instance, and the only file holding its host secret. */
function writeLaunchFiles(request: HostLaunchFileRequest): void {
  mkdirSync(request.jobFolder, { recursive: true });
  for (const file of request.plan.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileAtomically(file.path, file.text);
  }
  const launch: HostLaunch = {
    kind:             'agent',
    argv:             request.plan.argv,
    environment:      request.plan.environment,
    workingDirectory: request.workingDirectory,
    standingReplies:  request.plan.standingReplies,
    protocolVersion:  HOST_PROTOCOL_VERSION,
    jobId:            request.jobId,
    hostCodeVersion:  request.hostCodeVersion,
    socketPath:       hostSocketPathOf(request.monitorFolder, request.trackerId, request.jobId, request.instance),
    hostSecret:       randomBytes(HOST_SECRET_BYTES).toString('hex'),
  };
  writeFileAtomically(hostFilesOf(request.jobFolder, request.instance).launchPath, `${JSON.stringify(launch, null, 2)}\n`);
}

export interface ProcessLaunchFileRequest {
  hostFolder:       string;
  instance:         number;
  jobId:            string;
  /** Names the socket apart from the job's agent host and its other process hosts. */
  socketName:       string;
  trackerId:        string;
  monitorFolder:    string;
  hostCodeVersion:  string;
  workingDirectory: string;
  argv:             readonly string[];
  environment:      Readonly<Record<string, string>>;
}

/** A process host's launch: no standing replies and no input, its child's output logged as events. */
function writeProcessLaunchFile(request: ProcessLaunchFileRequest): void {
  mkdirSync(request.hostFolder, { recursive: true });
  const launch: HostLaunch = {
    kind:             'process',
    argv:             request.argv,
    environment:      request.environment,
    workingDirectory: request.workingDirectory,
    standingReplies:  [],
    protocolVersion:  HOST_PROTOCOL_VERSION,
    jobId:            request.jobId,
    hostCodeVersion:  request.hostCodeVersion,
    socketPath:       hostSocketPathOf(request.monitorFolder, request.trackerId, request.socketName, request.instance),
    hostSecret:       randomBytes(HOST_SECRET_BYTES).toString('hex'),
  };
  writeFileAtomically(hostFilesOf(request.hostFolder, request.instance).launchPath, `${JSON.stringify(launch, null, 2)}\n`);
}

/** Says hello with the instance's secret, sends the frames and hangs up; a host that is gone or never answers is left alone. */
async function sendFrames(jobFolder: string, instance: number, frames: readonly ActingFrame[]): Promise<void> {
  const reading = readHostLaunch(hostFilesOf(jobFolder, instance).launchPath);
  if (reading.verdict !== 'read') return;
  const { socketPath, hostSecret } = reading.launch;
  await new Promise<void>((resolve) => {
    const socket = createConnection(socketPath);
    const settle = (): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    };
    const timer = setTimeout(settle, HOST_FRAME_TIMEOUT_MILLISECONDS);
    socket.once('error', settle);
    socket.once('close', settle);
    socket.once('connect', () => {
      const hello = {
        kind: 'hello', protocolVersion: HOST_PROTOCOL_VERSION, sinceSequence: Number.MAX_SAFE_INTEGER, hostSecret
      };
      socket.end([hello, ...frames].map((frame) => `${JSON.stringify(frame)}\n`).join(''));
    });
  });
}

/** `process.execPath <bundle> <job folder> <instance>`, detached and unreferenced, its output appended to the instance's host log. */
function spawnHost(request: HostSpawnRequest): number | undefined {
  const logDescriptor = openSync(hostFilesOf(request.jobFolder, request.instance).hostLogPath, 'a');
  try {
    const host = spawn(process.execPath, [request.bundlePath, request.jobFolder, String(request.instance)], {
      detached: true,
      stdio:    ['ignore', logDescriptor, logDescriptor],
    });
    host.unref();
    return host.pid;
  } finally {
    closeSync(logDescriptor);
  }
}

export const HostFleet = Object.freeze({
  jobFolderOf, livenessOf, eventsAfter, writeLaunchFiles, writeProcessLaunchFile, sendFrames, spawnHost
});

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
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join }    from 'node:path';

import type { ActingFrame }                                from '../../lib/agent-host/@types/HostFrame.ts';
import type { EventLogEntry }                              from '../../lib/agent-host/EventLog.ts';
import { hostFilesOf }                                     from '../../lib/agent-host/HostFiles.ts';
import { type HostLaunch, readHostLaunch }                 from '../../lib/agent-host/HostLaunch.ts';
import type { HostEnd, HostRecord }                        from '../../lib/agent-host/HostRecord.ts';
import { hostSocketPathOf }                                from '../../lib/agent-host/HostSocketPath.ts';
import { EVENT_LOG_FORMAT_VERSION, HOST_PROTOCOL_VERSION } from '../../lib/agent-host/constants/HostProtocol.ts';
import type { AgentLaunchPlan }                            from '../../lib/agent-launch/AgentLaunchPlan.ts';
import { writeFileAtomically }                             from '../../lib/atomic-file/AtomicFile.ts';
import { identityOf, sameProcess }                         from '../../lib/process-identity/ProcessIdentity.ts';
import { LegacyHostReader }                                from './LegacyHostReader.ts';

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

/** How long `stopLiveProcessHosts` waits on the hosts it stopped to record their end; a schedule only. */
const STOPPED_HOST_WAIT_TRIES = 100;
const STOPPED_HOST_WAIT_INTERVAL_MILLISECONDS = 20;

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
  const formatVersion = hostRecordOf(jobFolder, instance)?.eventLogFormatVersion ?? EVENT_LOG_FORMAT_VERSION;
  const reading       = LegacyHostReader.eventLogReadingOf(text, formatVersion);
  if (reading.verdict !== 'read') return 'malformed';
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

/** Says hello with the instance's secret, sends the frames and hangs up, answering whether it connected; a host gone or silent is left alone.
 * A legacy host is sent nothing: only a `stop` reaches it, as a signal to its recorded process group. */
async function sendFrames(jobFolder: string, instance: number, frames: readonly ActingFrame[]): Promise<boolean> {
  const record = hostRecordOf(jobFolder, instance);
  if (LegacyHostReader.attachmentOf(record) === 'legacy-host') {
    return record !== null && frames.some((frame) => frame.kind === 'stop') && LegacyHostReader.stopLegacyHost(record);
  }
  const reading = readHostLaunch(hostFilesOf(jobFolder, instance).launchPath);
  if (reading.verdict !== 'read') return false;
  const { socketPath, hostSecret } = reading.launch;
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    let connected = false;
    const settle = (): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(connected);
    };
    const timer = setTimeout(settle, HOST_FRAME_TIMEOUT_MILLISECONDS);
    socket.once('error', settle);
    socket.once('close', settle);
    socket.once('connect', () => {
      connected = true;
      const hello = {
        kind: 'hello', protocolVersion: HOST_PROTOCOL_VERSION, sinceSequence: Number.MAX_SAFE_INTEGER, hostSecret
      };
      socket.end([hello, ...frames].map((frame) => `${JSON.stringify(frame)}\n`).join(''));
    });
  });
}

/**
 * Sends the frames to a live Watcher unless its marker is there, writing the marker only once the Watcher took them: a send that failed is
 * tried again on a later pass while the Watcher is live, and a taken frame is never sent twice, across an Overseer restart too.
 */
async function sendFramesOnce(markerPath: string, jobFolder: string, instance: number, frames: readonly ActingFrame[]): Promise<boolean> {
  if (existsSync(markerPath) || livenessOf(jobFolder, instance).verdict !== 'live') return false;
  if (!await sendFrames(jobFolder, instance, frames)) return false;
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, '');
  return true;
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

const HOST_RECORD_FILE_PATTERN = /^host-(?<instance>\d+)\.json$/;

function claimedInstancesIn(hostFolder: string): number[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(hostFolder);
  } catch {
    return [];
  }
  return fileNames.flatMap((fileName) => {
    const instance = HOST_RECORD_FILE_PATTERN.exec(fileName)?.groups?.['instance'];
    return instance === undefined ? [] : [Number(instance)];
  });
}

/** Whether the record says ended while the very process it names still runs: an ended host lingering for its acknowledgement. */
function endedHostStillRuns(record: HostRecord | null): record is HostRecord & { host: NonNullable<HostRecord['host']> } {
  if (record?.end === undefined || record.host === null) return false;
  const current = identityOf(record.host.processId);
  return current !== null && sameProcess(current, record.host);
}

/**
 * Acknowledges the end of every ended host in the job folder and its process hosts' subfolders that still runs, so it exits: `close-input`
 * to an agent host, `stop` to a process host. A legacy host is left alone. Answers how many took the acknowledgement.
 */
async function reapEndedHostsIn(jobFolder: string): Promise<number> {
  let reaped = 0;
  for (const hostFolder of hostFoldersOf(jobFolder)) {
    for (const instance of claimedInstancesIn(hostFolder)) {
      const record = hostRecordOf(hostFolder, instance);
      if (!endedHostStillRuns(record) || LegacyHostReader.attachmentOf(record) === 'legacy-host') continue;
      const reading = readHostLaunch(hostFilesOf(hostFolder, instance).launchPath);
      if (reading.verdict !== 'read') continue;
      const acknowledgement: ActingFrame = reading.launch.kind === 'agent' ? { kind: 'close-input' } : { kind: 'stop', graceMilliseconds: 0 };
      if (await sendFrames(hostFolder, instance, [acknowledgement])) reaped += 1;
    }
  }
  return reaped;
}

/** Every job folder of the tracker, swept as `reapEndedHostsIn` says. */
async function reapEndedHosts(trackerDirectory: string): Promise<number> {
  let reaped = 0;
  for (const jobFolder of jobFoldersOf(trackerDirectory)) reaped += await reapEndedHostsIn(jobFolder);
  return reaped;
}

/**
 * Sends `stop` with no grace to every live process host of the tracker's jobs, an install or a gate, and waits a bounded number of tries for
 * each to record its end, so the reap after it acknowledges them. An agent host and a legacy host are left alone. Answers how many took it.
 */
async function stopLiveProcessHosts(trackerDirectory: string): Promise<number> {
  const stopped: { hostFolder: string; instance: number }[] = [];
  for (const jobFolder of jobFoldersOf(trackerDirectory)) {
    for (const hostFolder of hostFoldersOf(jobFolder)) {
      for (const instance of claimedInstancesIn(hostFolder)) {
        if (livenessOf(hostFolder, instance).verdict !== 'live') continue;
        if (LegacyHostReader.attachmentOf(hostRecordOf(hostFolder, instance)) === 'legacy-host') continue;
        const reading = readHostLaunch(hostFilesOf(hostFolder, instance).launchPath);
        if (reading.verdict !== 'read' || reading.launch.kind !== 'process') continue;
        if (await sendFrames(hostFolder, instance, [{ kind: 'stop', graceMilliseconds: 0 }])) stopped.push({ hostFolder, instance });
      }
    }
  }
  // The tries only bound the wait; whether a host ended is its own record.
  for (let attempt = 0; attempt < STOPPED_HOST_WAIT_TRIES; attempt += 1) {
    if (stopped.every(({ hostFolder, instance }) => livenessOf(hostFolder, instance).verdict !== 'live')) break;
    await Bun.sleep(STOPPED_HOST_WAIT_INTERVAL_MILLISECONDS);
  }
  return stopped.length;
}

function jobFoldersOf(trackerDirectory: string): string[] {
  try {
    return readdirSync(join(trackerDirectory, 'jobs')).map((jobId) => jobFolderOf(trackerDirectory, jobId));
  } catch {
    return [];
  }
}

/** The job folder itself, holding its agent host, and each subfolder, holding a process host. */
function hostFoldersOf(jobFolder: string): string[] {
  try {
    const subfolderNames = readdirSync(jobFolder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    return [jobFolder, ...subfolderNames.map((name) => join(jobFolder, name))];
  } catch {
    return [];
  }
}

export const HostFleet = Object.freeze({
  jobFolderOf,
  hostRecordOf,
  livenessOf,
  eventsAfter,
  writeLaunchFiles,
  writeProcessLaunchFile,
  sendFrames,
  sendFramesOnce,
  spawnHost,
  reapEndedHostsIn,
  reapEndedHosts,
  stopLiveProcessHosts,
});

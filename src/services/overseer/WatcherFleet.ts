/**
 * The Overseer's side of its Watchers, read and spawned through the job folder `<data>/jobs/<J>/` alone: whether a Watcher instance is live by
 * the identity in its claimed Watcher file, the events it logged past a cursor, and the spawn of a new instance from the pinned bundle,
 * detached in its own process group so it outlives the Overseer.
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

import type { AgentLaunchPlan }                               from '../../lib/agent-launch/AgentLaunchPlan.ts';
import { writeFileAtomically }                                from '../../lib/atomic-file/AtomicFile.ts';
import { identityOf, sameProcess }                            from '../../lib/process-identity/ProcessIdentity.ts';
import type { ActingFrame }                                   from '../../lib/watcher/@types/WatcherFrame.ts';
import type { EventLogEntry }                                 from '../../lib/watcher/EventLog.ts';
import { watcherFilesOf }                                     from '../../lib/watcher/WatcherFiles.ts';
import { type WatcherLaunch, readWatcherLaunch }              from '../../lib/watcher/WatcherLaunch.ts';
import type { WatcherEnd, WatcherRecord }                     from '../../lib/watcher/WatcherRecord.ts';
import { watcherSocketPathOf }                                from '../../lib/watcher/WatcherSocketPath.ts';
import { EVENT_LOG_FORMAT_VERSION, WATCHER_PROTOCOL_VERSION } from '../../lib/watcher/constants/WatcherProtocol.ts';
import { LegacyWatcherReader }                                from './LegacyWatcherReader.ts';

export type WatcherLiveness =
  | { verdict: 'unclaimed' }
  | { verdict: 'live' }
  | { verdict: 'ended'; end: WatcherEnd }
  /** Claimed, never recorded as ended, and its process is gone: a Watcher killed or lost to a reboot. */
  | { verdict: 'lost' };

export interface WatcherSpawnRequest {
  bundlePath: string;
  jobFolder:  string;
  instance:   number;
}

export interface WatcherLaunchFileRequest {
  jobFolder:          string;
  instance:           number;
  jobId:              string;
  trackerId:          string;
  monitorFolder:      string;
  watcherCodeVersion: string;
  workingDirectory:   string;
  plan:               AgentLaunchPlan;
}

const WATCHER_SECRET_BYTES = 24;

/** How long the Overseer waits on a Watcher to take its frames; a schedule only, never a decision. */
const WATCHER_FRAME_TIMEOUT_MILLISECONDS = 2000;

/** How long `stopLiveProcessHosts` waits on the Watchers it stopped to record their end; a schedule only. */
const STOPPED_WATCHER_WAIT_TRIES = 100;
const STOPPED_WATCHER_WAIT_INTERVAL_MILLISECONDS = 20;

function jobFolderOf(trackerDirectory: string, jobId: string): string {
  return join(trackerDirectory, 'jobs', jobId);
}

function watcherRecordOf(jobFolder: string, instance: number): WatcherRecord | null {
  try {
    return JSON.parse(readFileSync(watcherFilesOf(jobFolder, instance).watcherRecordPath, 'utf8')) as WatcherRecord;
  } catch {
    return null;
  }
}

/** The Watcher's own identity decides, never a clock: a reused process id or a reboot reads as lost. */
function livenessOf(jobFolder: string, instance: number): WatcherLiveness {
  if (!existsSync(watcherFilesOf(jobFolder, instance).watcherRecordPath)) return { verdict: 'unclaimed' };
  const record = watcherRecordOf(jobFolder, instance);
  if (record?.end !== undefined) return { verdict: 'ended', end: record.end };
  // A claim being replaced atomically is never half-read, so an unreadable record is a Watcher that died mid-claim.
  if (record === null || record.watcher === null) return { verdict: 'lost' };
  const current = identityOf(record.watcher.processId);
  return current !== null && sameProcess(current, record.watcher) ? { verdict: 'live' } : { verdict: 'lost' };
}

/** Every entry past `afterSequence`; a malformed log is reported to the caller rather than read in part. */
function eventsAfter(jobFolder: string, instance: number, afterSequence: number): readonly EventLogEntry[] | 'malformed' {
  let text: string;
  try {
    text = readFileSync(watcherFilesOf(jobFolder, instance).eventLogPath, 'utf8');
  } catch {
    return [];
  }
  const formatVersion = watcherRecordOf(jobFolder, instance)?.eventLogFormatVersion ?? EVENT_LOG_FORMAT_VERSION;
  const reading       = LegacyWatcherReader.eventLogReadingOf(text, formatVersion);
  if (reading.verdict !== 'read') return 'malformed';
  return reading.entries.filter((entry) => entry.sequence > afterSequence);
}

/** Written fresh for each instance, and the only file holding its Watcher secret. */
function writeLaunchFiles(request: WatcherLaunchFileRequest): void {
  mkdirSync(request.jobFolder, { recursive: true });
  for (const file of request.plan.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileAtomically(file.path, file.text);
  }
  const launch: WatcherLaunch = {
    kind:               'agent',
    argv:               request.plan.argv,
    environment:        request.plan.environment,
    workingDirectory:   request.workingDirectory,
    standingReplies:    request.plan.standingReplies,
    protocolVersion:    WATCHER_PROTOCOL_VERSION,
    jobId:              request.jobId,
    watcherCodeVersion: request.watcherCodeVersion,
    socketPath:         watcherSocketPathOf(request.monitorFolder, request.trackerId, request.jobId, request.instance),
    watcherSecret:      randomBytes(WATCHER_SECRET_BYTES).toString('hex'),
  };
  writeFileAtomically(watcherFilesOf(request.jobFolder, request.instance).launchPath, `${JSON.stringify(launch, null, 2)}\n`);
}

export interface ProcessLaunchFileRequest {
  watcherFolder:      string;
  instance:           number;
  jobId:              string;
  /** Names the socket apart from the job's Watcher and its other process Watchers. */
  socketName:         string;
  trackerId:          string;
  monitorFolder:      string;
  watcherCodeVersion: string;
  workingDirectory:   string;
  argv:               readonly string[];
  environment:        Readonly<Record<string, string>>;
}

/** A process Watcher's launch: no standing replies and no input, its child's output logged as events. */
function writeProcessLaunchFile(request: ProcessLaunchFileRequest): void {
  mkdirSync(request.watcherFolder, { recursive: true });
  const launch: WatcherLaunch = {
    kind:               'process',
    argv:               request.argv,
    environment:        request.environment,
    workingDirectory:   request.workingDirectory,
    standingReplies:    [],
    protocolVersion:    WATCHER_PROTOCOL_VERSION,
    jobId:              request.jobId,
    watcherCodeVersion: request.watcherCodeVersion,
    socketPath:         watcherSocketPathOf(request.monitorFolder, request.trackerId, request.socketName, request.instance),
    watcherSecret:      randomBytes(WATCHER_SECRET_BYTES).toString('hex'),
  };
  writeFileAtomically(watcherFilesOf(request.watcherFolder, request.instance).launchPath, `${JSON.stringify(launch, null, 2)}\n`);
}

/** Says hello with the instance's secret, sends the frames and hangs up, answering whether it connected; a Watcher gone or silent is left alone.
 * A legacy Watcher is sent nothing: only a `stop` reaches it, as a signal to its recorded process group. */
async function sendFrames(jobFolder: string, instance: number, frames: readonly ActingFrame[]): Promise<boolean> {
  const record = watcherRecordOf(jobFolder, instance);
  if (LegacyWatcherReader.attachmentOf(record) === 'legacy-watcher') {
    return record !== null && frames.some((frame) => frame.kind === 'stop') && LegacyWatcherReader.stopLegacyWatcher(record);
  }
  const reading = readWatcherLaunch(watcherFilesOf(jobFolder, instance).launchPath);
  if (reading.verdict !== 'read') return false;
  const { socketPath, watcherSecret } = reading.launch;
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    let connected = false;
    const settle = (): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(connected);
    };
    const timer = setTimeout(settle, WATCHER_FRAME_TIMEOUT_MILLISECONDS);
    socket.once('error', settle);
    socket.once('close', settle);
    socket.once('connect', () => {
      connected = true;
      const hello = {
        kind: 'hello', protocolVersion: WATCHER_PROTOCOL_VERSION, sinceSequence: Number.MAX_SAFE_INTEGER, watcherSecret
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

/** `process.execPath <bundle> <job folder> <instance>`, detached and unreferenced, its output appended to the instance's Watcher log. */
function spawnWatcher(request: WatcherSpawnRequest): number | undefined {
  const logDescriptor = openSync(watcherFilesOf(request.jobFolder, request.instance).watcherLogPath, 'a');
  try {
    const watcher = spawn(process.execPath, [request.bundlePath, request.jobFolder, String(request.instance)], {
      detached: true,
      stdio:    ['ignore', logDescriptor, logDescriptor],
    });
    watcher.unref();
    return watcher.pid;
  } finally {
    closeSync(logDescriptor);
  }
}

const WATCHER_RECORD_FILE_PATTERN = /^watcher-(?<instance>\d+)\.json$/;

function claimedInstancesIn(watcherFolder: string): number[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(watcherFolder);
  } catch {
    return [];
  }
  return fileNames.flatMap((fileName) => {
    const instance = WATCHER_RECORD_FILE_PATTERN.exec(fileName)?.groups?.['instance'];
    return instance === undefined ? [] : [Number(instance)];
  });
}

/** Whether the record says ended while the very process it names still runs: an ended Watcher lingering for its acknowledgement. */
function endedWatcherStillRuns(record: WatcherRecord | null): record is WatcherRecord & { watcher: NonNullable<WatcherRecord['watcher']> } {
  if (record?.end === undefined || record.watcher === null) return false;
  const current = identityOf(record.watcher.processId);
  return current !== null && sameProcess(current, record.watcher);
}

/**
 * Acknowledges the end of every ended Watcher in the job folder and its process watchers' subfolders that still runs, so it exits: `close-input`
 * to a Watcher, `stop` to a process Watcher. A legacy Watcher is left alone. Answers how many took the acknowledgement.
 */
async function reapEndedHostsIn(jobFolder: string): Promise<number> {
  let reaped = 0;
  for (const watcherFolder of watcherFoldersOf(jobFolder)) {
    for (const instance of claimedInstancesIn(watcherFolder)) {
      const record = watcherRecordOf(watcherFolder, instance);
      if (!endedWatcherStillRuns(record) || LegacyWatcherReader.attachmentOf(record) === 'legacy-watcher') continue;
      const reading = readWatcherLaunch(watcherFilesOf(watcherFolder, instance).launchPath);
      if (reading.verdict !== 'read') continue;
      const acknowledgement: ActingFrame = reading.launch.kind === 'agent' ? { kind: 'close-input' } : { kind: 'stop', graceMilliseconds: 0 };
      if (await sendFrames(watcherFolder, instance, [acknowledgement])) reaped += 1;
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
 * Sends `stop` with no grace to every live process Watcher of the tracker's jobs, an install or a gate, and waits a bounded number of tries for
 * each to record its end, so the reap after it acknowledges them. A Watcher and a legacy Watcher are left alone. Answers how many took it.
 */
async function stopLiveProcessHosts(trackerDirectory: string): Promise<number> {
  const stopped: { watcherFolder: string; instance: number }[] = [];
  for (const jobFolder of jobFoldersOf(trackerDirectory)) {
    for (const watcherFolder of watcherFoldersOf(jobFolder)) {
      for (const instance of claimedInstancesIn(watcherFolder)) {
        if (livenessOf(watcherFolder, instance).verdict !== 'live') continue;
        if (LegacyWatcherReader.attachmentOf(watcherRecordOf(watcherFolder, instance)) === 'legacy-watcher') continue;
        const reading = readWatcherLaunch(watcherFilesOf(watcherFolder, instance).launchPath);
        if (reading.verdict !== 'read' || reading.launch.kind !== 'process') continue;
        if (await sendFrames(watcherFolder, instance, [{ kind: 'stop', graceMilliseconds: 0 }])) stopped.push({ watcherFolder, instance });
      }
    }
  }
  // The tries only bound the wait; whether a Watcher ended is its own record.
  for (let attempt = 0; attempt < STOPPED_WATCHER_WAIT_TRIES; attempt += 1) {
    if (stopped.every(({ watcherFolder, instance }) => livenessOf(watcherFolder, instance).verdict !== 'live')) break;
    await Bun.sleep(STOPPED_WATCHER_WAIT_INTERVAL_MILLISECONDS);
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

/** The job folder itself, holding its Watcher, and each subfolder, holding a process Watcher. */
function watcherFoldersOf(jobFolder: string): string[] {
  try {
    const subfolderNames = readdirSync(jobFolder, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    return [jobFolder, ...subfolderNames.map((name) => join(jobFolder, name))];
  } catch {
    return [];
  }
}

export const WatcherFleet = Object.freeze({
  jobFolderOf,
  watcherRecordOf,
  livenessOf,
  eventsAfter,
  writeLaunchFiles,
  writeProcessLaunchFile,
  sendFrames,
  sendFramesOnce,
  spawnWatcher,
  reapEndedHostsIn,
  reapEndedHosts,
  stopLiveProcessHosts,
});

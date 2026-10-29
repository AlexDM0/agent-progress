/**
 * A thin host: claims one instance of a job by creating its host file exclusively, runs the one child its launch file names detached in
 * a process group of its own, logs every line to and from it, speaks protocol 1 on its socket, and records how the child ended. It writes
 * its job folder, its socket and the child's stdin and nothing else. It depends on `src/lib/atomic-file` and `src/lib/process-identity`.
 */
import { closeSync, openSync, readFileSync } from 'node:fs';

import { createFileAtomically, writeFileAtomically }            from '../atomic-file/AtomicFile.ts';
import { type ProcessIdentity, identityOf, signalProcessGroup } from '../process-identity/ProcessIdentity.ts';
import type { ActingFrame, HostActivity }                       from './@types/HostFrame.ts';
import {
  type EventLogEntry,
  type EventLogWriter,
  type EventOrigin,
  createEventLogWriter,
  eventLogEntriesOf
} from './EventLog.ts';
import { type HostFiles, hostFilesOf }                                         from './HostFiles.ts';
import { type HostLaunch, readHostLaunch }                                     from './HostLaunch.ts';
import { type HostEnd, type HostRecord, hostRecordTextOf }                     from './HostRecord.ts';
import { prepareSocketFolder }                                                 from './HostSocketPath.ts';
import { type HostSocketServer, listenOnHostSocket }                           from './HostSocketServer.ts';
import { standingReplyFor }                                                    from './StandingReplies.ts';
import { EVENT_LOG_FORMAT_VERSION, HOST_LINGER_FRAMES, HOST_PROTOCOL_VERSION } from './constants/HostProtocol.ts';

const HOST_DONE_EXIT_CODE    = 0;
const HOST_REFUSED_EXIT_CODE = 1;

const INSTANCE_PATTERN = /^[1-9]\d*$/;

const STDOUT_LINE_SEPARATOR = '\n';

const AGENT_HOST_FRAMES: readonly ActingFrame['kind'][] = ['write', 'close-input', 'stop'];
const PROCESS_HOST_FRAMES: readonly ActingFrame['kind'][] = ['stop'];

interface ChildStdin {
  readonly write: (text: string) => unknown;
  readonly flush: () => unknown;
  readonly end:   () => unknown;
}

function writeLineToChild(stdin: ChildStdin | null, line: string): void {
  if (stdin === null) return;
  try {
    stdin.write(`${line}\n`);
    stdin.flush();
  } catch {
    // A child that closed its stdin or exited ends the run through its exit, not through this write.
  }
}

function closeChildInput(stdin: ChildStdin | null): void {
  if (stdin === null) return;
  try {
    stdin.end();
  } catch {
    // Already closed, by an earlier frame or by the child's exit.
  }
}

/** Each complete line of the stream as it arrives, then an unterminated tail as the last line. */
async function forEachLine(stream: ReadableStream<Uint8Array>, consumeLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    let separatorIndex = pending.indexOf(STDOUT_LINE_SEPARATOR);
    while (separatorIndex !== -1) {
      consumeLine(pending.slice(0, separatorIndex));
      pending = pending.slice(separatorIndex + 1);
      separatorIndex = pending.indexOf(STDOUT_LINE_SEPARATOR);
    }
  }
  pending += decoder.decode();
  if (pending.length > 0) consumeLine(pending);
}

function endedRecordOf(record: HostRecord, end: HostEnd): HostRecord {
  return { ...record, state: 'ended', end };
}

function readDurableEntries(eventLogPath: string): readonly EventLogEntry[] {
  const reading = eventLogEntriesOf(readFileSync(eventLogPath, 'utf8'));
  // Only this host writes the log, so a malformed line is damage on the disk; the live messages still reach the client.
  return reading.verdict === 'read' ? reading.entries : [];
}

/** What the child's supervision and the socket share while the child runs and after it ended. */
interface HostSession {
  activity:        HostActivity;
  childStdin:      ChildStdin | null;
  childLeader:     ProcessIdentity | null;
  end:             HostEnd | null;
  lingerFrames:    number;
  logClosed:       boolean;
  finishLinger:    () => void;
  /** Settles once a stop sent its last signal; `null` while no stop was asked for. */
  stopSignalsSent: Promise<void> | null;
}

function createHostSession(): { session: HostSession; lingered: Promise<void> } {
  let finishLinger = (): void => undefined;
  const lingered = new Promise<void>((resolve) => {
    finishLinger = resolve;
  });
  return {
    session: {
      activity: 'idle', childStdin: null, childLeader: null, end: null, lingerFrames: 0, logClosed: false, finishLinger, stopSignalsSent: null,
    },
    lingered,
  };
}

interface HostParts {
  readonly launch:   HostLaunch;
  readonly files:    HostFiles;
  readonly eventLog: EventLogWriter;
  readonly session:  HostSession;
  readonly server:   HostSocketServer;
}

function appendAndBroadcast(parts: HostParts, origin: EventOrigin, line: string): void {
  const entry = parts.eventLog.append(origin, line);
  parts.server.broadcast({ kind: 'message', entry });
}

function changeActivity(parts: HostParts, activity: HostActivity): void {
  if (parts.session.activity === activity) return;
  parts.session.activity = activity;
  parts.server.broadcast({ kind: 'state', state: activity, ...(parts.session.end === null ? {} : { end: parts.session.end }) });
}

function signalChildGroup(session: HostSession, signal: NodeJS.Signals): void {
  if (session.childLeader === null) return;
  signalProcessGroup(session.childLeader, signal);
}

/**
 * Closes stdin at once, then SIGTERM and SIGKILL to the child's group each after the grace, also once the child itself ended, so a
 * member that outlives it is killed; the host exits only after both.
 */
function stopChild(parts: HostParts, graceMilliseconds: number): void {
  const { session } = parts;
  if (session.activity === 'stopping') return;
  changeActivity(parts, 'stopping');
  closeChildInput(session.childStdin);
  // The graces only schedule the signals; whether to send one is the group's checked identity.
  session.stopSignalsSent = new Promise((resolve) => {
    setTimeout(() => {
      signalChildGroup(session, 'SIGTERM');
      setTimeout(() => {
        signalChildGroup(session, 'SIGKILL');
        resolve();
      }, graceMilliseconds);
    }, graceMilliseconds);
  });
}

/** An ended host acts on nothing; the acknowledgement is `close-input` for an agent host and `stop` for a process host. */
function actOnFrame(parts: HostParts, frame: ActingFrame): void {
  const { session, launch } = parts;
  if (session.end !== null) {
    const acknowledgement: ActingFrame['kind'] = launch.kind === 'agent' ? 'close-input' : 'stop';
    if (frame.kind === acknowledgement) session.finishLinger();
    return;
  }
  appendAndBroadcast(parts, 'client', JSON.stringify(frame));
  switch (frame.kind) {
    case 'write':
      writeLineToChild(session.childStdin, frame.line);
      return;
    case 'close-input':
      closeChildInput(session.childStdin);
      if (session.activity === 'busy') changeActivity(parts, 'idle');
      return;
    case 'stop':
      stopChild(parts, frame.graceMilliseconds);
  }
}

function countLingerFrame(session: HostSession): void {
  if (session.end === null) return;
  session.lingerFrames += 1;
  if (session.lingerFrames >= HOST_LINGER_FRAMES) session.finishLinger();
}

interface SupervisedChild {
  /** The record as it stood when the child ended, so `end` is added to what it said about the child. */
  readonly lastRecord: HostRecord;
  readonly end:        HostEnd;
}

async function superviseChild(parts: HostParts, launchedRecord: HostRecord): Promise<SupervisedChild> {
  const { launch, files, session } = parts;
  const hostLogDescriptor = openSync(files.hostLogPath, 'a');
  let child: Bun.Subprocess<'pipe' | 'ignore', 'pipe', number>;
  try {
    child = Bun.spawn({
      cmd:      [...launch.argv],
      cwd:      launch.workingDirectory,
      env:      { ...launch.environment },
      stdin:    launch.kind === 'agent' ? 'pipe' : 'ignore',
      stdout:   'pipe',
      stderr:   hostLogDescriptor,
      detached: true,
    });
  } catch (error) {
    return {
      lastRecord: launchedRecord,
      end:        {
        reason: 'spawn-failed', exitCode: null, signal: null, detail: String(error)
      },
    };
  } finally {
    closeSync(hostLogDescriptor);
  }
  // Detached means a new session, so the child leads its own process group and the group id is its pid.
  session.childLeader = identityOf(child.pid);
  const runningRecord: HostRecord = {
    ...launchedRecord, state: 'running', childProcess: session.childLeader, childProcessGroupId: child.pid,
  };
  writeFileAtomically(files.hostRecordPath, hostRecordTextOf(runningRecord));
  session.childStdin = launch.kind === 'agent' && typeof child.stdin === 'object' ? child.stdin : null;
  await forEachLine(child.stdout, (line) => {
    appendAndBroadcast(parts, 'agent', line);
    if (session.activity === 'idle') changeActivity(parts, 'busy');
    const reply = standingReplyFor(line, launch.standingReplies);
    if (reply === null || session.childStdin === null) return;
    appendAndBroadcast(parts, 'host', reply);
    writeLineToChild(session.childStdin, reply);
  });
  const exitCode = await child.exited;
  const signal = child.signalCode;
  const end: HostEnd = signal === null ? { reason: 'exited', exitCode, signal: null } : { reason: 'signalled', exitCode: null, signal };
  return { lastRecord: runningRecord, end };
}

/** `null` for arguments that name no job folder and instance: nothing can be claimed for them. */
function hostFilesOfArguments(hostArguments: readonly string[]): { files: HostFiles; instance: number } | null {
  const [jobFolder, instanceText] = hostArguments;
  if (jobFolder === undefined || jobFolder === '' || instanceText === undefined || !INSTANCE_PATTERN.test(instanceText)) return null;
  const instance = Number(instanceText);
  return { files: hostFilesOf(jobFolder, instance), instance };
}

/** The host's parts once its socket listens, or why it cannot. */
async function listenFor(launch: HostLaunch, files: HostFiles, eventLog: EventLogWriter, session: HostSession): Promise<HostParts | string> {
  try {
    prepareSocketFolder(launch.socketPath);
  } catch (error) {
    return `the socket folder cannot be prepared: ${String(error)}`;
  }
  let parts: HostParts | null = null;
  const listening = await listenOnHostSocket({
    socketPath:     launch.socketPath,
    hostSecret:     launch.hostSecret,
    acceptedKinds:  launch.kind === 'agent' ? AGENT_HOST_FRAMES : PROCESS_HOST_FRAMES,
    welcomeOf:      () => ({ hostCodeVersion: launch.hostCodeVersion, jobId: launch.jobId, state: session.activity }),
    durableEntries: () => {
      if (!session.logClosed) eventLog.sync();
      return readDurableEntries(files.eventLogPath);
    },
    onClientLine:  () => countLingerFrame(session),
    onActingFrame: (frame) => {
      if (parts !== null) actOnFrame(parts, frame);
    },
  });
  if (listening.verdict === 'unbindable') return listening.reason;
  parts = {
    launch, files, eventLog, session, server: listening.server,
  };
  return parts;
}

/**
 * Runs `<job folder> <instance>` to the end and returns the exit code; it never exits. A second host of a claimed instance returns 0
 * without spawning anything, so a re-spawn of the same instance is safe. A host whose child ran keeps its socket after the end until the
 * acknowledgement or `HOST_LINGER_FRAMES` client frames.
 */
export async function runHost(hostArguments: readonly string[]): Promise<number> {
  const target = hostFilesOfArguments(hostArguments);
  if (target === null) return HOST_REFUSED_EXIT_CODE;
  const { files, instance } = target;
  const claimedRecord: HostRecord = {
    protocolVersion:       HOST_PROTOCOL_VERSION,
    eventLogFormatVersion: EVENT_LOG_FORMAT_VERSION,
    hostInstance:          instance,
    state:                 'claimed',
    host:                  identityOf(process.pid),
  };
  if (createFileAtomically(files.hostRecordPath, hostRecordTextOf(claimedRecord)) === 'already-exists') return HOST_DONE_EXIT_CODE;
  const launchReading = readHostLaunch(files.launchPath);
  if (launchReading.verdict === 'unreadable') {
    writeFileAtomically(files.hostRecordPath, hostRecordTextOf(endedRecordOf(claimedRecord, {
      reason: 'launch-unreadable', exitCode: null, signal: null, detail: launchReading.reason,
    })));
    return HOST_REFUSED_EXIT_CODE;
  }
  const { launch } = launchReading;
  const launchedRecord: HostRecord = { ...claimedRecord, hostCodeVersion: launch.hostCodeVersion, socketPath: launch.socketPath };
  const eventLog = createEventLogWriter(files.eventLogPath);
  const { session, lingered } = createHostSession();
  const parts = await listenFor(launch, files, eventLog, session);
  if (typeof parts === 'string') {
    eventLog.syncAndClose();
    writeFileAtomically(files.hostRecordPath, hostRecordTextOf(endedRecordOf(launchedRecord, {
      reason: 'socket-unbindable', exitCode: null, signal: null, detail: parts,
    })));
    return HOST_REFUSED_EXIT_CODE;
  }
  const { server } = parts;
  const { lastRecord, end } = await superviseChild(parts, launchedRecord);
  eventLog.syncAndClose();
  session.logClosed = true;
  writeFileAtomically(files.hostRecordPath, hostRecordTextOf(endedRecordOf(lastRecord, end)));
  if (end.reason === 'spawn-failed') {
    server.close();
    return HOST_REFUSED_EXIT_CODE;
  }
  session.end = end;
  changeActivity(parts, 'ended');
  await lingered;
  server.close();
  await session.stopSignalsSent;
  return HOST_DONE_EXIT_CODE;
}

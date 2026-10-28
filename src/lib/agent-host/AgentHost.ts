/**
 * A thin host: claims one instance of a job by creating its host file exclusively, runs the one child its launch file names detached in
 * a process group of its own, logs every line to and from it, and records how it ended. It writes its job folder and the child's stdin
 * and nothing else. It depends on `src/lib/atomic-file` and `src/lib/process-identity`.
 */
import { closeSync, openSync } from 'node:fs';

import { createFileAtomically, writeFileAtomically }       from '../atomic-file/AtomicFile.ts';
import { identityOf }                                      from '../process-identity/ProcessIdentity.ts';
import { createEventLogWriter, type EventLogWriter }       from './EventLog.ts';
import { type HostFiles, hostFilesOf }                     from './HostFiles.ts';
import { type HostLaunch, readHostLaunch }                 from './HostLaunch.ts';
import { type HostEnd, type HostRecord, hostRecordTextOf } from './HostRecord.ts';
import { standingReplyFor }                                from './StandingReplies.ts';
import { EVENT_LOG_FORMAT_VERSION, HOST_PROTOCOL_VERSION } from './constants/HostProtocol.ts';

const HOST_DONE_EXIT_CODE    = 0;
const HOST_REFUSED_EXIT_CODE = 1;

const INSTANCE_PATTERN = /^[1-9]\d*$/;

const STDOUT_LINE_SEPARATOR = '\n';

interface ChildStdin {
  readonly write: (text: string) => unknown;
  readonly flush: () => unknown;
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

interface SupervisedChild {
  /** The record as it stood when the child ended, so `end` is added to what it said about the child. */
  readonly lastRecord: HostRecord;
  readonly end:        HostEnd;
}

async function superviseChild(launch: HostLaunch, files: HostFiles, claimedRecord: HostRecord, eventLog: EventLogWriter): Promise<SupervisedChild> {
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
      lastRecord: claimedRecord,
      end:        {
        reason: 'spawn-failed', exitCode: null, signal: null, detail: String(error)
      },
    };
  } finally {
    closeSync(hostLogDescriptor);
  }
  // Detached means a new session, so the child leads its own process group and the group id is its pid.
  const runningRecord: HostRecord = {
    ...claimedRecord, state: 'running', childProcess: identityOf(child.pid), childProcessGroupId: child.pid,
  };
  writeFileAtomically(files.hostRecordPath, hostRecordTextOf(runningRecord));
  const childStdin = launch.kind === 'agent' && typeof child.stdin === 'object' ? child.stdin : null;
  await forEachLine(child.stdout, (line) => {
    eventLog.append('agent', line);
    const reply = standingReplyFor(line, launch.standingReplies);
    if (reply === null || childStdin === null) return;
    eventLog.append('host', reply);
    writeLineToChild(childStdin, reply);
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

/**
 * Runs `<job folder> <instance>` to the end and returns the exit code; it never exits. A second host of a claimed instance returns 0
 * without spawning anything, so a re-spawn of the same instance is safe.
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
  const eventLog = createEventLogWriter(files.eventLogPath);
  const { lastRecord, end } = await superviseChild(launchReading.launch, files, claimedRecord, eventLog);
  eventLog.syncAndClose();
  writeFileAtomically(files.hostRecordPath, hostRecordTextOf(endedRecordOf(lastRecord, end)));
  return end.reason === 'spawn-failed' ? HOST_REFUSED_EXIT_CODE : HOST_DONE_EXIT_CODE;
}

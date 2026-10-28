/**
 * The host binary end to end, spawned as the runner spawns it with small `bun -e` children. What matters: exactly one of two racing hosts
 * of one instance spawns the child; the child runs in a process group of its own with its stderr in the host log; the host file records
 * both identities, the group and the versions, then `end`; every stdout line and every line written to the child is in the numbered log;
 * a standing reply answers a permission request but never a question; a process host gives its child no stdin. Every host here ends only
 * once a client acknowledges its end, as the runner does; protocol 1 itself is `AgentHost.protocol.spec.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join }                     from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }         from '../../testing/ChildProcessCaseTimeout.ts';
import { type HostJob, type SpawnedHost, createHostJob }   from '../../testing/HostJob.ts';
import { type EventLogEntry, eventLogEntriesOf }           from './EventLog.ts';
import { hostFilesOf }                                     from './HostFiles.ts';
import type { HostKind }                                   from './HostLaunch.ts';
import type { HostRecord }                                 from './HostRecord.ts';
import type { StandingReply }                              from './StandingReplies.ts';
import { EVENT_LOG_FORMAT_VERSION, HOST_PROTOCOL_VERSION } from './constants/HostProtocol.ts';

const PERMISSION_REQUEST = '{"type":"control_request","request_id":"r-1","request":{"subtype":"can_use_tool","tool_name":"Bash"}}';
const QUESTION_REQUEST = '{"type":"control_request","request_id":"r-2","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion"}}';

const DENY_ALL_BUT_QUESTIONS: StandingReply = {
  whenAllEqual:  { 'type': 'control_request', 'request.subtype': 'can_use_tool' },
  whenNoneEqual: { 'request.tool_name': 'AskUserQuestion' },
  replyTemplate: '{"type":"control_response","request_id":"{{request_id}}","behavior":"deny"}',
};

let currentHostJob: HostJob | null = null;
let jobFolder = '';

beforeEach(() => {
  currentHostJob = createHostJob();
  ({ jobFolder } = currentHostJob);
});

afterEach(() => {
  currentHostJob?.remove();
});

function hostJob(): HostJob {
  if (currentHostJob === null) throw new Error('no host job outside a test');
  return currentHostJob;
}

function writeLaunch(instance: number, kind: HostKind, childScript: string, standingReplies: readonly StandingReply[] = []): void {
  hostJob().writeLaunch(instance, kind, childScript, standingReplies);
}

function spawnHost(instance: number): SpawnedHost {
  return hostJob().spawnHost(instance);
}

/** Attaches as the runner does, waits for the child's end, acknowledges it and returns the host's exit code. */
async function acknowledgedExitOf(host: SpawnedHost, instance: number, kind: HostKind): Promise<number> {
  const client = await hostJob().attach(instance);
  await client.nextFrame((frame) => (frame.kind === 'welcome' || frame.kind === 'state') && frame.state === 'ended');
  client.send(kind === 'agent' ? { kind: 'close-input' } : { kind: 'stop', graceMilliseconds: 0 });
  const exitCode = await host.exited;
  client.close();
  return exitCode;
}

function hostRecordOf(instance: number): HostRecord {
  return JSON.parse(readFileSync(hostFilesOf(jobFolder, instance).hostRecordPath, 'utf8')) as HostRecord;
}

function eventsOf(instance: number): readonly EventLogEntry[] {
  const reading = eventLogEntriesOf(readFileSync(hostFilesOf(jobFolder, instance).eventLogPath, 'utf8'));
  if (reading.verdict !== 'read') throw new Error(`event log line ${reading.lineNumber} is malformed`);
  return reading.entries;
}

describe('the claim', () => {
  test('of two racing hosts for one instance, both exit 0 and exactly one spawns the child', async () => {
    const markerPath = join(jobFolder, 'spawned.txt');
    writeLaunch(1, 'process', `require('node:fs').appendFileSync(${JSON.stringify(markerPath)}, 'spawned\\n'); await Bun.sleep(200);`);
    const [first, second] = [spawnHost(1), spawnHost(1)];
    const exitCodes = await Promise.all([acknowledgedExitOf(first, 1, 'process'), second.exited]);
    expect(exitCodes).toEqual([0, 0]);
    expect(readFileSync(markerPath, 'utf8')).toBe('spawned\n');
    expect(hostRecordOf(1).state).toBe('ended');
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a host whose launch file is missing records why and spawns nothing', async () => {
    expect(await spawnHost(1).exited).toBe(1);
    expect(hostRecordOf(1)).toMatchObject({ state: 'ended', end: { reason: 'launch-unreadable', exitCode: null, signal: null } });
    expect(existsSync(hostFilesOf(jobFolder, 1).eventLogPath)).toBe(false);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describe('the child and the host file', () => {
  test('runs detached in its own process group, its stderr in the host log, and both identities and the versions are recorded', async () => {
    const childScript = [
      'const group = Bun.spawnSync(["/bin/ps", "-o", "pgid=", "-p", String(process.pid)]).stdout.toString().trim();',
      'console.log(JSON.stringify({ pid: process.pid, group: Number(group) }));',
      'console.error("written to stderr");',
    ].join('\n');
    writeLaunch(1, 'agent', childScript);
    const host = spawnHost(1);
    expect(await acknowledgedExitOf(host, 1, 'agent')).toBe(0);
    const [childLine] = eventsOf(1);
    const child = JSON.parse(childLine?.line ?? '{}') as { pid: number; group: number };
    expect(child.group).toBe(child.pid);
    expect(hostRecordOf(1)).toMatchObject({
      protocolVersion:       HOST_PROTOCOL_VERSION,
      eventLogFormatVersion: EVENT_LOG_FORMAT_VERSION,
      hostCodeVersion:       'code-example',
      socketPath:            hostJob().socketPathOf(1),
      hostInstance:          1,
      state:                 'ended',
      host:                  { processId: host.pid },
      childProcess:          { processId: child.pid },
      childProcessGroupId:   child.pid,
      end:                   { reason: 'exited', exitCode: 0, signal: null },
    });
    expect(readFileSync(hostFilesOf(jobFolder, 1).hostLogPath, 'utf8')).toContain('written to stderr');
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a child killed by a signal ends as signalled, with no exit code', async () => {
    writeLaunch(1, 'agent', 'console.log("before"); process.kill(process.pid, "SIGKILL");');
    expect(await acknowledgedExitOf(spawnHost(1), 1, 'agent')).toBe(0);
    expect(hostRecordOf(1).end).toEqual({ reason: 'signalled', exitCode: null, signal: 'SIGKILL' });
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a child that cannot be spawned ends as spawn-failed, and its host exits without lingering', async () => {
    hostJob().writeLaunchFile(1, 'process', [join(jobFolder, 'missing-program')]);
    expect(await spawnHost(1).exited).toBe(1);
    expect(hostRecordOf(1)).toMatchObject({ state: 'ended', end: { reason: 'spawn-failed', exitCode: null, signal: null } });
    expect(existsSync(hostJob().socketPathOf(1))).toBe(false);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describe('the event log and standing replies', () => {
  test('answers a permission request on stdin with its request id, never a question, and logs every line from 1 before end', async () => {
    const childScript = [
      `console.log(${JSON.stringify(PERMISSION_REQUEST)});`,
      `console.log(${JSON.stringify(QUESTION_REQUEST)});`,
      'for await (const line of console) { console.log(JSON.stringify({ echoed: line })); break; }',
      'process.exit(0);',
    ].join('\n');
    writeLaunch(1, 'agent', childScript, [DENY_ALL_BUT_QUESTIONS]);
    expect(await acknowledgedExitOf(spawnHost(1), 1, 'agent')).toBe(0);
    const reply = '{"type":"control_response","request_id":"r-1","behavior":"deny"}';
    expect(eventsOf(1)).toEqual([
      { sequence: 1, origin: 'agent', line: PERMISSION_REQUEST },
      { sequence: 2, origin: 'host', line: reply },
      { sequence: 3, origin: 'agent', line: QUESTION_REQUEST },
      { sequence: 4, origin: 'agent', line: JSON.stringify({ echoed: reply }) },
    ]);
    expect(hostRecordOf(1).end).toEqual({ reason: 'exited', exitCode: 0, signal: null });
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a process host gives its child no stdin and answers nothing, and records its exit code', async () => {
    const childScript = [
      `console.log(${JSON.stringify(PERMISSION_REQUEST)});`,
      'const input = await Bun.stdin.text();',
      'console.log(JSON.stringify({ inputLength: input.length }));',
      'process.exit(3);',
    ].join('\n');
    writeLaunch(1, 'process', childScript, [DENY_ALL_BUT_QUESTIONS]);
    expect(await acknowledgedExitOf(spawnHost(1), 1, 'process')).toBe(0);
    expect(eventsOf(1)).toEqual([
      { sequence: 1, origin: 'agent', line: PERMISSION_REQUEST },
      { sequence: 2, origin: 'agent', line: '{"inputLength":0}' },
    ]);
    expect(hostRecordOf(1).end).toEqual({ reason: 'exited', exitCode: 3, signal: null });
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

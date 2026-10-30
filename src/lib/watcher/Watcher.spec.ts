/**
 * The Watcher binary end to end, spawned as the Overseer spawns it with small `bun -e` children. What matters: exactly one of two racing Watchers
 * of one instance spawns the child; the child runs in a process group of its own with its stderr in the Watcher log; the Watcher file records
 * both identities, the group and the versions, then `end`; every stdout line and every line written to the child is in the numbered log;
 * a standing reply answers a permission request but never a question; a process Watcher gives its child no stdin. Every Watcher here ends only
 * once a client acknowledges its end, as the Overseer does; protocol 1 itself is `Watcher.protocol.spec.ts`.
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

import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }                from '../../testing/ChildProcessCaseTimeout.ts';
import { type WatcherJob, type SpawnedWatcher, createWatcherJob } from '../../testing/WatcherJob.ts';
import { type EventLogEntry, eventLogEntriesOf }                  from './EventLog.ts';
import type { StandingReply }                                     from './StandingReplies.ts';
import { watcherFilesOf }                                         from './WatcherFiles.ts';
import type { WatcherKind }                                       from './WatcherLaunch.ts';
import type { WatcherRecord }                                     from './WatcherRecord.ts';
import { EVENT_LOG_FORMAT_VERSION, WATCHER_PROTOCOL_VERSION }     from './constants/WatcherProtocol.ts';

const PERMISSION_REQUEST = '{"type":"control_request","request_id":"r-1","request":{"subtype":"can_use_tool","tool_name":"Bash"}}';
const QUESTION_REQUEST = '{"type":"control_request","request_id":"r-2","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion"}}';

const DENY_ALL_BUT_QUESTIONS: StandingReply = {
  whenAllEqual:  { 'type': 'control_request', 'request.subtype': 'can_use_tool' },
  whenNoneEqual: { 'request.tool_name': 'AskUserQuestion' },
  replyTemplate: '{"type":"control_response","request_id":"{{request_id}}","behavior":"deny"}',
};

let currentWatcherJob: WatcherJob | null = null;
let jobFolder = '';

beforeEach(() => {
  currentWatcherJob = createWatcherJob();
  ({ jobFolder } = currentWatcherJob);
});

afterEach(() => {
  currentWatcherJob?.remove();
});

function watcherJob(): WatcherJob {
  if (currentWatcherJob === null) throw new Error('no Watcher job outside a test');
  return currentWatcherJob;
}

function writeLaunch(instance: number, kind: WatcherKind, childScript: string, standingReplies: readonly StandingReply[] = []): void {
  watcherJob().writeLaunch(instance, kind, childScript, standingReplies);
}

function spawnWatcher(instance: number): SpawnedWatcher {
  return watcherJob().spawnWatcher(instance);
}

/** Attaches as the Overseer does, waits for the child's end, acknowledges it and returns the Watcher's exit code. */
async function acknowledgedExitOf(watcher: SpawnedWatcher, instance: number, kind: WatcherKind): Promise<number> {
  const client = await watcherJob().attach(instance);
  await client.nextFrame((frame) => (frame.kind === 'welcome' || frame.kind === 'state') && frame.state === 'ended');
  client.send(kind === 'agent' ? { kind: 'close-input' } : { kind: 'stop', graceMilliseconds: 0 });
  const exitCode = await watcher.exited;
  client.close();
  return exitCode;
}

function watcherRecordOf(instance: number): WatcherRecord {
  return JSON.parse(readFileSync(watcherFilesOf(jobFolder, instance).watcherRecordPath, 'utf8')) as WatcherRecord;
}

function eventsOf(instance: number): readonly EventLogEntry[] {
  const reading = eventLogEntriesOf(readFileSync(watcherFilesOf(jobFolder, instance).eventLogPath, 'utf8'));
  if (reading.verdict !== 'read') throw new Error(`event log line ${reading.lineNumber} is malformed`);
  // Every entry is stamped; the stamp is the clock's, so the cases compare the rest.
  if (!reading.entries.every((entry) => typeof entry.at === 'string')) throw new Error('an event log entry carries no stamp');
  return reading.entries.map(({ sequence, origin, line }) => ({ sequence, origin, line }));
}

describe('the claim', () => {
  test('of two racing Watchers for one instance, both exit 0 and exactly one spawns the child', async () => {
    const markerPath = join(jobFolder, 'spawned.txt');
    writeLaunch(1, 'process', `require('node:fs').appendFileSync(${JSON.stringify(markerPath)}, 'spawned\\n'); await Bun.sleep(200);`);
    const [first, second] = [spawnWatcher(1), spawnWatcher(1)];
    const exitCodes = await Promise.all([acknowledgedExitOf(first, 1, 'process'), second.exited]);
    expect(exitCodes).toEqual([0, 0]);
    expect(readFileSync(markerPath, 'utf8')).toBe('spawned\n');
    expect(watcherRecordOf(1).state).toBe('ended');
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a Watcher whose launch file is missing records why and spawns nothing', async () => {
    expect(await spawnWatcher(1).exited).toBe(1);
    expect(watcherRecordOf(1)).toMatchObject({ state: 'ended', end: { reason: 'launch-unreadable', exitCode: null, signal: null } });
    expect(existsSync(watcherFilesOf(jobFolder, 1).eventLogPath)).toBe(false);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describe('the child and the Watcher file', () => {
  test('runs detached in its own process group, its stderr in the Watcher log, and both identities and the versions are recorded', async () => {
    const childScript = [
      'const group = Bun.spawnSync(["/bin/ps", "-o", "pgid=", "-p", String(process.pid)]).stdout.toString().trim();',
      'console.log(JSON.stringify({ pid: process.pid, group: Number(group) }));',
      'console.error("written to stderr");',
    ].join('\n');
    writeLaunch(1, 'agent', childScript);
    const watcher = spawnWatcher(1);
    expect(await acknowledgedExitOf(watcher, 1, 'agent')).toBe(0);
    const [childLine] = eventsOf(1);
    const child = JSON.parse(childLine?.line ?? '{}') as { pid: number; group: number };
    expect(child.group).toBe(child.pid);
    expect(watcherRecordOf(1)).toMatchObject({
      protocolVersion:       WATCHER_PROTOCOL_VERSION,
      eventLogFormatVersion: EVENT_LOG_FORMAT_VERSION,
      watcherCodeVersion:    'code-example',
      socketPath:            watcherJob().socketPathOf(1),
      watcherInstance:       1,
      state:                 'ended',
      watcher:               { processId: watcher.pid },
      childProcess:          { processId: child.pid },
      childProcessGroupId:   child.pid,
      end:                   { reason: 'exited', exitCode: 0, signal: null },
    });
    expect(readFileSync(watcherFilesOf(jobFolder, 1).watcherLogPath, 'utf8')).toContain('written to stderr');
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a child killed by a signal ends as signalled, with no exit code', async () => {
    writeLaunch(1, 'agent', 'console.log("before"); process.kill(process.pid, "SIGKILL");');
    expect(await acknowledgedExitOf(spawnWatcher(1), 1, 'agent')).toBe(0);
    expect(watcherRecordOf(1).end).toEqual({ reason: 'signalled', exitCode: null, signal: 'SIGKILL' });
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a child that cannot be spawned ends as spawn-failed, and its Watcher exits without lingering', async () => {
    watcherJob().writeLaunchFile(1, 'process', [join(jobFolder, 'missing-program')]);
    expect(await spawnWatcher(1).exited).toBe(1);
    expect(watcherRecordOf(1)).toMatchObject({ state: 'ended', end: { reason: 'spawn-failed', exitCode: null, signal: null } });
    expect(existsSync(watcherJob().socketPathOf(1))).toBe(false);
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
    expect(await acknowledgedExitOf(spawnWatcher(1), 1, 'agent')).toBe(0);
    const reply = '{"type":"control_response","request_id":"r-1","behavior":"deny"}';
    expect(eventsOf(1)).toEqual([
      { sequence: 1, origin: 'agent', line: PERMISSION_REQUEST },
      { sequence: 2, origin: 'watcher', line: reply },
      { sequence: 3, origin: 'agent', line: QUESTION_REQUEST },
      { sequence: 4, origin: 'agent', line: JSON.stringify({ echoed: reply }) },
    ]);
    expect(watcherRecordOf(1).end).toEqual({ reason: 'exited', exitCode: 0, signal: null });
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a process Watcher gives its child no stdin and answers nothing, and records its exit code', async () => {
    const childScript = [
      `console.log(${JSON.stringify(PERMISSION_REQUEST)});`,
      'const input = await Bun.stdin.text();',
      'console.log(JSON.stringify({ inputLength: input.length }));',
      'process.exit(3);',
    ].join('\n');
    writeLaunch(1, 'process', childScript, [DENY_ALL_BUT_QUESTIONS]);
    expect(await acknowledgedExitOf(spawnWatcher(1), 1, 'process')).toBe(0);
    expect(eventsOf(1)).toEqual([
      { sequence: 1, origin: 'agent', line: PERMISSION_REQUEST },
      { sequence: 2, origin: 'agent', line: '{"inputLength":0}' },
    ]);
    expect(watcherRecordOf(1).end).toEqual({ reason: 'exited', exitCode: 3, signal: null });
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

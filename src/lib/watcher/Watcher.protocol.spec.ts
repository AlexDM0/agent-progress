/**
 * Protocol 1 against the spawned Watcher binary. What matters: the socket folder is its owner's alone; `hello` must come first and carry the
 * protocol and the secret, and is answered by `welcome` and the history after its cursor; `write`, `close-input` and `stop` act on the
 * child, stop reaching its whole group after the graces, while a process Watcher takes only `stop`; every entry is a `message` and the state
 * changes on lines and `close-input` alone, whatever a line says; an ended Watcher stays reachable until its acknowledgement or
 * `WATCHER_LINGER_FRAMES` client frames.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname }                from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS } from '../../testing/ChildProcessCaseTimeout.ts';
import {
  WATCHER_JOB_CODE_VERSION,
  WATCHER_JOB_IDENTIFIER,
  WATCHER_JOB_SECRET,
  type WatcherJob,
  createWatcherJob
} from '../../testing/WatcherJob.ts';
import { type WatcherProtocolClient, connectToWatcher } from '../../testing/WatcherProtocolClient.ts';
import { processIsGone }                                from '../process-identity/ProcessIdentity.ts';
import type {
  WatcherFrame,
  WatcherRefusalReason,
  MessageFrame,
  StateFrame
} from './@types/WatcherFrame.ts';
import { type EventLogEntry, eventLogEntriesOf }           from './EventLog.ts';
import { watcherFilesOf }                                  from './WatcherFiles.ts';
import { WATCHER_LINGER_FRAMES, WATCHER_PROTOCOL_VERSION } from './constants/WatcherProtocol.ts';

const OWNER_ONLY_FOLDER_MODE = 0o700;
const PERMISSION_BITS = 0o777;
const STOP_GRACE_MILLISECONDS = 300;
const PROCESS_GONE_POLLS = 100;
const POLL_INTERVAL_MILLISECONDS = 50;

// Echoes each stdin line, then says its input closed and exits; Bun's line reader yields an empty last line at the end of input.
const ECHO_CHILD = 'for await (const line of console) if (line !== "") console.log(`echo:${line}`);\nconsole.log("input closed");';

let currentWatcherJob: WatcherJob | null = null;

beforeEach(() => {
  currentWatcherJob = createWatcherJob();
});

afterEach(() => {
  currentWatcherJob?.remove();
});

function watcherJob(): WatcherJob {
  if (currentWatcherJob === null) throw new Error('no Watcher job outside a test');
  return currentWatcherJob;
}

function eventsOf(instance: number): readonly EventLogEntry[] {
  const reading = eventLogEntriesOf(readFileSync(watcherFilesOf(watcherJob().jobFolder, instance).eventLogPath, 'utf8'));
  if (reading.verdict !== 'read') throw new Error(`event log line ${reading.lineNumber} is malformed`);
  return reading.entries;
}

function isEnded(frame: WatcherFrame): boolean {
  return (frame.kind === 'welcome' || frame.kind === 'state') && frame.state === 'ended';
}

function agentLineArrived(line: string): (frame: WatcherFrame) => boolean {
  return (frame) => frame.kind === 'message' && frame.entry.origin === 'agent' && frame.entry.line === line;
}

/** Ends an echo child through its input, then acknowledges the end, as the Overseer does. */
async function endAndAcknowledge(watcher: Bun.Subprocess, client: WatcherProtocolClient): Promise<number> {
  client.send({ kind: 'close-input' });
  await client.nextFrame(isEnded);
  client.send({ kind: 'close-input' });
  return watcher.exited;
}

async function waitUntilGone(processId: number): Promise<boolean> {
  for (let poll = 0; poll < PROCESS_GONE_POLLS; poll += 1) {
    if (processIsGone(processId)) return true;
    await Bun.sleep(POLL_INTERVAL_MILLISECONDS);
  }
  return false;
}

describe('the socket', () => {
  test('is bound inside a Watchers folder only its owner may open', async () => {
    watcherJob().writeLaunch(1, 'agent', ECHO_CHILD);
    const watcher = watcherJob().spawnWatcher(1);
    const client = await watcherJob().attach(1);
    await client.nextFrame((frame) => frame.kind === 'welcome');
    const socketFolder = dirname(watcherJob().socketPathOf(1));
    expect(socketFolder).toBe(`${watcherJob().monitorFolder}/watchers`);
    expect(statSync(socketFolder).mode & PERMISSION_BITS).toBe(OWNER_ONLY_FOLDER_MODE);
    expect(statSync(watcherJob().socketPathOf(1)).isSocket()).toBe(true);
    expect(await endAndAcknowledge(watcher, client)).toBe(0);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describe('hello', () => {
  test('is answered by welcome and the history after its cursor, read from the event log', async () => {
    watcherJob().writeLaunch(1, 'agent', `console.log("one"); console.log("two"); console.log("three");\n${ECHO_CHILD}`);
    const watcher = watcherJob().spawnWatcher(1);
    const client = await watcherJob().attach(1);
    await client.nextFrame(agentLineArrived('three'));
    const resumed = await watcherJob().attach(1, 1);
    expect(await resumed.nextFrame((frame) => frame.kind === 'welcome')).toEqual({
      kind:               'welcome',
      protocolVersion:    WATCHER_PROTOCOL_VERSION,
      watcherCodeVersion: WATCHER_JOB_CODE_VERSION,
      jobId:              WATCHER_JOB_IDENTIFIER,
      lastSequence:       3,
      state:              'busy',
    });
    expect(await resumed.nextFrame((frame) => frame.kind === 'history')).toEqual({
      kind:    'history',
      entries: [
        {
          sequence: 2, origin: 'agent', line: 'two', at: expect.any(String)
        },
        {
          sequence: 3, origin: 'agent', line: 'three', at: expect.any(String)
        },
      ],
    });
    expect(await endAndAcknowledge(watcher, client)).toBe(0);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test.each([
    ['a frame before hello', { kind: 'close-input' }, 'protocol'],
    ['a line that is no frame', 'not json', 'protocol'],
    ['another protocol', {
      kind: 'hello', protocolVersion: WATCHER_PROTOCOL_VERSION + 1, sinceSequence: 0, watcherSecret: WATCHER_JOB_SECRET
    }, 'protocol'],
    ['a wrong secret', {
      kind: 'hello', protocolVersion: WATCHER_PROTOCOL_VERSION, sinceSequence: 0, watcherSecret: 'wrong-secret'
    }, 'secret'],
  ])('refuses %s and closes the client, the child untouched', async (_title, firstFrame, reason) => {
    watcherJob().writeLaunch(1, 'agent', ECHO_CHILD);
    const watcher = watcherJob().spawnWatcher(1);
    const stranger = await connectToWatcher(watcherJob().socketPathOf(1));
    stranger.send(firstFrame);
    expect(await stranger.nextFrame((frame) => frame.kind === 'refused')).toEqual({ kind: 'refused', reason: reason as WatcherRefusalReason });
    await stranger.closed;
    expect(stranger.received()).toHaveLength(1);
    expect(await endAndAcknowledge(watcher, await watcherJob().attach(1))).toBe(0);
    expect(eventsOf(1).map((entry) => entry.line)).toEqual(['{"kind":"close-input"}', 'input closed']);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describe('acting frames', () => {
  test('write reaches the child\'s stdin and close-input ends it, each logged as the client frame it was', async () => {
    watcherJob().writeLaunch(1, 'agent', ECHO_CHILD);
    const watcher = watcherJob().spawnWatcher(1);
    const client = await watcherJob().attach(1);
    client.send({ kind: 'write', line: 'hello child' });
    await client.nextFrame(agentLineArrived('echo:hello child'));
    expect(await endAndAcknowledge(watcher, client)).toBe(0);
    // Matched rather than equal: each entry also carries the Watcher clock's stamp.
    expect(eventsOf(1)).toMatchObject([
      { sequence: 1, origin: 'client', line: '{"kind":"write","line":"hello child"}' },
      { sequence: 2, origin: 'agent', line: 'echo:hello child' },
      { sequence: 3, origin: 'client', line: '{"kind":"close-input"}' },
      { sequence: 4, origin: 'agent', line: 'input closed' },
    ]);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('stop closes stdin, then SIGTERMs and SIGKILLs the child\'s whole group after the graces', async () => {
    const childScript = [
      'const grandchild = Bun.spawn(["/bin/sleep", "30"]);',
      'process.on("SIGTERM", () => console.log("term"));',
      'console.log(JSON.stringify({ grandchild: grandchild.pid }));',
      '(async () => { for await (const line of console) void line; console.log("input closed"); })();',
      'setInterval(() => undefined, 1000);',
    ].join('\n');
    watcherJob().writeLaunch(1, 'agent', childScript);
    const watcher = watcherJob().spawnWatcher(1);
    const client = await watcherJob().attach(1);
    const firstLine = await client.nextFrame((frame) => frame.kind === 'message' && frame.entry.origin === 'agent') as MessageFrame;
    const { grandchild } = JSON.parse(firstLine.entry.line) as { grandchild: number };
    client.send({ kind: 'stop', graceMilliseconds: STOP_GRACE_MILLISECONDS });
    expect(await client.nextFrame((frame) => frame.kind === 'state' && frame.state !== 'busy')).toEqual({ kind: 'state', state: 'stopping' });
    expect(await client.nextFrame(isEnded)).toEqual({ kind: 'state', state: 'ended', end: { reason: 'signalled', exitCode: null, signal: 'SIGKILL' } });
    expect(eventsOf(1).filter((entry) => entry.origin === 'agent').map((entry) => entry.line).slice(1)).toEqual(['input closed', 'term']);
    expect(await waitUntilGone(grandchild)).toBe(true);
    client.send({ kind: 'close-input' });
    expect(await watcher.exited).toBe(0);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('stop SIGKILLs what is left of the group after the leader ended on SIGTERM, even when the end is acknowledged at once', async () => {
    const childScript = [
      'const grandchild = Bun.spawn(["/bin/sh", "-c", "trap \'\' TERM; exec /bin/sleep 30"]);',
      'console.log(JSON.stringify({ grandchild: grandchild.pid }));',
      'setInterval(() => undefined, 1000);',
    ].join('\n');
    watcherJob().writeLaunch(1, 'agent', childScript);
    const watcher = watcherJob().spawnWatcher(1);
    const client = await watcherJob().attach(1);
    const firstLine = await client.nextFrame((frame) => frame.kind === 'message' && frame.entry.origin === 'agent') as MessageFrame;
    const { grandchild } = JSON.parse(firstLine.entry.line) as { grandchild: number };
    client.send({ kind: 'stop', graceMilliseconds: STOP_GRACE_MILLISECONDS });
    expect(await client.nextFrame(isEnded)).toEqual({ kind: 'state', state: 'ended', end: { reason: 'signalled', exitCode: null, signal: 'SIGTERM' } });
    expect(processIsGone(grandchild)).toBe(false);
    client.send({ kind: 'close-input' });
    expect(await watcher.exited).toBe(0);
    try {
      expect(await waitUntilGone(grandchild)).toBe(true);
    } finally {
      if (!processIsGone(grandchild)) process.kill(grandchild, 'SIGKILL');
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a process Watcher refuses write and close-input, and takes stop, which is also its acknowledgement', async () => {
    watcherJob().writeLaunch(1, 'process', 'await Bun.sleep(30_000);');
    const watcher = watcherJob().spawnWatcher(1);
    for (const frame of [{ kind: 'write', line: 'hello' }, { kind: 'close-input' }]) {
      const client = await watcherJob().attach(1);
      client.send(frame);
      expect(await client.nextFrame((received) => received.kind === 'refused')).toEqual({ kind: 'refused', reason: 'protocol' });
      await client.closed;
    }
    const overseer = await watcherJob().attach(1);
    overseer.send({ kind: 'stop', graceMilliseconds: 0 });
    expect(await overseer.nextFrame(isEnded)).toMatchObject({ end: { reason: 'signalled', signal: 'SIGTERM' } });
    overseer.send({ kind: 'stop', graceMilliseconds: 0 });
    expect(await watcher.exited).toBe(0);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describe('messages and states', () => {
  test('every entry is a message, and only a line and close-input change the state, whatever the line says', async () => {
    const resultLine = '{"type":"result","subtype":"success"}';
    watcherJob().writeLaunch(1, 'agent', `for await (const line of console) if (line !== "") console.log(${JSON.stringify(resultLine)});`);
    const watcher = watcherJob().spawnWatcher(1);
    const client = await watcherJob().attach(1);
    expect(await client.nextFrame((frame) => frame.kind === 'welcome')).toMatchObject({ state: 'idle', lastSequence: 0 });
    client.send({ kind: 'write', line: 'go' });
    await client.nextFrame(agentLineArrived(resultLine));
    expect(await endAndAcknowledge(watcher, client)).toBe(0);
    const received = client.received();
    expect(received.filter((frame): frame is MessageFrame => frame.kind === 'message').map((frame) => frame.entry)).toEqual([...eventsOf(1)]);
    expect(received.filter((frame): frame is StateFrame => frame.kind === 'state')).toEqual([
      { kind: 'state', state: 'busy' },
      { kind: 'state', state: 'idle' },
      { kind: 'state', state: 'ended', end: { reason: 'exited', exitCode: 0, signal: null } },
    ]);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describe('the end', () => {
  test('an ended Watcher still answers hello until the acknowledgement, then exits 0 and removes its socket', async () => {
    watcherJob().writeLaunch(1, 'agent', 'console.log("done");');
    const watcher = watcherJob().spawnWatcher(1);
    const first = await watcherJob().attach(1);
    await first.nextFrame(isEnded);
    const second = await watcherJob().attach(1);
    expect(await second.nextFrame((frame) => frame.kind === 'welcome')).toMatchObject({ state: 'ended', lastSequence: 1 });
    expect(watcher.exitCode).toBeNull();
    second.send({ kind: 'close-input' });
    expect(await watcher.exited).toBe(0);
    expect(() => statSync(watcherJob().socketPathOf(1))).toThrow();
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test(`an ended Watcher never acknowledged exits 0 after ${WATCHER_LINGER_FRAMES} client frames`, async () => {
    watcherJob().writeLaunch(1, 'agent', ECHO_CHILD);
    const watcher = watcherJob().spawnWatcher(1);
    const client = await watcherJob().attach(1);
    client.send({ kind: 'close-input' });
    await client.nextFrame(isEnded);
    for (let frameCount = 1; frameCount < WATCHER_LINGER_FRAMES; frameCount += 1) client.send({ kind: 'stop', graceMilliseconds: 0 });
    const latecomer = await watcherJob().attach(1);
    expect(await latecomer.nextFrame((frame) => frame.kind === 'welcome')).toMatchObject({ state: 'ended' });
    expect(await watcher.exited).toBe(0);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

/**
 * The port a board's runner prefers and the server's guards. What matters: the preferred port is a pure function of the tracker id inside
 * `RUNNER_PORT_FIRST` and its count, so a board keeps it across restarts; a port in use moves the bind upward while a given port is refused;
 * `/api/identity` answers anyone on the machine; and a command needs the token, a loopback Host and no Origin.
 */
import { createHash } from 'node:crypto';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { OperationRefusal }                        from '../../shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                           from '../../shared/constants/ProductNames.ts';
import { RUNNER_PORT_COUNT }                       from '../../shared/constants/RunnerLimits.ts';
import { RunnerPort }                              from './RunnerPort.ts';
import { RunnerServer, type RuntimeRunnerCommand } from './RunnerServer.ts';

const EXAMPLE_TRACKER_ID = 'example-tracker-id';
const TOKEN              = 'example-token';

const stoppers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
});

function startExampleServer(received: RuntimeRunnerCommand[] = [], nudges: string[] = []) {
  const server = RunnerServer.start({
    portChoice: { kind: 'given', port: 0 },
    identity:   {
      trackerId: EXAMPLE_TRACKER_ID, project: 'Example Agency', codeVersion: 'code-example', installVersion: 17, processId: process.pid
    },
    token:            () => TOKEN,
    onRuntimeCommand: (command) => received.push(command),
    onNudge:          () => nudges.push('nudge'),
    state:            () => ({ notices: [{ kind: 'install-version-changed' }] }),
  });
  stoppers.push(() => server.stop());
  return server;
}

describe('RunnerPort', () => {
  test('the preferred port is RUNNER_PORT_FIRST plus the first four digest bytes modulo the count, the same on every call', () => {
    const digest = createHash('sha256').update(EXAMPLE_TRACKER_ID).digest();
    const expected = PRODUCT_NAMES.RUNNER_PORT_FIRST + (digest.readUInt32BE(0) % RUNNER_PORT_COUNT);
    expect(RunnerPort.preferredPortOf(EXAMPLE_TRACKER_ID)).toBe(expected);
    expect(RunnerPort.preferredPortOf(EXAMPLE_TRACKER_ID)).toBe(RunnerPort.preferredPortOf(EXAMPLE_TRACKER_ID));
  });

  test('a preferred port in use moves the bind upward, while a given port in use is refused runner-port-in-use', () => {
    const preferred = RunnerPort.preferredPortOf(EXAMPLE_TRACKER_ID);
    const inUse = (port: number) => {
      if (port === preferred) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' });
      return port;
    };
    expect(RunnerPort.bindFirstFree({ kind: 'preferred', trackerId: EXAMPLE_TRACKER_ID }, inUse)).toBe(preferred + 1);
    expect(() => RunnerPort.bindFirstFree({ kind: 'given', port: preferred }, inUse)).toThrow(OperationRefusal);
    expect(() => RunnerPort.bindFirstFree({ kind: 'given', port: 1 }, () => {
      throw new Error('another failure');
    })).toThrow('another failure');
  });
});

describe('RunnerServer', () => {
  test('binds 127.0.0.1 and answers /api/identity with the identity document', async () => {
    const server = startExampleServer();
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
    const response = await fetch(new URL('api/identity', server.url));
    expect(await response.json()).toEqual({
      application:         PRODUCT_NAMES.PROGRAM,
      trackerId:           EXAMPLE_TRACKER_ID,
      project:             'Example Agency',
      codeVersion:         'code-example',
      installVersion:      17,
      hostProtocolVersion: 1,
      processId:           process.pid,
    });
  });

  test('a runtime command is taken only with the bearer token, and a foreign Host or any Origin is forbidden', async () => {
    const received: RuntimeRunnerCommand[] = [];
    const server   = startExampleServer(received);
    const commandsUrl = new URL('api/commands', server.url);
    const post = (headers: Record<string, string>) => fetch(commandsUrl, { method: 'POST', headers, body: JSON.stringify({ kind: 'runner-stop', now: true }) });

    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: `Bearer ${TOKEN}`, origin: 'https://example.com' })).status).toBe(403);
    expect((await post({ authorization: `Bearer ${TOKEN}`, host: 'example.com' })).status).toBe(403);
    expect(received).toEqual([]);
    expect((await post({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect(received).toEqual([{ kind: 'runner-stop', now: true }]);
  });

  test('a body-less POST /api/nudge wakes the runner without a token, and /api/state answers the state document', async () => {
    const nudges: string[] = [];
    const server = startExampleServer([], nudges);
    expect((await fetch(new URL('api/nudge', server.url), { method: 'POST' })).status).toBe(200);
    expect((await fetch(new URL('api/nudge', server.url), { method: 'POST', headers: { origin: 'https://example.com' } })).status).toBe(403);
    expect(nudges).toEqual(['nudge']);
    expect(await (await fetch(new URL('api/state', server.url))).json()).toEqual({ notices: [{ kind: 'install-version-changed' }] });
  });
});

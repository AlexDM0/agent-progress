/**
 * The port a board's Overseer prefers and the Overseer API's guards and streams, over planted routes. What matters: the preferred port is a
 * pure function of the tracker id inside `OVERSEER_PORT_FIRST` and its count, so a board keeps it across restarts; a port in use moves the
 * bind upward while a given port is refused; a foreign Watcher, a foreign Origin, an agent-dashboard frame Origin and any preflight get 403
 * with no CORS header, while a server's Origin-less write with the token is routed; the session token goes only to a same-origin fetch;
 * every answer carries the page CSP but a served job file, which is sandboxed plain text and only `report.json` or `gate.log`; the event
 * stream replays after a `Last-Event-ID` of its generation and pings; and a job stream sends its history then each new entry.
 */
import { createHash } from 'node:crypto';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { TranscriptEntry }                       from '../../shared/@types/TranscriptEntry.ts';
import { OperationRefusal }                           from '../../shared/OperationRefusal.ts';
import { OVERSEER_PORT_COUNT, SSE_HEARTBEAT_SECONDS } from '../../shared/constants/OverseerLimits.ts';
import { PRODUCT_NAMES }                              from '../../shared/constants/ProductNames.ts';
import type { BoardState }                            from './BoardState.ts';
import { createEventBroker }                          from './EventBroker.ts';
import { OverseerPort }                               from './OverseerPort.ts';
import { OverseerServer, type OverseerRoutes }        from './OverseerServer.ts';

const EXAMPLE_TRACKER_ID = 'example-tracker-id';
const TOKEN              = 'example-token';
const DASHBOARD_ORIGIN   = 'http://127.0.0.1:4800';
const HEARTBEAT_TEST_TIMEOUT_MILLISECONDS = (SSE_HEARTBEAT_SECONDS + 5) * 1000;

const stoppers: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
});

function exampleState(ticketCount: number): BoardState {
  return {
    ticketCount,
    page:       { payload: { generatedAtEpochMilliseconds: 1 }, tickets: [] },
    jobs:       [],
    endedJobs:  [],
    decisions:  [],
    incidents:  [],
    notices:    [],
    mergeQueue: { queuedTicketIds: [], slots: [] },
    overseer:   {
      state: 'serving', paused: false, url: null, generation: 1, codeVersion: 'code-example', installVersion: 17, batonPassWarning: null
    },
    usage: { resetsAt: null, window: null },
  } as unknown as BoardState;
}

function startExampleServer(overrides: Partial<OverseerRoutes> = {}) {
  const commands: unknown[] = [];
  const nudges: string[] = [];
  const broker = createEventBroker(1);
  const routes: OverseerRoutes = {
    token:   () => TOKEN,
    command: async (body) => {
      commands.push(body);
      return { status: 200, body: { outcome: 'done', result: null } };
    },
    onNudge:      () => nudges.push('nudge'),
    state:        () => ({ notices: [{ kind: 'install-version-changed' }] }),
    summary:      () => ({ summaryVersion: 1 }),
    events:       () => broker,
    transcriptOf: () => null,
    jobFileText:  (_jobId, fileName) => `text of ${fileName}`,
    frameOrigins: () => [DASHBOARD_ORIGIN],
    ...overrides,
  };
  const server = OverseerServer.start({
    portChoice: { kind: 'given', port: 0 },
    identity:   {
      trackerId: EXAMPLE_TRACKER_ID, project: 'Example Agency', codeVersion: 'code-example', installVersion: 17, processId: process.pid
    },
    routes,
  });
  stoppers.push(() => server.stop());
  return {
    server, commands, nudges, broker
  };
}

/** Reads an event stream until its text satisfies `isComplete`, then closes it. */
async function streamTextUntil(response: Response, isComplete: (text: string) => boolean): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('no body');
  const decoder = new TextDecoder();
  let text = '';
  while (!isComplete(text)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value);
  }
  await reader.cancel();
  return text;
}

function hasNoCorsHeader(response: Response): boolean {
  return [...response.headers.keys()].every((name) => !name.startsWith('access-control-'));
}

describe('OverseerPort', () => {
  test('the preferred port is OVERSEER_PORT_FIRST plus the first four digest bytes modulo the count, the same on every call', () => {
    const digest = createHash('sha256').update(EXAMPLE_TRACKER_ID).digest();
    const expected = PRODUCT_NAMES.OVERSEER_PORT_FIRST + (digest.readUInt32BE(0) % OVERSEER_PORT_COUNT);
    expect(OverseerPort.preferredPortOf(EXAMPLE_TRACKER_ID)).toBe(expected);
    expect(OverseerPort.preferredPortOf(EXAMPLE_TRACKER_ID)).toBe(OverseerPort.preferredPortOf(EXAMPLE_TRACKER_ID));
  });

  test('a preferred port in use moves the bind upward, while a given port in use is refused overseer-port-in-use', () => {
    const preferred = OverseerPort.preferredPortOf(EXAMPLE_TRACKER_ID);
    const inUse = (port: number) => {
      if (port === preferred) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' });
      return port;
    };
    expect(OverseerPort.bindFirstFree({ kind: 'preferred', trackerId: EXAMPLE_TRACKER_ID }, inUse)).toBe(preferred + 1);
    expect(() => OverseerPort.bindFirstFree({ kind: 'given', port: preferred }, inUse)).toThrow(OperationRefusal);
    expect(() => OverseerPort.bindFirstFree({ kind: 'given', port: 1 }, () => {
      throw new Error('another failure');
    })).toThrow('another failure');
  });
});

describe('OverseerServer guards', () => {
  test('binds 127.0.0.1 and answers /api/identity with the identity document', async () => {
    const { server } = startExampleServer();
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
    const response = await fetch(new URL('api/identity', server.url));
    expect(await response.json()).toEqual({
      application:            PRODUCT_NAMES.PROGRAM,
      trackerId:              EXAMPLE_TRACKER_ID,
      project:                'Example Agency',
      codeVersion:            'code-example',
      installVersion:         17,
      watcherProtocolVersion: 1,
      processId:              process.pid,
    });
  });

  test('a command is routed only with the bearer token and no foreign Origin: a server\'s Origin-less write with the token is accepted', async () => {
    const { server, commands } = startExampleServer();
    const commandsUrl = new URL('api/commands', server.url);
    const post = (headers: Record<string, string>) => fetch(commandsUrl, { method: 'POST', headers, body: JSON.stringify({ kind: 'overseer-pause' }) });

    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: 'Bearer another-token' })).status).toBe(401);
    expect((await post({ authorization: `Bearer ${TOKEN}`, watcher: 'example.com' })).status).toBe(403);
    expect((await post({ authorization: `Bearer ${TOKEN}`, watcher: `example.com:${server.port}` })).status).toBe(403);
    expect(commands).toEqual([]);
    expect((await post({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await post({ authorization: `Bearer ${TOKEN}`, watcher: `localhost:${server.port}` })).status).toBe(200);
    expect((await post({ authorization: `Bearer ${TOKEN}`, origin: `http://127.0.0.1:${server.port}` })).status).toBe(200);
    expect(commands).toEqual([{ kind: 'overseer-pause' }, { kind: 'overseer-pause' }, { kind: 'overseer-pause' }]);
  });

  test('a foreign Origin, an agent-dashboard frame Origin and a preflight get 403 with no CORS header, so the token never reaches their page', async () => {
    const { server, commands } = startExampleServer();
    const commandsUrl = new URL('api/commands', server.url);
    const refusals = [
      await fetch(commandsUrl, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://example.com' }, body: '{}' }),
      await fetch(commandsUrl, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: DASHBOARD_ORIGIN }, body: '{}' }),
      await fetch(commandsUrl, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } }),
      await fetch(new URL('api/session-token', server.url), { headers: { origin: DASHBOARD_ORIGIN, 'sec-fetch-site': 'same-origin' } }),
    ];
    expect(refusals.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(refusals.every(hasNoCorsHeader)).toBe(true);
    expect(commands).toEqual([]);
  });

  test('GET /api/session-token answers the token only to a same-origin fetch, with no CORS header', async () => {
    const { server } = startExampleServer();
    const tokenUrl = new URL('api/session-token', server.url);
    const sameOrigin = await fetch(tokenUrl, { headers: { 'sec-fetch-site': 'same-origin' } });
    expect(await sameOrigin.json()).toEqual({ token: TOKEN });
    expect(hasNoCorsHeader(sameOrigin)).toBe(true);
    expect((await fetch(tokenUrl)).status).toBe(403);
    expect((await fetch(tokenUrl, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(tokenUrl, { headers: { 'sec-fetch-site': 'same-origin', watcher: `example.com:${server.port}` } })).status).toBe(403);
  });

  test('every answer carries the page CSP, framed only by agent-dashboard\'s origin; a refusal too', async () => {
    const { server } = startExampleServer();
    for (const path of ['api/identity', 'api/state', 'api/missing']) {
      const policy = (await fetch(new URL(path, server.url))).headers.get('content-security-policy') ?? '';
      expect(policy).toContain('default-src \'self\'');
      expect(policy).toContain(`frame-ancestors ${DASHBOARD_ORIGIN}`);
    }
    const refused = await fetch(new URL('api/state', server.url), { headers: { origin: 'https://example.com' } });
    expect(refused.headers.get('content-security-policy')).toContain('frame-ancestors');
  });

  test('a job serves only report.json and gate.log, as plain text under a sandbox CSP', async () => {
    const { server } = startExampleServer();
    const report = await fetch(new URL('api/jobs/J1/files/report.json', server.url));
    expect(report.status).toBe(200);
    expect(report.headers.get('content-type')).toStartWith('text/plain');
    expect(report.headers.get('content-security-policy')).toBe('sandbox');
    expect(await report.text()).toBe('text of report.json');
    expect(await (await fetch(new URL('api/jobs/J1/files/gate.log', server.url))).text()).toBe('text of gate.log');
    expect((await fetch(new URL('api/jobs/J1/files/events-1.ndjson', server.url))).status).toBe(404);
    expect((await fetch(new URL('api/jobs/J1/files/..%2Fprogress.json', server.url))).status).toBe(404);
  });

  test('a job path holding a malformed escape is a 404 under the page CSP, never a thrown 500', async () => {
    const { server } = startExampleServer();
    for (const path of ['api/jobs/%E0/files/report.json', 'api/jobs/J1/files/%E0', 'api/jobs/%E0/stream']) {
      const response = await fetch(new URL(path, server.url));
      expect(response.status).toBe(404);
      expect(response.headers.get('content-security-policy')).toContain('default-src \'self\'');
    }
  });

  test('a body-less POST /api/nudge only schedules a pass, without a token; /api/state and /api/summary answer their documents', async () => {
    const { server, nudges, commands } = startExampleServer();
    expect((await fetch(new URL('api/nudge', server.url), { method: 'POST' })).status).toBe(200);
    expect((await fetch(new URL('api/nudge', server.url), { method: 'POST', headers: { origin: 'https://example.com' } })).status).toBe(403);
    expect(nudges).toEqual(['nudge']);
    expect(commands).toEqual([]);
    expect(await (await fetch(new URL('api/state', server.url))).json()).toEqual({ notices: [{ kind: 'install-version-changed' }] });
    expect(await (await fetch(new URL('api/summary', server.url))).json()).toEqual({ summaryVersion: 1 });
  });

  test('a body that is no JSON is refused 400 before any route sees it', async () => {
    const { server, commands } = startExampleServer();
    const response = await fetch(new URL('api/commands', server.url), { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{' });
    expect(response.status).toBe(400);
    expect(commands).toEqual([]);
  });
});

describe('OverseerServer streams', () => {
  test('GET /api/events starts from the newest board, then sends each published event with its id', async () => {
    const { server, broker } = startExampleServer();
    broker.publishState(exampleState(1));
    const response = await fetch(new URL('api/events', server.url));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reading = streamTextUntil(response, (text) => text.includes('id: 1-2\nevent: board'));
    await Bun.sleep(50);
    broker.publishState(exampleState(2));
    const text = await reading;
    expect(text).toStartWith('id: 1-1\nevent: board\n');
    expect(text).toContain('"ticketCount":2');
  });

  test('a reconnect whose Last-Event-ID is of this generation gets only what it missed; another generation\'s starts fresh', async () => {
    const { server, broker } = startExampleServer();
    broker.publishState(exampleState(1));
    broker.publishState(exampleState(2));
    broker.publishState(exampleState(3));
    const replayed = await streamTextUntil(
      await fetch(new URL('api/events', server.url), { headers: { 'last-event-id': '1-1' } }),
      (text) => text.includes('id: 1-3'),
    );
    expect(replayed.match(/^id: .+$/gm)).toEqual(['id: 1-2', 'id: 1-3']);
    const fresh = await streamTextUntil(
      await fetch(new URL('api/events', server.url), { headers: { 'last-event-id': '7-2' } }),
      (text) => text.includes('\n\n'),
    );
    expect(fresh).toStartWith('id: 1-3\nevent: board\n');
  });

  test('a quiet event stream gets a ": ping" every SSE_HEARTBEAT_SECONDS', async () => {
    const { server, broker } = startExampleServer();
    broker.publishState(exampleState(1));
    const text = await streamTextUntil(await fetch(new URL('api/events', server.url)), (soFar) => soFar.includes(': ping\n\n'));
    expect(text).toContain(': ping\n\n');
  }, HEARTBEAT_TEST_TIMEOUT_MILLISECONDS);

  test('GET /api/jobs/<J>/stream sends the history after the cursor, then each new entry with its cursor as the id', async () => {
    const entries: TranscriptEntry[] = [{ cursor: '1.1', role: 'assistant', text: 'first' }];
    const cursorsAsked: (string | null)[] = [];
    const { server, broker } = startExampleServer({
      transcriptOf: (jobId, after) => {
        cursorsAsked.push(after);
        if (jobId !== 'J1') return null;
        return () => entries.splice(0);
      },
    });
    expect((await fetch(new URL('api/jobs/J9/stream', server.url))).status).toBe(404);
    const response = await fetch(new URL('api/jobs/J1/stream?after=1.0', server.url));
    const reading = streamTextUntil(response, (text) => text.includes('event: message'));
    await Bun.sleep(50);
    entries.push({
      cursor: '2.1', role: 'tool-call', text: 'ls', toolName: 'Bash'
    });
    broker.publishState(exampleState(1));
    const text = await reading;
    expect(text).toStartWith('id: 1.1\nevent: history\ndata: [{"cursor":"1.1"');
    expect(text).toContain('id: 2.1\nevent: message\ndata: {"cursor":"2.1","role":"tool-call"');
    expect(cursorsAsked).toEqual([null, '1.0']);
  });
});

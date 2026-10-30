/**
 * The Overseer's HTTP and SSE API on 127.0.0.1, design section 9.3. Every request needs a loopback Host, against DNS rebinding; one whose
 * Origin is not the API's own, a preflight above all, gets 403 and no route sends CORS headers, so the token never reaches another
 * origin's page. `POST /api/commands` needs the bearer token, `GET /api/session-token` a same-origin fetch, and every answer carries the
 * Bridge's CSP. What a command does, and how a refusal is worded, is the command surface's.
 */
import { timingSafeEqual } from 'node:crypto';

import type { HTMLBundle } from 'bun';

import { WATCHER_PROTOCOL_VERSION }                     from '../../lib/watcher/constants/WatcherProtocol.ts';
import type { TranscriptEntry }                         from '../../shared/@types/TranscriptEntry.ts';
import { SERVED_JOB_FILE_NAMES, SSE_HEARTBEAT_SECONDS } from '../../shared/constants/OverseerLimits.ts';
import { PRODUCT_NAMES }                                from '../../shared/constants/ProductNames.ts';
import type { EventBroker, OverseerEvent }              from './EventBroker.ts';
import { OverseerPort, type OverseerPortChoice }        from './OverseerPort.ts';

export interface OverseerIdentity {
  application:            string;
  trackerId:              string;
  project:                string;
  codeVersion:            string;
  installVersion:         number;
  watcherProtocolVersion: number;
  processId:              number;
}

/** A route's answer: the status and the JSON body. */
export interface RouteAnswer {
  status: number;
  body:   unknown;
}

/** A job's transcript after a cursor, re-read on each call; `null` for an unknown job or a cursor that is no `<instance>.<sequence>`. */
export type TranscriptFollower = () => TranscriptEntry[];

export interface OverseerRoutes {
  /** Read at each request, so a token written after the Baton was won is the one checked. */
  token:        () => string | null;
  /** A parsed `ControlCommand` body behind a valid token: 200, 409 worded, 400 or 423. */
  command:      (body: unknown) => Promise<RouteAnswer>;
  /** A verb's body-less `POST /api/nudge` after its write: it only schedules a pass, so it needs no token. */
  onNudge:      () => void;
  state:        () => unknown;
  summary:      () => unknown;
  /** `null` until the first state was published. */
  events:       () => EventBroker | null;
  transcriptOf: (jobId: string, after: string | null) => TranscriptFollower | null;
  /** A served job file's text, `null` when the job or the file does not exist. */
  jobFileText:  (jobId: string, fileName: string) => string | null;
  /** The origins allowed to frame the Bridge, read per response: agent-dashboard's. */
  frameOrigins: () => readonly string[];
  /**
   * The Bridge's HTML import, built by `Bun.build` on the first page request and served at `GET /` with its chunks beside it through
   * `fetch`, so every file carries the page CSP: Bun's own HTML route takes no headers. Absent, `GET /` is a 404 like any unknown path.
   */
  page?:        HTMLBundle;
}

export interface OverseerServerRequest {
  portChoice: OverseerPortChoice;
  identity:   Omit<OverseerIdentity, 'application' | 'watcherProtocolVersion'>;
  routes:     OverseerRoutes;
}

export interface OverseerServer {
  port: number;
  url:  string;
  stop: () => Promise<void>;
}

const LOOPBACK_ADDRESS = '127.0.0.1';
const LOOPBACK_NAMES   = [LOOPBACK_ADDRESS, 'localhost'];

const BEARER_PREFIX = 'Bearer ';
const SAME_ORIGIN_FETCH = 'same-origin';
const MILLISECONDS_PER_SECOND = 1000;

const HTTP_STATUS = {
  OK:           200,
  BAD_REQUEST:  400,
  UNAUTHORIZED: 401,
  FORBIDDEN:    403,
  NOT_FOUND:    404,
  SERVER_ERROR: 500,
} as const;

const PAGE_INDEX_PATH = '/';
const BUILT_PAGE_INDEX_NAME = 'index.html';

// Job ids and served file names need no percent-decoding, so a segment holding an escape is no route and gets the 404.
const JOB_STREAM_PATH = /^\/api\/jobs\/([\w.-]+)\/stream$/;
const JOB_FILE_PATH   = /^\/api\/jobs\/([\w.-]+)\/files\/([\w.-]+)$/;

function contentSecurityPolicyOf(frameOrigins: readonly string[]): string {
  const frameAncestors = frameOrigins.length === 0 ? '\'none\'' : frameOrigins.join(' ');
  return 'default-src \'self\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\' data:; object-src \'none\'; '
    + `base-uri 'none'; form-action 'none'; frame-ancestors ${frameAncestors}`;
}

function jsonResponse(answer: RouteAnswer): Response {
  return Response.json(answer.body, { status: answer.status });
}

function hostIsLoopback(request: Request, port: number): boolean {
  const host = request.headers.get('host');
  return host !== null && LOOPBACK_NAMES.some((name) => host === `${name}:${port}`);
}

/** No Origin, as a server process or a same-origin GET sends it, or the API's own. */
function originIsOwn(request: Request, port: number): boolean {
  const origin = request.headers.get('origin');
  return origin === null || LOOPBACK_NAMES.some((name) => origin === `http://${name}:${port}`);
}

function bearerTokenMatches(request: Request, expectedToken: string | null): boolean {
  const authorization = request.headers.get('authorization');
  if (expectedToken === null || authorization === null || !authorization.startsWith(BEARER_PREFIX)) return false;
  const offered  = Buffer.from(authorization.slice(BEARER_PREFIX.length));
  const expected = Buffer.from(expectedToken);
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

async function answerCommand(request: Request, routes: OverseerRoutes): Promise<Response> {
  if (!bearerTokenMatches(request, routes.token())) return jsonResponse({ status: HTTP_STATUS.UNAUTHORIZED, body: { refusal: 'unauthorized' } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ status: HTTP_STATUS.BAD_REQUEST, body: { refusal: 'malformed-body' } });
  }
  return jsonResponse(await routes.command(body));
}

function sessionTokenResponse(request: Request, routes: OverseerRoutes): Response {
  const token = routes.token();
  if (request.headers.get('sec-fetch-site') !== SAME_ORIGIN_FETCH || token === null) {
    return jsonResponse({ status: HTTP_STATUS.FORBIDDEN, body: { refusal: 'forbidden' } });
  }
  return jsonResponse({ status: HTTP_STATUS.OK, body: { token } });
}

/** Each open event stream's closer, so a stopping server ends them and its graceful stop is not held open by a client. */
type OpenStreams = Set<() => void>;

/** An SSE response whose writer sends a `: ping` every `SSE_HEARTBEAT_SECONDS` and runs `tick` with it, until the client or the server goes. */
function eventStreamResponse(openStreams: OpenStreams, start: (write: (text: string) => void) => { tick: () => void; stop: () => void }): Response {
  const encoder = new TextEncoder();
  let finish = (): void => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      const started = start(write);
      const heartbeat = setInterval(() => {
        write(': ping\n\n');
        started.tick();
      }, SSE_HEARTBEAT_SECONDS * MILLISECONDS_PER_SECOND);
      finish = () => {
        clearInterval(heartbeat);
        started.stop();
        openStreams.delete(close);
      };
      const close = () => {
        finish();
        controller.close();
      };
      openStreams.add(close);
    },
    cancel() {
      finish();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}

function eventText(event: Pick<OverseerEvent, 'id' | 'kind' | 'data'>): string {
  return `id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function eventsResponse(request: Request, routes: OverseerRoutes, openStreams: OpenStreams): Response {
  const broker = routes.events();
  if (broker === null) return jsonResponse({ status: HTTP_STATUS.NOT_FOUND, body: { refusal: 'not-ready' } });
  return eventStreamResponse(openStreams, (write) => {
    const replay = broker.replayAfter(request.headers.get('last-event-id'));
    const snapshot = broker.snapshot();
    if (replay.verdict === 'replayed') replay.events.forEach((event) => write(eventText(event)));
    else if (snapshot !== null) write(eventText(snapshot));
    const unsubscribe = broker.subscribe((event) => write(eventText(event)));
    return { tick: () => undefined, stop: unsubscribe };
  });
}

function transcriptResponse(request: Request, routes: OverseerRoutes, jobId: string, openStreams: OpenStreams): Response {
  const after = request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('after');
  const follow = routes.transcriptOf(jobId, after);
  if (follow === null) return jsonResponse({ status: HTTP_STATUS.NOT_FOUND, body: { refusal: 'not-found' } });
  return eventStreamResponse(openStreams, (write) => {
    const history = follow();
    const lastCursor = history.at(-1)?.cursor ?? after ?? '';
    write(`id: ${lastCursor}\nevent: history\ndata: ${JSON.stringify(history)}\n\n`);
    const sendNew = () => follow().forEach((entry) => write(`id: ${entry.cursor}\nevent: message\ndata: ${JSON.stringify(entry)}\n\n`));
    const unsubscribe = routes.events()?.subscribe(sendNew) ?? (() => undefined);
    return { tick: sendNew, stop: unsubscribe };
  });
}

function jobFileResponse(routes: OverseerRoutes, jobId: string, fileName: string): Response {
  const text = SERVED_JOB_FILE_NAMES.includes(fileName) ? routes.jobFileText(jobId, fileName) : null;
  if (text === null) return jsonResponse({ status: HTTP_STATUS.NOT_FOUND, body: { refusal: 'not-found' } });
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': 'sandbox' } });
}

/** The built Bridge's files by the path each is served at: the page at `/`, every chunk at its own name. */
type BuiltPageFiles = ReadonlyMap<string, Blob>;

type BuiltPageOutcome =
  | { verdict: 'built'; files: BuiltPageFiles }
  | { verdict: 'failed' };

async function buildPage(page: HTMLBundle): Promise<BuiltPageOutcome> {
  const built = await Bun.build({
    entrypoints: [page.index],
    target:      'browser',
    minify:      true,
    define:      { 'process.env.NODE_ENV': '"production"' },
    jsx:         { development: false },
    throw:       false,
  });
  if (!built.success) return { verdict: 'failed' };
  const files = new Map<string, Blob>();
  for (const output of built.outputs) {
    const fileName = output.path.replace(/^\.\//, '');
    files.set(fileName === BUILT_PAGE_INDEX_NAME ? PAGE_INDEX_PATH : `/${fileName}`, output);
  }
  return { verdict: 'built', files };
}

/** Builds the page on the first request and hands every later one that build; a failed build is retried by the next request. */
function pageFilesOf(page: HTMLBundle): () => Promise<BuiltPageOutcome> {
  let building: Promise<BuiltPageOutcome> | null = null;
  return async () => {
    building ??= buildPage(page);
    const outcome = await building;
    if (outcome.verdict === 'failed') building = null;
    return outcome;
  };
}

function notFoundResponse(): Response {
  return jsonResponse({ status: HTTP_STATUS.NOT_FOUND, body: { refusal: 'not-found' } });
}

async function pageFileResponse(pageFiles: () => Promise<BuiltPageOutcome>, pathname: string): Promise<Response> {
  const outcome = await pageFiles();
  if (outcome.verdict === 'failed') return jsonResponse({ status: HTTP_STATUS.SERVER_ERROR, body: { refusal: 'page-build-failed' } });
  const file = outcome.files.get(pathname);
  return file === undefined ? notFoundResponse() : new Response(file, { headers: { 'content-type': file.type } });
}

type PageFiles = (() => Promise<BuiltPageOutcome>) | null;

function routeOf(request: Request, routes: OverseerRoutes, identity: OverseerIdentity, openStreams: OpenStreams, pageFiles: PageFiles): Response | Promise<Response> {
  const { pathname } = new URL(request.url);
  const { method } = request;
  if (method === 'GET' && pathname === '/api/identity') return jsonResponse({ status: HTTP_STATUS.OK, body: identity });
  if (method === 'GET' && pathname === '/api/session-token') return sessionTokenResponse(request, routes);
  if (method === 'GET' && pathname === '/api/state') return jsonResponse({ status: HTTP_STATUS.OK, body: routes.state() });
  if (method === 'GET' && pathname === '/api/summary') return jsonResponse({ status: HTTP_STATUS.OK, body: routes.summary() });
  if (method === 'GET' && pathname === '/api/events') return eventsResponse(request, routes, openStreams);
  if (method === 'POST' && pathname === '/api/commands') return answerCommand(request, routes);
  if (method === 'POST' && pathname === '/api/nudge') {
    routes.onNudge();
    return jsonResponse({ status: HTTP_STATUS.OK, body: { outcome: 'done' } });
  }
  const jobStream = method === 'GET' ? JOB_STREAM_PATH.exec(pathname) : null;
  if (jobStream?.[1] !== undefined) return transcriptResponse(request, routes, jobStream[1], openStreams);
  const jobFile = method === 'GET' ? JOB_FILE_PATH.exec(pathname) : null;
  if (jobFile?.[1] !== undefined && jobFile[2] !== undefined) return jobFileResponse(routes, jobFile[1], jobFile[2]);
  if (method === 'GET' && pageFiles !== null && !pathname.startsWith('/api/')) return pageFileResponse(pageFiles, pathname);
  return notFoundResponse();
}

/** The job file's own sandbox policy stands; every other answer carries the page's. */
function withPagePolicy(response: Response, frameOrigins: readonly string[]): Response {
  if (!response.headers.has('content-security-policy')) response.headers.set('content-security-policy', contentSecurityPolicyOf(frameOrigins));
  return response;
}

function start(serverRequest: OverseerServerRequest): OverseerServer {
  const { routes } = serverRequest;
  const openStreams: OpenStreams = new Set();
  const pageFiles = routes.page === undefined ? null : pageFilesOf(routes.page);
  const identity: OverseerIdentity = { application: PRODUCT_NAMES.PROGRAM, ...serverRequest.identity, watcherProtocolVersion: WATCHER_PROTOCOL_VERSION };
  const server = OverseerPort.bindFirstFree(serverRequest.portChoice, (port) => Bun.serve({
    hostname:    LOOPBACK_ADDRESS,
    port,
    reusePort:   false,
    development: false,
    async fetch(request, ownServer) {
      const boundPort = ownServer.port ?? port;
      const frameOrigins = routes.frameOrigins();
      // A preflight is refused like a foreign Origin: no route answers one, so no browser of another origin may send a write.
      if (!hostIsLoopback(request, boundPort) || !originIsOwn(request, boundPort) || request.method === 'OPTIONS') {
        return withPagePolicy(jsonResponse({ status: HTTP_STATUS.FORBIDDEN, body: { refusal: 'forbidden' } }), frameOrigins);
      }
      // Bun's idle timeout would close a quiet event stream mid-response; its heartbeat keeps it under the timeout anyway.
      const { pathname } = new URL(request.url);
      if (pathname === '/api/events' || JOB_STREAM_PATH.test(pathname)) ownServer.timeout(request, 0);
      return withPagePolicy(await routeOf(request, routes, identity, openStreams, pageFiles), frameOrigins);
    },
  }));
  const boundPort = server.port ?? 0;
  return {
    port: boundPort,
    url:  `http://${LOOPBACK_ADDRESS}:${boundPort}/`,
    // Graceful: the answer to the `overseer-stop` that ended the Overseer is still in flight when the listener closes.
    stop: async () => {
      for (const close of [...openStreams]) close();
      await server.stop(false);
    },
  };
}

export const OverseerServer = Object.freeze({ start });

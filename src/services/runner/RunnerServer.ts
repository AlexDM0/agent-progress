/**
 * The runner's minimal HTTP server on 127.0.0.1: `GET /api/identity`, `GET /api/state` and the body-less `POST /api/nudge` for anyone on
 * the machine, and `POST /api/commands` for the two runtime-only commands, `runner-stop` and `runner-restart`, behind the bearer token.
 * A foreign Host or any Origin is refused, against DNS rebinding and cross-site requests.
 */
import { timingSafeEqual } from 'node:crypto';

import { HOST_PROTOCOL_VERSION }             from '../../lib/agent-host/constants/HostProtocol.ts';
import { PRODUCT_NAMES }                     from '../../shared/constants/ProductNames.ts';
import { RunnerPort, type RunnerPortChoice } from './RunnerPort.ts';

export interface RunnerIdentity {
  application:         string;
  trackerId:           string;
  project:             string;
  codeVersion:         string;
  installVersion:      number;
  hostProtocolVersion: number;
  processId:           number;
}

export interface RuntimeRunnerCommand {
  kind: 'runner-stop' | 'runner-restart';
  now:  boolean;
}

export interface RunnerServerRequest {
  portChoice:       RunnerPortChoice;
  identity:         Omit<RunnerIdentity, 'application' | 'hostProtocolVersion'>;
  /** Read at each request, so a token written after the lease was won is the one checked. */
  token:            () => string | null;
  onRuntimeCommand: (command: RuntimeRunnerCommand) => void;
  /** A verb's body-less `POST /api/nudge` after its write: it only asks for a pass, so it needs no token. */
  onNudge:          () => void;
  /** The runner's state document, notices included, derived each pass and never stored. */
  state:            () => unknown;
}

export interface RunnerServer {
  port: number;
  url:  string;
  stop: () => Promise<void>;
}

const LOOPBACK_ADDRESS = '127.0.0.1';
const LOOPBACK_NAMES   = [LOOPBACK_ADDRESS, 'localhost'];

const BEARER_PREFIX = 'Bearer ';

const RUNTIME_COMMAND_KINDS: readonly string[] = ['runner-stop', 'runner-restart'];

const HTTP_STATUS = {
  OK:           200,
  BAD_REQUEST:  400,
  UNAUTHORIZED: 401,
  FORBIDDEN:    403,
  NOT_FOUND:    404,
} as const;

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function hostIsLoopback(request: Request, port: number): boolean {
  const host = request.headers.get('host');
  return host !== null && LOOPBACK_NAMES.some((name) => host === `${name}:${port}`);
}

function bearerTokenMatches(request: Request, expectedToken: string | null): boolean {
  const authorization = request.headers.get('authorization');
  if (expectedToken === null || authorization === null || !authorization.startsWith(BEARER_PREFIX)) return false;
  const offered  = Buffer.from(authorization.slice(BEARER_PREFIX.length));
  const expected = Buffer.from(expectedToken);
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

function runtimeCommandOf(body: unknown): RuntimeRunnerCommand | null {
  if (typeof body !== 'object' || body === null) return null;
  const { kind, now } = body as { kind?: unknown; now?: unknown };
  if (typeof kind !== 'string' || !RUNTIME_COMMAND_KINDS.includes(kind)) return null;
  if (now !== undefined && typeof now !== 'boolean') return null;
  return { kind: kind as RuntimeRunnerCommand['kind'], now: now === true };
}

async function answerCommand(request: Request, serverRequest: RunnerServerRequest): Promise<Response> {
  if (!bearerTokenMatches(request, serverRequest.token())) return jsonResponse({ refusal: 'unauthorized' }, HTTP_STATUS.UNAUTHORIZED);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ refusal: 'malformed-body' }, HTTP_STATUS.BAD_REQUEST);
  }
  const command = runtimeCommandOf(body);
  if (command === null) return jsonResponse({ refusal: 'malformed-body' }, HTTP_STATUS.BAD_REQUEST);
  serverRequest.onRuntimeCommand(command);
  return jsonResponse({ outcome: 'done', result: { kind: command.kind } }, HTTP_STATUS.OK);
}

function start(serverRequest: RunnerServerRequest): RunnerServer {
  const identity: RunnerIdentity = { application: PRODUCT_NAMES.PROGRAM, ...serverRequest.identity, hostProtocolVersion: HOST_PROTOCOL_VERSION };
  const server = RunnerPort.bindFirstFree(serverRequest.portChoice, (port) => Bun.serve({
    hostname:  LOOPBACK_ADDRESS,
    port,
    reusePort: false,
    fetch(request, ownServer) {
      if (!hostIsLoopback(request, ownServer.port ?? port) || request.headers.has('origin')) {
        return jsonResponse({ refusal: 'forbidden' }, HTTP_STATUS.FORBIDDEN);
      }
      const { pathname } = new URL(request.url);
      if (request.method === 'GET' && pathname === '/api/identity') return jsonResponse(identity, HTTP_STATUS.OK);
      if (request.method === 'POST' && pathname === '/api/commands') return answerCommand(request, serverRequest);
      if (request.method === 'POST' && pathname === '/api/nudge') {
        serverRequest.onNudge();
        return jsonResponse({ outcome: 'done' }, HTTP_STATUS.OK);
      }
      if (request.method === 'GET' && pathname === '/api/state') return jsonResponse(serverRequest.state(), HTTP_STATUS.OK);
      return jsonResponse({ refusal: 'not-found' }, HTTP_STATUS.NOT_FOUND);
    },
  }));
  const boundPort = server.port ?? 0;
  return {
    port: boundPort,
    url:  `http://${LOOPBACK_ADDRESS}:${boundPort}/`,
    // Graceful: the answer to the `runner-stop` that ended the runner is still in flight when the listener closes.
    stop: () => server.stop(false),
  };
}

export const RunnerServer = Object.freeze({ start });

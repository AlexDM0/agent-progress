/**
 * A protocol 1 client for specs that spawn the host binary: it connects once the host has bound its socket, sends raw lines or frames, and
 * waits for a received frame by predicate or for the host to close the connection. Test-only.
 */
import { type Socket, createConnection } from 'node:net';

import type { HostFrame } from '../lib/agent-host/@types/HostFrame.ts';

const CONNECT_ATTEMPTS = 400;
const CONNECT_RETRY_MILLISECONDS = 25;

export interface HostProtocolClient {
  /** A string goes as it is, so a spec can send a line that is no frame; anything else is sent as one JSON line. */
  readonly send:      (frame: string | object) => void;
  /** Resolves with the first frame received, earlier or later, that matches and was not returned before. */
  readonly nextFrame: (matches: (frame: HostFrame) => boolean) => Promise<HostFrame>;
  readonly received:  () => readonly HostFrame[];
  /** Resolves once the host has closed the connection. */
  readonly closed:    Promise<void>;
  readonly close:     () => void;
}

function connectOnce(socketPath: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', () => resolve(null));
  });
}

export async function connectToHost(socketPath: string): Promise<HostProtocolClient> {
  let socket: Socket | null = null;
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS && socket === null; attempt += 1) {
    socket = await connectOnce(socketPath);
    if (socket === null) await Bun.sleep(CONNECT_RETRY_MILLISECONDS);
  }
  if (socket === null) throw new Error(`no host listens on ${socketPath}`);
  const connected = socket;
  const frames: HostFrame[] = [];
  const consumed = new Set<HostFrame>();
  const waiters: { matches: (frame: HostFrame) => boolean; resolve: (frame: HostFrame) => void }[] = [];
  const settleWaiters = (): void => {
    for (const waiter of [...waiters]) {
      const found = frames.find((frame) => !consumed.has(frame) && waiter.matches(frame));
      if (found === undefined) continue;
      consumed.add(found);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(found);
    }
  };
  let pending = '';
  connected.setEncoding('utf8');
  connected.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) frames.push(JSON.parse(line) as HostFrame);
    settleWaiters();
  });
  const closed = new Promise<void>((resolve) => {
    connected.on('close', () => resolve());
  });
  connected.on('error', () => undefined);
  return {
    send: (frame) => {
      connected.write(`${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n`);
    },
    nextFrame: (matches) => new Promise((resolve) => {
      waiters.push({ matches, resolve });
      settleWaiters();
    }),
    received: () => [...frames],
    closed,
    close:    () => {
      connected.destroy();
    },
  };
}

/**
 * Protocol 1 on a host's socket: a client's first frame must be a `hello` naming this protocol and the host's secret, answered by
 * `welcome` and the history after its cursor; then it receives every broadcast frame and may send the frames its host accepts. Anything
 * else is answered `refused` and the client closed.
 */
import { timingSafeEqual }                        from 'node:crypto';
import { rmSync }                                 from 'node:fs';
import { type Server, type Socket, createServer } from 'node:net';

import type {
  ActingFrame,
  ClientFrame,
  HostFrame,
  HostRefusalReason,
  WelcomeFrame
} from './@types/HostFrame.ts';
import type { EventLogEntry }             from './EventLog.ts';
import { clientFrameOf, hostFrameLineOf } from './HostFrames.ts';
import { HOST_PROTOCOL_VERSION }          from './constants/HostProtocol.ts';

const LINE_SEPARATOR = '\n';

export interface HostSocketOptions {
  readonly socketPath:     string;
  readonly hostSecret:     string;
  /** The acting frames this host takes; any other is a protocol refusal. */
  readonly acceptedKinds:  readonly ActingFrame['kind'][];
  readonly welcomeOf:      () => Omit<WelcomeFrame, 'kind' | 'lastSequence' | 'protocolVersion'>;
  /** The whole event log as it stands on the disk, read after it is synced. */
  readonly durableEntries: () => readonly EventLogEntry[];
  /** Every complete line any client sends, before it is judged, so an ended host can count them. */
  readonly onClientLine:   () => void;
  readonly onActingFrame:  (frame: ActingFrame) => void;
}

export interface HostSocketServer {
  readonly broadcast: (frame: HostFrame) => void;
  readonly close:     () => void;
}

export type HostSocketListening =
  | { readonly verdict: 'listening'; readonly server: HostSocketServer }
  | { readonly verdict: 'unbindable'; readonly reason: string };

function secretsMatch(offered: string, expected: string): boolean {
  const offeredBytes = Buffer.from(offered, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return offeredBytes.length === expectedBytes.length && timingSafeEqual(offeredBytes, expectedBytes);
}

function helloRefusalOf(frame: ClientFrame | null, hostSecret: string): HostRefusalReason | null {
  if (frame?.kind !== 'hello' || frame.protocolVersion !== HOST_PROTOCOL_VERSION) return 'protocol';
  return secretsMatch(frame.hostSecret, hostSecret) ? null : 'secret';
}

function welcomeAndHistoryOf(options: HostSocketOptions, sinceSequence: number): readonly HostFrame[] {
  const entries = options.durableEntries();
  const welcome: WelcomeFrame = {
    kind: 'welcome', protocolVersion: HOST_PROTOCOL_VERSION, ...options.welcomeOf(), lastSequence: entries.at(-1)?.sequence ?? 0,
  };
  return [welcome, { kind: 'history', entries: entries.filter((entry) => entry.sequence > sinceSequence) }];
}

function serveConnection(socket: Socket, options: HostSocketOptions, attachedClients: Set<Socket>): void {
  let pending = '';
  let refused = false;
  const refuse = (reason: HostRefusalReason): void => {
    refused = true;
    attachedClients.delete(socket);
    socket.end(hostFrameLineOf({ kind: 'refused', reason }));
  };
  const consumeLine = (line: string): void => {
    options.onClientLine();
    const frame = clientFrameOf(line);
    if (!attachedClients.has(socket)) {
      const refusal = helloRefusalOf(frame, options.hostSecret);
      if (refusal !== null || frame?.kind !== 'hello') {
        refuse(refusal ?? 'protocol');
        return;
      }
      // Welcome, history and joining the broadcast happen in one turn, so no entry falls between the history and the first message.
      for (const answer of welcomeAndHistoryOf(options, frame.sinceSequence)) socket.write(hostFrameLineOf(answer));
      attachedClients.add(socket);
      return;
    }
    if (frame === null || frame.kind === 'hello' || !options.acceptedKinds.includes(frame.kind)) {
      refuse('protocol');
      return;
    }
    options.onActingFrame(frame);
  };
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    pending += chunk;
    let separatorIndex = pending.indexOf(LINE_SEPARATOR);
    while (separatorIndex !== -1 && !refused) {
      const line = pending.slice(0, separatorIndex);
      pending = pending.slice(separatorIndex + 1);
      consumeLine(line);
      separatorIndex = pending.indexOf(LINE_SEPARATOR);
    }
  });
  socket.on('close', () => attachedClients.delete(socket));
  socket.on('error', () => attachedClients.delete(socket));
}

export async function listenOnHostSocket(options: HostSocketOptions): Promise<HostSocketListening> {
  const attachedClients = new Set<Socket>();
  const openConnections = new Set<Socket>();
  const server: Server = createServer((socket) => {
    openConnections.add(socket);
    socket.on('close', () => openConnections.delete(socket));
    serveConnection(socket, options, attachedClients);
  });
  const bindError = await new Promise<Error | null>((resolve) => {
    server.once('error', resolve);
    server.listen(options.socketPath, () => resolve(null));
  });
  if (bindError !== null) return { verdict: 'unbindable', reason: String(bindError) };
  return {
    verdict: 'listening',
    server:  {
      broadcast: (frame) => {
        const line = hostFrameLineOf(frame);
        for (const client of attachedClients) client.write(line);
      },
      close: () => {
        server.close();
        for (const connection of openConnections) connection.end();
        rmSync(options.socketPath, { force: true });
      },
    },
  };
}

/**
 * Protocol 1 on a Watcher's socket: a client's first frame must be a `hello` naming this protocol and the Watcher's secret, answered by
 * `welcome` and the history after its cursor; then it receives every broadcast frame and may send the frames its Watcher accepts. Anything
 * else is answered `refused` and the client closed.
 */
import { timingSafeEqual }                        from 'node:crypto';
import { rmSync }                                 from 'node:fs';
import { type Server, type Socket, createServer } from 'node:net';

import type {
  ActingFrame,
  ClientFrame,
  WatcherFrame,
  WatcherRefusalReason,
  WelcomeFrame
} from './@types/WatcherFrame.ts';
import type { EventLogEntry }                from './EventLog.ts';
import { clientFrameOf, watcherFrameLineOf } from './WatcherFrames.ts';
import { WATCHER_PROTOCOL_VERSION }          from './constants/WatcherProtocol.ts';

const LINE_SEPARATOR = '\n';

export interface WatcherSocketOptions {
  readonly socketPath:     string;
  readonly watcherSecret:  string;
  /** The acting frames this Watcher takes; any other is a protocol refusal. */
  readonly acceptedKinds:  readonly ActingFrame['kind'][];
  readonly welcomeOf:      () => Omit<WelcomeFrame, 'kind' | 'lastSequence' | 'protocolVersion'>;
  /** The whole event log as it stands on the disk, read after it is synced. */
  readonly durableEntries: () => readonly EventLogEntry[];
  /** Every complete line any client sends, before it is judged, so an ended Watcher can count them. */
  readonly onClientLine:   () => void;
  readonly onActingFrame:  (frame: ActingFrame) => void;
}

export interface WatcherSocketServer {
  readonly broadcast: (frame: WatcherFrame) => void;
  readonly close:     () => void;
}

export type WatcherSocketListening =
  | { readonly verdict: 'listening'; readonly server: WatcherSocketServer }
  | { readonly verdict: 'unbindable'; readonly reason: string };

function secretsMatch(offered: string, expected: string): boolean {
  const offeredBytes = Buffer.from(offered, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return offeredBytes.length === expectedBytes.length && timingSafeEqual(offeredBytes, expectedBytes);
}

function helloRefusalOf(frame: ClientFrame | null, watcherSecret: string): WatcherRefusalReason | null {
  if (frame?.kind !== 'hello' || frame.protocolVersion !== WATCHER_PROTOCOL_VERSION) return 'protocol';
  return secretsMatch(frame.watcherSecret, watcherSecret) ? null : 'secret';
}

function welcomeAndHistoryOf(options: WatcherSocketOptions, sinceSequence: number): readonly WatcherFrame[] {
  const entries = options.durableEntries();
  const welcome: WelcomeFrame = {
    kind: 'welcome', protocolVersion: WATCHER_PROTOCOL_VERSION, ...options.welcomeOf(), lastSequence: entries.at(-1)?.sequence ?? 0,
  };
  return [welcome, { kind: 'history', entries: entries.filter((entry) => entry.sequence > sinceSequence) }];
}

function serveConnection(socket: Socket, options: WatcherSocketOptions, attachedClients: Set<Socket>): void {
  let pending = '';
  let refused = false;
  const refuse = (reason: WatcherRefusalReason): void => {
    refused = true;
    attachedClients.delete(socket);
    socket.end(watcherFrameLineOf({ kind: 'refused', reason }));
  };
  const consumeLine = (line: string): void => {
    options.onClientLine();
    const frame = clientFrameOf(line);
    if (!attachedClients.has(socket)) {
      const refusal = helloRefusalOf(frame, options.watcherSecret);
      if (refusal !== null || frame?.kind !== 'hello') {
        refuse(refusal ?? 'protocol');
        return;
      }
      // Welcome, history and joining the broadcast happen in one turn, so no entry falls between the history and the first message.
      for (const answer of welcomeAndHistoryOf(options, frame.sinceSequence)) socket.write(watcherFrameLineOf(answer));
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

export async function listenOnWatcherSocket(options: WatcherSocketOptions): Promise<WatcherSocketListening> {
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
        const line = watcherFrameLineOf(frame);
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

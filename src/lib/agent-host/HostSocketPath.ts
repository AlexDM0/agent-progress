/**
 * Where a host instance listens: `<monitor folder>/hosts/<first 16 hex of sha256(trackerId, jobId, instance)>.sock`, one path per instance
 * so a lingering ended host never holds its successor's, and short enough for the 104 bytes macOS keeps for a socket path.
 */
import { createHash }                   from 'node:crypto';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join }                from 'node:path';

import { HOST_SOCKET_PATH_LIMIT_BYTES } from './constants/HostProtocol.ts';

const HOST_SOCKET_FOLDER_NAME = 'hosts';
const HOST_SOCKET_NAME_HEX_DIGITS = 16;
const OWNER_ONLY_FOLDER_MODE = 0o700;

export function hostSocketPathOf(monitorFolder: string, trackerId: string, jobId: string, instance: number): string {
  const digest = createHash('sha256').update(`${trackerId}\n${jobId}\n${instance}`).digest('hex');
  return join(monitorFolder, HOST_SOCKET_FOLDER_NAME, `${digest.slice(0, HOST_SOCKET_NAME_HEX_DIGITS)}.sock`);
}

/** The limit counts the terminating zero byte, so the longest bindable path is one byte shorter. */
export function socketPathFits(socketPath: string): boolean {
  return Buffer.byteLength(socketPath, 'utf8') < HOST_SOCKET_PATH_LIMIT_BYTES;
}

/** Creates the socket's folder readable by its owner alone, and clears a socket file a dead host of this instance left behind. */
export function prepareSocketFolder(socketPath: string): void {
  const folder = dirname(socketPath);
  mkdirSync(folder, { recursive: true, mode: OWNER_ONLY_FOLDER_MODE });
  chmodSync(folder, OWNER_ONLY_FOLDER_MODE);
  rmSync(socketPath, { force: true });
}

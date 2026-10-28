/**
 * The socket path's contract: the first 16 hex digits of sha256 over tracker id, job id and instance joined by newlines, under the monitor
 * folder's `hosts/`, fitting the 104 bytes macOS keeps with a realistic home; and the fit check's boundary, the zero byte counted.
 */
import { expect, test } from 'bun:test';

import { hostSocketPathOf, socketPathFits } from './HostSocketPath.ts';
import { HOST_SOCKET_PATH_LIMIT_BYTES }     from './constants/HostProtocol.ts';

const MONITOR_FOLDER = '/Users/alex.example/.agent-progress-v2-monitor';

test('names the socket by the first 16 hex of sha256(trackerId, jobId, instance) under hosts/', () => {
  // Computed by `printf 'tracker-example\nJ-1\n1' | shasum -a 256 | cut -c1-16`.
  const digest = new Bun.CryptoHasher('sha256').update('tracker-example\nJ-1\n1').digest('hex').slice(0, 16);
  expect(hostSocketPathOf(MONITOR_FOLDER, 'tracker-example', 'J-1', 1)).toBe(`${MONITOR_FOLDER}/hosts/${digest}.sock`);
  expect(hostSocketPathOf(MONITOR_FOLDER, 'tracker-example', 'J-1', 2)).not.toBe(hostSocketPathOf(MONITOR_FOLDER, 'tracker-example', 'J-1', 1));
});

test('fits the limit under a realistic home', () => {
  const socketPath = hostSocketPathOf(MONITOR_FOLDER, 'tracker-example', 'J-123', 7);
  expect(Buffer.byteLength(socketPath)).toBeLessThan(HOST_SOCKET_PATH_LIMIT_BYTES);
  expect(socketPathFits(socketPath)).toBe(true);
});

test('a path one byte short of the limit fits, and one of the limit does not', () => {
  expect(socketPathFits(`/${'s'.repeat(HOST_SOCKET_PATH_LIMIT_BYTES - 2)}`)).toBe(true);
  expect(socketPathFits(`/${'s'.repeat(HOST_SOCKET_PATH_LIMIT_BYTES - 1)}`)).toBe(false);
});

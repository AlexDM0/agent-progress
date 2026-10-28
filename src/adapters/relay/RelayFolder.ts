/** A job's relay folder: `requests/<requestId>.json` its session writes, `replies/<requestId>.json` the runner answers with. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join }                                from 'node:path';

import { writeFileAtomically }                  from '../../lib/atomic-file/AtomicFile.ts';
import type { RelayReplyReading, RelayRequest } from './@types/RelayFormat.ts';
import { RelayFormatUtil }                      from './utils/RelayFormatUtil.ts';

const REQUESTS_FOLDER_NAME = 'requests';
const REPLIES_FOLDER_NAME  = 'replies';
const RELAY_FILE_EXTENSION = '.json';

export type RelayReplyLookup = RelayReplyReading | { verdict: 'absent' };

export function relayRequestFilePathOf(relayDirectory: string, requestId: string): string {
  return join(relayDirectory, REQUESTS_FOLDER_NAME, `${requestId}${RELAY_FILE_EXTENSION}`);
}

export function relayReplyFilePathOf(relayDirectory: string, requestId: string): string {
  return join(relayDirectory, REPLIES_FOLDER_NAME, `${requestId}${RELAY_FILE_EXTENSION}`);
}

/** Atomic, so the runner listing the folder never reads half a request. */
export function writeRelayRequest(relayDirectory: string, request: RelayRequest): string {
  const filePath = relayRequestFilePathOf(relayDirectory, request.requestId);
  mkdirSync(join(relayDirectory, REQUESTS_FOLDER_NAME), { recursive: true });
  writeFileAtomically(filePath, `${JSON.stringify(request, null, 2)}\n`);
  return filePath;
}

export function relayReplyLookupOf(relayDirectory: string, requestId: string): RelayReplyLookup {
  const filePath = relayReplyFilePathOf(relayDirectory, requestId);
  if (!existsSync(filePath)) return { verdict: 'absent' };
  return RelayFormatUtil.replyReadingOf(readFileSync(filePath, 'utf8'));
}

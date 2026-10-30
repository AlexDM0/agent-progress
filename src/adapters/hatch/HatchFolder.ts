/** A job's Hatch folder: `requests/<requestId>.json` its session writes, `replies/<requestId>.json` the Overseer answers with. */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join }                                from 'node:path';

import { writeFileAtomically }                  from '../../lib/atomic-file/AtomicFile.ts';
import type { HatchReplyReading, HatchRequest } from './@types/HatchFormat.ts';
import { HatchFormatUtil }                      from './utils/HatchFormatUtil.ts';

const REQUESTS_FOLDER_NAME = 'requests';
const REPLIES_FOLDER_NAME  = 'replies';
const HATCH_FILE_EXTENSION = '.json';

export type HatchReplyLookup = HatchReplyReading | { verdict: 'absent' };

export function hatchRequestFilePathOf(hatchDirectory: string, requestId: string): string {
  return join(hatchDirectory, REQUESTS_FOLDER_NAME, `${requestId}${HATCH_FILE_EXTENSION}`);
}

export function hatchReplyFilePathOf(hatchDirectory: string, requestId: string): string {
  return join(hatchDirectory, REPLIES_FOLDER_NAME, `${requestId}${HATCH_FILE_EXTENSION}`);
}

/** Atomic, so the Overseer listing the folder never reads half a request. */
export function writeHatchRequest(hatchDirectory: string, request: HatchRequest): string {
  const filePath = hatchRequestFilePathOf(hatchDirectory, request.requestId);
  mkdirSync(join(hatchDirectory, REQUESTS_FOLDER_NAME), { recursive: true });
  writeFileAtomically(filePath, `${JSON.stringify(request, null, 2)}\n`);
  return filePath;
}

export function hatchReplyLookupOf(hatchDirectory: string, requestId: string): HatchReplyLookup {
  const filePath = hatchReplyFilePathOf(hatchDirectory, requestId);
  if (!existsSync(filePath)) return { verdict: 'absent' };
  return HatchFormatUtil.replyReadingOf(readFileSync(filePath, 'utf8'));
}

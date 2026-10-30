/**
 * `usage-limit.json` in the monitor folder: the machine-wide usage-limit marker every Overseer reads as a `limits` input, so a limit one board
 * met holds launches on all of them. Read, validate and map; written through the atomic-file package.
 */
import { mkdirSync } from 'node:fs';
import { join }      from 'node:path';

import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import { storedFileTextOf }    from '../StoredFileText.ts';
import { StoredValueUtil }     from '../utils/StoredValueUtil.ts';

export interface UsageMarker {
  vendor:   string;
  window:   string;
  /** An ISO stamp: no launch, resume or orchestrator delivery happens before it. */
  resetsAt: string;
  seenBy:   { trackerId: string; jobId: string };
}

export type UsageMarkerReading =
  | { verdict: 'absent' }
  | { verdict: 'read'; marker: UsageMarker }
  | { verdict: 'malformed'; reason: string };

const USAGE_MARKER_FILE_NAME = 'usage-limit.json';

function pathIn(monitorFolder: string): string {
  return join(monitorFolder, USAGE_MARKER_FILE_NAME);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function markerOf(document: unknown): UsageMarker | string {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return 'it is not a JSON object';
  const {
    vendor, window, resetsAt, seenBy
  } = document as Partial<Record<keyof UsageMarker, unknown>>;
  if (!isNonEmptyText(vendor) || !isNonEmptyText(window)) return 'its "vendor" or "window" is not text';
  if (!isNonEmptyText(resetsAt) || Number.isNaN(Date.parse(resetsAt))) return 'its "resetsAt" is not a stamp';
  if (typeof seenBy !== 'object' || seenBy === null || Array.isArray(seenBy)) return 'its "seenBy" is not an object';
  const { trackerId, jobId } = seenBy as { trackerId?: unknown; jobId?: unknown };
  if (!isNonEmptyText(trackerId) || !isNonEmptyText(jobId)) return 'its "seenBy" names no tracker id and job id';
  return {
    vendor, window, resetsAt, seenBy: { trackerId, jobId }
  };
}

/** Never throws: a marker that cannot be read or trusted whole is `malformed`, which the Overseer reports and treats as no marker. */
function read(monitorFolder: string): UsageMarkerReading {
  const storedText = storedFileTextOf(pathIn(monitorFolder));
  if (storedText.verdict === 'absent') return storedText;
  if (storedText.verdict === 'unreadable') return { verdict: 'malformed', reason: storedText.reason };
  const parsedJson = StoredValueUtil.parsedJsonOf(storedText.text);
  if (parsedJson.verdict === 'unparseable') return { verdict: 'malformed', reason: parsedJson.problem };
  const marker = markerOf(parsedJson.value);
  return typeof marker === 'string' ? { verdict: 'malformed', reason: marker } : { verdict: 'read', marker };
}

function write(monitorFolder: string, marker: UsageMarker): void {
  const stored = {
    vendor: marker.vendor, window: marker.window, resetsAt: marker.resetsAt, seenBy: { trackerId: marker.seenBy.trackerId, jobId: marker.seenBy.jobId }
  };
  mkdirSync(monitorFolder, { recursive: true });
  writeFileAtomically(pathIn(monitorFolder), `${JSON.stringify(stored, null, 2)}\n`);
}

export const UsageMarkerFile = Object.freeze({ pathIn, read, write });

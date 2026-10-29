/**
 * Follows one job's transcript on `/api/jobs/<J>/stream?after=<instance>.<sequence>`: a `history` event with every entry after the cursor,
 * then a `message` per new entry. The client keeps the last cursor it received, so a panel reopened on the same job resumes after it.
 */
import type { EventStreamSource } from './EventStreamClient.ts';

/** The vendor-neutral entry the Overseer maps every stored line into; the Bridge never parses a vendor line. */
export interface TranscriptEntryDocument {
  readonly cursor:           string;
  readonly role:             string;
  readonly text:             string;
  readonly toolName?:        string;
  readonly parentToolUseId?: string;
}

export interface TranscriptStreamHandlers {
  readonly onEntries: (entries: readonly TranscriptEntryDocument[]) => void;
}

export interface TranscriptStream {
  readonly close:      () => void;
  readonly lastCursor: () => string | null;
}

export interface TranscriptStreamOptions {
  readonly after?:                   string | null;
  readonly eventSourceOf?:           (url: string) => EventStreamSource;
  readonly reopenDelayMilliseconds?: number;
}

function isEntry(value: unknown): value is TranscriptEntryDocument {
  if (typeof value !== 'object' || value === null) return false;
  const { cursor, role, text } = value as Partial<Record<keyof TranscriptEntryDocument, unknown>>;
  return typeof cursor === 'string' && typeof role === 'string' && typeof text === 'string';
}

function streamUrlOf(jobId: string, after: string | null): string {
  const path = `/api/jobs/${encodeURIComponent(jobId)}/stream`;
  return after === null ? path : `${path}?after=${encodeURIComponent(after)}`;
}

const REOPEN_DELAY_MILLISECONDS = 2_000;
const CLOSED_READY_STATE = 2;

function parsedDataOf(event: Event): unknown {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as unknown;
  } catch {
    return null;
  }
}

/**
 * The browser's own reconnect sends the last cursor as `Last-Event-ID`; a stream it gave up on is opened again here after the last cursor
 * received. Either way an entry already received is dropped, so a replay never shows a line twice.
 */
function follow(jobId: string, handlers: TranscriptStreamHandlers, options: TranscriptStreamOptions = {}): TranscriptStream {
  const eventSourceOf = options.eventSourceOf ?? ((url: string): EventStreamSource => new EventSource(url));
  const reopenDelay = options.reopenDelayMilliseconds ?? REOPEN_DELAY_MILLISECONDS;
  let lastCursor = options.after ?? null;
  const receivedCursors = new Set<string>();
  let source: EventStreamSource | null = null;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const receive = (entries: readonly unknown[]): void => {
    const fresh = entries.filter(isEntry).filter((entry) => !receivedCursors.has(entry.cursor));
    if (fresh.length === 0) return;
    fresh.forEach((entry) => receivedCursors.add(entry.cursor));
    lastCursor = fresh.at(-1)?.cursor ?? lastCursor;
    handlers.onEntries(fresh);
  };

  const connect = (): void => {
    const opened = eventSourceOf(streamUrlOf(jobId, lastCursor));
    source = opened;
    opened.addEventListener('history', (event) => {
      const entries = parsedDataOf(event);
      receive(Array.isArray(entries) ? entries : []);
    });
    opened.addEventListener('message', (event) => receive([parsedDataOf(event)]));
    opened.addEventListener('error', () => {
      if (opened.readyState !== CLOSED_READY_STATE || closed) return;
      reopenTimer = setTimeout(connect, reopenDelay);
    });
  };

  connect();
  return {
    close: () => {
      closed = true;
      if (reopenTimer !== null) clearTimeout(reopenTimer);
      source?.close();
    },
    lastCursor: () => lastCursor,
  };
}

export const TranscriptStreamClient = Object.freeze({ follow, streamUrlOf });

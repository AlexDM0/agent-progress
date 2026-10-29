/**
 * Follows one job's transcript on `/api/jobs/<J>/stream?after=<instance>.<sequence>`: a `history` event with every entry after the cursor,
 * then a `message` per new entry. The client keeps the last cursor it received, so a panel reopened on the same job resumes after it.
 */
import type { EventStreamSource } from './EventStreamClient.ts';

/** The vendor-neutral entry the Overseer maps every stored line into; the Bridge never parses a vendor line. */
export interface TranscriptEntryDocument {
  readonly cursor: string;
  readonly role:   string;
  readonly text:   string;
}

export interface TranscriptStreamHandlers {
  readonly onEntries: (entries: readonly TranscriptEntryDocument[]) => void;
}

export interface TranscriptStream {
  readonly close:      () => void;
  readonly lastCursor: () => string | null;
}

export interface TranscriptStreamOptions {
  readonly after?:         string | null;
  readonly eventSourceOf?: (url: string) => EventStreamSource;
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

function follow(jobId: string, handlers: TranscriptStreamHandlers, options: TranscriptStreamOptions = {}): TranscriptStream {
  const eventSourceOf = options.eventSourceOf ?? ((url: string): EventStreamSource => new EventSource(url));
  let lastCursor = options.after ?? null;
  const source = eventSourceOf(streamUrlOf(jobId, lastCursor));
  const receive = (entries: readonly unknown[]): void => {
    const valid = entries.filter(isEntry);
    if (valid.length === 0) return;
    lastCursor = valid.at(-1)?.cursor ?? lastCursor;
    handlers.onEntries(valid);
  };
  const parsed = (event: Event): unknown => {
    try {
      return JSON.parse((event as MessageEvent<string>).data) as unknown;
    } catch {
      return null;
    }
  };
  source.addEventListener('history', (event) => {
    const entries = parsed(event);
    receive(Array.isArray(entries) ? entries : []);
  });
  source.addEventListener('message', (event) => receive([parsed(event)]));
  return { close: () => source.close(), lastCursor: () => lastCursor };
}

export const TranscriptStreamClient = Object.freeze({ follow, streamUrlOf });

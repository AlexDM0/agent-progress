/**
 * One host instance's append-only event log: a line per child stdout line and per line the host or a client wrote to the child, numbered
 * from 1. It is appended in place rather than replaced, so a reader may find a last line cut short by a power loss, and ignores it.
 */
import {
  closeSync,
  fsyncSync,
  openSync,
  writeSync
} from 'node:fs';

export type EventOrigin = 'agent' | 'client' | 'host';

export interface EventLogEntry {
  readonly sequence: number;
  readonly origin:   EventOrigin;
  readonly line:     string;
  /** When the host appended it: only recorded and shown, never read to decide anything. Absent from a log written before stamps. */
  readonly at?:      string;
}

export interface EventLogWriter {
  readonly append:       (origin: EventOrigin, line: string) => EventLogEntry;
  /** Flushed to the disk before a client is told the log's history. */
  readonly sync:         () => void;
  /** Flushed to the disk before anything that tells a reader the log is complete, such as the host's `end`. */
  readonly syncAndClose: () => void;
}

export type EventLogReading =
  | { readonly verdict: 'read'; readonly entries: readonly EventLogEntry[] }
  | { readonly verdict: 'malformed'; readonly lineNumber: number };

const EVENT_ORIGINS: readonly string[] = ['agent', 'client', 'host'] satisfies readonly EventOrigin[];

export function createEventLogWriter(eventLogPath: string, stampNow: () => string): EventLogWriter {
  const fileDescriptor = openSync(eventLogPath, 'a');
  let lastSequence = 0;
  return {
    append: (origin, line) => {
      lastSequence += 1;
      const entry: EventLogEntry = {
        sequence: lastSequence, origin, line, at: stampNow()
      };
      writeSync(fileDescriptor, `${JSON.stringify(entry)}\n`);
      return entry;
    },
    sync: () => {
      fsyncSync(fileDescriptor);
    },
    syncAndClose: () => {
      fsyncSync(fileDescriptor);
      closeSync(fileDescriptor);
    },
  };
}

function entryOf(text: string): EventLogEntry | null {
  try {
    const parsed = JSON.parse(text) as Partial<Record<keyof EventLogEntry, unknown>> | null;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const {
      sequence, origin, line, at
    } = parsed;
    if (!Number.isSafeInteger(sequence) || typeof origin !== 'string' || !EVENT_ORIGINS.includes(origin) || typeof line !== 'string') return null;
    const entry: EventLogEntry = { sequence: sequence as number, origin: origin as EventOrigin, line };
    return typeof at === 'string' ? { ...entry, at } : entry;
  } catch {
    return null;
  }
}

/** Every terminated line, in order; the text after the last newline is an append cut short and is ignored. */
export function eventLogEntriesOf(eventLogText: string): EventLogReading {
  const terminatedLines = eventLogText.split('\n').slice(0, -1);
  const entries: EventLogEntry[] = [];
  for (const [index, text] of terminatedLines.entries()) {
    const entry = entryOf(text);
    if (entry === null) return { verdict: 'malformed', lineNumber: index + 1 };
    entries.push(entry);
  }
  return { verdict: 'read', entries };
}

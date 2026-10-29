/**
 * A job's transcript as vendor-neutral entries, read from its `events-<instance>.ndjson` files through the adapter's mapper, so it reads
 * a legacy Watcher, a finished job and a job whose Watcher is gone alike. The cursor is `(instance, sequence)`.
 */
import type { EventLogEntry }                   from '../../lib/agent-host/EventLog.ts';
import type { AgentSessionEvent }               from '../../lib/agent-launch/AgentSessionEvent.ts';
import type { TranscriptEntry, TranscriptRole } from '../../shared/@types/TranscriptEntry.ts';
import { HostFleet }                            from './HostFleet.ts';

export interface TranscriptCursor {
  instance: number;
  sequence: number;
}

const CURSOR_PATTERN = /^(\d+)\.(\d+)$/;

/** `null` for text that is no `<instance>.<sequence>`; an absent cursor reads as the start. */
function cursorOf(text: string | null): TranscriptCursor | null {
  if (text === null || text === '') return { instance: 1, sequence: 0 };
  const match = CURSOR_PATTERN.exec(text);
  if (match === null) return null;
  return { instance: Number(match[1]), sequence: Number(match[2]) };
}

function entryOfEvent(event: AgentSessionEvent, base: Pick<TranscriptEntry, 'cursor' | 'at'>): TranscriptEntry | null {
  if (event.kind === 'assistant-turn') {
    const tokens = event.usage === null ? {} : { tokens: event.usage.outputTokens };
    return {
      ...base, role: 'assistant', text: event.text, model: event.model, ...tokens, ...event.parentToolUseId === null ? {} : { parentToolUseId: event.parentToolUseId }
    };
  }
  if (event.kind === 'tool-call') {
    return {
      ...base, role: 'tool-call', text: event.inputSummary, toolName: event.toolName, ...event.parentToolUseId === null ? {} : { parentToolUseId: event.parentToolUseId }
    };
  }
  if (event.kind === 'tool-result') {
    return {
      ...base, role: 'tool-result', text: event.isError ? 'error' : '', ...event.parentToolUseId === null ? {} : { parentToolUseId: event.parentToolUseId }
    };
  }
  return null;
}

const ROLE_OF_ORIGIN: Readonly<Record<'client' | 'host', TranscriptRole>> = { client: 'user', host: 'watcher' };

function entriesOfLogEntry(instance: number, entry: EventLogEntry, eventsOf: (line: string) => readonly AgentSessionEvent[]): TranscriptEntry[] {
  const base = { cursor: `${instance}.${entry.sequence}`, ...entry.at === undefined ? {} : { at: entry.at } };
  if (entry.origin !== 'agent') return [{ ...base, role: ROLE_OF_ORIGIN[entry.origin], text: entry.line }];
  return eventsOf(entry.line).map((event) => entryOfEvent(event, base)).filter((mapped): mapped is TranscriptEntry => mapped !== null);
}

/** Every entry after the cursor, across instances in order, and the cursor of the last log entry read. */
function entriesAfter(
  jobFolder: string,
  newestInstance: number,
  after: TranscriptCursor,
  eventsOf: (line: string) => readonly AgentSessionEvent[],
): { entries: TranscriptEntry[]; cursor: TranscriptCursor } {
  const entries: TranscriptEntry[] = [];
  let cursor = after;
  for (let { instance } = after; instance <= newestInstance; instance += 1) {
    const read = HostFleet.eventsAfter(jobFolder, instance, instance === after.instance ? after.sequence : 0);
    if (read === 'malformed') continue;
    for (const entry of read) {
      entries.push(...entriesOfLogEntry(instance, entry, eventsOf));
      cursor = { instance, sequence: entry.sequence };
    }
  }
  return { entries, cursor };
}

export const JobTranscript = Object.freeze({ cursorOf, entriesAfter });

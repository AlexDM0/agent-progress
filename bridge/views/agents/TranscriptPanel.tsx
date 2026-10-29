/**
 * A job's transcript, replayed then followed. What it received is kept in the view's `TranscriptMemory`, so a panel opened again on the same
 * job shows it at once and asks only after the last cursor it holds. Every entry renders as text: an agent's markup is never markup here.
 */
import { useEffect, useState } from 'react';

import type {
  TranscriptEntryDocument,
  TranscriptStream,
  TranscriptStreamHandlers,
  TranscriptStreamOptions
} from '../../api/TranscriptStreamClient.ts';

export type FollowTranscript = (jobId: string, handlers: TranscriptStreamHandlers, options?: TranscriptStreamOptions) => TranscriptStream;

export interface HeldTranscript {
  entries: readonly TranscriptEntryDocument[];
  cursor:  string | null;
}

export type TranscriptMemory = Map<string, HeldTranscript>;

export interface TranscriptPanelProps {
  readonly jobId:            string;
  readonly memory:           TranscriptMemory;
  readonly followTranscript: FollowTranscript;
}

/** A tool call is collapsed to its tool's name, the rest to their text. */
function entryTextOf(entry: TranscriptEntryDocument): string {
  return entry.role === 'tool-call' ? entry.toolName ?? entry.text : entry.text;
}

export function TranscriptPanel({ jobId, memory, followTranscript }: TranscriptPanelProps) {
  const [entries, setEntries] = useState<readonly TranscriptEntryDocument[]>(() => memory.get(jobId)?.entries ?? []);

  useEffect(() => {
    const held = memory.get(jobId) ?? { entries: [], cursor: null };
    memory.set(jobId, held);
    const stream = followTranscript(jobId, {
      onEntries: (received) => {
        held.entries = [...held.entries, ...received];
        held.cursor = received.at(-1)?.cursor ?? held.cursor;
        setEntries(held.entries);
      },
    }, { after: held.cursor });
    return () => stream.close();
  }, [jobId, memory, followTranscript]);

  if (entries.length === 0) return <p className="agents-muted">No transcript yet.</p>;
  return (
    <ol className="agents-transcript">
      {entries.map((entry) => (
        <li key={entry.cursor} className="agents-transcript-entry" data-role={entry.role}>
          <span className="agents-transcript-role">{entry.parentToolUseId === undefined ? entry.role : `${entry.role} (subagent)`}</span>
          <span className="agents-transcript-text">{entryTextOf(entry)}</span>
        </li>
      ))}
    </ol>
  );
}

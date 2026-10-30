/**
 * A session's transcript, followed from the Overseer's job stream and shown as text, every entry with its role; the Bridge never parses a
 * vendor line, and an agent's text never reaches the DOM as markup.
 */
import { useEffect, useState } from 'react';

import type { TranscriptEntryDocument, TranscriptStreamHandlers } from '../../api/TranscriptStreamClient.ts';

export type TranscriptFollower = (jobId: string, handlers: TranscriptStreamHandlers) => { close: () => void };

/** Every entry of the job's transcript so far, followed while mounted; starts empty again for another job. */
export function useTranscript(jobId: string | null, followTranscript: TranscriptFollower): readonly TranscriptEntryDocument[] {
  const [entries, setEntries] = useState<{ jobId: string | null; entries: readonly TranscriptEntryDocument[] }>({ jobId, entries: [] });
  useEffect(() => {
    if (jobId === null) return undefined;
    const followed = (received: readonly TranscriptEntryDocument[]): void => setEntries((previous) => ({
      jobId,
      entries: previous.jobId === jobId ? [...previous.entries, ...received] : [...received],
    }));
    const stream = followTranscript(jobId, { onEntries: followed });
    return () => stream.close();
  }, [jobId, followTranscript]);
  return entries.jobId === jobId ? entries.entries : [];
}

export interface TranscriptLogProps {
  readonly label:   string;
  readonly entries: readonly TranscriptEntryDocument[];
}

export function TranscriptLog({ label, entries }: TranscriptLogProps) {
  return (
    <ol className="bridge-transcript" aria-label={label}>
      {entries.map((entry) => (
        <li key={entry.cursor} className="bridge-transcript-entry" data-role={entry.role}>
          <span className="bridge-mark">{entry.role}</span>
          {entry.text}
        </li>
      ))}
    </ol>
  );
}

/**
 * The transcript client against a fake `EventSource`. What matters: the stream asks after the cursor it was given, `history` and
 * `message` both reach the handler, an entry of another shape is dropped, and the last cursor received is kept for a reopened panel.
 */
import { describe, expect, test } from 'bun:test';

import type { EventStreamSource } from './EventStreamClient.ts';
import { TranscriptStreamClient } from './TranscriptStreamClient.ts';

describe('the transcript client', () => {
  test('follows history then messages after the cursor, keeping the last cursor and dropping malformed entries', () => {
    const listeners = new Map<string, (event: Event) => void>();
    let openedUrl = '';
    const eventSourceOf = (url: string): EventStreamSource => {
      openedUrl = url;
      return {
        readyState:       1,
        close:            () => undefined,
        addEventListener: ((type: string, listener: (event: Event) => void) => {
          listeners.set(type, listener);
        }) as EventStreamSource['addEventListener'],
      };
    };
    const received: string[] = [];
    const stream = TranscriptStreamClient.follow('J12', { onEntries: (entries) => received.push(...entries.map((entry) => entry.cursor)) }, { after: '1.4', eventSourceOf });
    const fire = (type: string, data: unknown) => listeners.get(type)?.(Object.assign(new Event(type), { data: JSON.stringify(data) }));
    fire('history', [{ cursor: '1.5', role: 'assistant', text: 'Reading the ticket.' }, { cursor: 'broken' }]);
    fire('message', { cursor: '2.1', role: 'tool-call', text: 'Bash' });
    expect(openedUrl).toBe('/api/jobs/J12/stream?after=1.4');
    expect(received).toEqual(['1.5', '2.1']);
    expect(stream.lastCursor()).toBe('2.1');
  });
});

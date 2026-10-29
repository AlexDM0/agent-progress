/**
 * The transcript client against a fake `EventSource`. What matters: the stream asks after the cursor it was given, `history` and
 * `message` both reach the handler, an entry of another shape is dropped, and the last cursor received is kept for a reopened panel; a
 * stream the browser gave up on reopens after that cursor, and an entry replayed across the reopen is delivered once.
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

  test('a stream the browser gave up on reopens after the last cursor received, and a replayed entry is not delivered twice', async () => {
    const opened: { url: string; listeners: Map<string, (event: Event) => void>; readyState: number }[] = [];
    const eventSourceOf = (url: string): EventStreamSource => {
      const source = { url, listeners: new Map<string, (event: Event) => void>(), readyState: 1 };
      opened.push(source);
      return {
        get readyState() {
          return source.readyState;
        },
        close:            () => undefined,
        addEventListener: ((type: string, listener: (event: Event) => void) => {
          source.listeners.set(type, listener);
        }) as EventStreamSource['addEventListener'],
      };
    };
    const received: string[] = [];
    const onEntries = (entries: readonly { cursor: string }[]) => received.push(...entries.map((entry) => entry.cursor));
    const stream = TranscriptStreamClient.follow('J12', { onEntries }, { eventSourceOf, reopenDelayMilliseconds: 0 });
    const fire = (index: number, type: string, data?: unknown) => opened[index]?.listeners.get(type)?.(Object.assign(new Event(type), { data: JSON.stringify(data) }));
    fire(0, 'history', [{ cursor: '1.1', role: 'assistant', text: 'Reading.' }]);
    const [first] = opened;
    if (first !== undefined) first.readyState = 2;
    fire(0, 'error');
    await Bun.sleep(1);
    fire(1, 'history', [{ cursor: '1.1', role: 'assistant', text: 'Reading.' }, { cursor: '1.2', role: 'tool-call', text: 'Read' }]);
    stream.close();
    expect(opened.map(({ url }) => url)).toEqual(['/api/jobs/J12/stream', '/api/jobs/J12/stream?after=1.1']);
    expect(received).toEqual(['1.1', '1.2']);
  });
});

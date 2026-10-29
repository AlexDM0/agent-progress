/**
 * The event-stream client against a fake `EventSource`. What matters: each Overseer event kind reaches the handler parsed, the last event
 * id is kept (the browser sends it back as `Last-Event-ID`), the connection state follows open and error, and a stream the browser closed
 * is opened again while one it is reconnecting by itself is left alone.
 */
import { describe, expect, test } from 'bun:test';

import {
  EventStreamClient,
  type ConnectionState,
  type EventStreamSource,
  type OverseerEventKind
} from './EventStreamClient.ts';

interface FakeSource extends EventStreamSource {
  readonly url:  string;
  readonly fire: (type: string, event: Event) => void;
  readyState:    number;
  closed:        boolean;
}

function fakeSources(): { sources: FakeSource[]; eventSourceOf: (url: string) => EventStreamSource } {
  const sources: FakeSource[] = [];
  const eventSourceOf = (url: string): EventStreamSource => {
    const listeners = new Map<string, ((event: Event) => void)[]>();
    const source: FakeSource = {
      url,
      readyState:       0,
      closed:           false,
      addEventListener: ((type: string, listener: (event: Event) => void) => {
        listeners.set(type, [...listeners.get(type) ?? [], listener]);
      }) as EventStreamSource['addEventListener'],
      close: () => {
        source.closed = true;
      },
      fire: (type, event) => listeners.get(type)?.forEach((listener) => listener(event)),
    };
    sources.push(source);
    return source;
  };
  return { sources, eventSourceOf };
}

function messageEvent(type: string, data: unknown, lastEventId: string): Event {
  return Object.assign(new Event(type), { data: JSON.stringify(data), lastEventId });
}

describe('the event-stream client', () => {
  test('passes each kind parsed, keeps the last event id and follows open and error', () => {
    const { sources, eventSourceOf } = fakeSources();
    const received: [OverseerEventKind, unknown][] = [];
    const states: ConnectionState[] = [];
    const client = EventStreamClient.open({ onEvent: (kind, data) => received.push([kind, data]), onConnection: (state) => states.push(state) }, { eventSourceOf });
    const [source] = sources;
    source?.fire('open', new Event('open'));
    source?.fire('board', messageEvent('board', { project: 'Example Agency' }, '3-1'));
    source?.fire('job', messageEvent('job', { id: 'J1' }, '3-2'));
    source?.fire('error', new Event('error'));
    expect(source?.url).toBe('/api/events');
    expect(received).toEqual([['board', { project: 'Example Agency' }], ['job', { id: 'J1' }]]);
    expect(client.lastEventId()).toBe('3-2');
    expect(states).toEqual(['connecting', 'live', 'down']);
    client.close();
    expect(source?.closed).toBe(true);
  });

  test('a stream the browser closed is opened again; one it is reconnecting itself is not', async () => {
    const { sources, eventSourceOf } = fakeSources();
    const client = EventStreamClient.open({ onEvent: () => undefined, onConnection: () => undefined }, { eventSourceOf, reopenDelayMilliseconds: 1 });
    const [first] = sources;
    first?.fire('error', new Event('error'));
    await Bun.sleep(10);
    expect(sources.length).toBe(1);
    if (first !== undefined) first.readyState = 2;
    first?.fire('error', new Event('error'));
    await Bun.sleep(10);
    expect(sources.length).toBe(2);
    client.close();
  });
});

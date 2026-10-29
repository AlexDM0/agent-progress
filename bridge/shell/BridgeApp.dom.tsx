/**
 * The shell against fake services, in a happy-dom document. What matters: every control is disabled while the event stream is down and
 * while launches are held for an install change, a 423 raises that banner with the Overseer's sentence, a refusal shows verbatim beside its
 * control, a reconnect to an Overseer running new code reloads the page, and a view that throws leaves the error banner, not a blank page.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { BoardStateDocument, OverseerIdentity } from '../@types/BoardStateDocument.ts';
import type { CommandOutcome, ControlCommandBody }   from '../api/CommandClient.ts';
import type { EventStreamHandlers }                  from '../api/EventStreamClient.ts';
import { BridgeApp, type BridgeServices }            from './BridgeApp.tsx';
import { BridgeErrorBoundary }                       from './BridgeErrorBoundary.tsx';

const IDENTITY: OverseerIdentity = { trackerId: 'example-tracker', project: 'Example Agency', codeVersion: 'code-1' };

const BOARD: BoardStateDocument = {
  project:   'Example Agency',
  jobs:      [],
  decisions: [],
  incidents: [],
  overseer:  { state: 'serving', paused: false, codeVersion: 'code-1' },
  usage:     null,
};

interface FakeBridge {
  readonly services:     BridgeServices;
  readonly stream:       () => EventStreamHandlers;
  readonly sent:         ControlCommandBody[];
  readonly reloads:      () => number;
  readonly answerWith:   (outcome: CommandOutcome) => void;
  readonly identityNext: (identity: OverseerIdentity) => void;
}

function fakeBridge(): FakeBridge {
  let handlers: EventStreamHandlers | null = null;
  let reloadCount = 0;
  let nextOutcome: CommandOutcome = { verdict: 'applied', outcome: 'done', result: null };
  let identity = IDENTITY;
  const sent: ControlCommandBody[] = [];
  const storage = new Map<string, string>();
  return {
    services: {
      commandClient: {
        send: (command) => {
          sent.push(command);
          return Promise.resolve(nextOutcome);
        },
      },
      openEventStream: (streamHandlers) => {
        handlers = streamHandlers;
        return { close: () => undefined };
      },
      fetchIdentity: () => Promise.resolve(identity),
      reload:        () => {
        reloadCount += 1;
      },
      storage: () => ({
        getItem:    (key) => storage.get(key) ?? null,
        setItem:    (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      }),
      embedded:             false,
      embeddedSurroundings: () => ({ window, parent: null, parentOrigin: null }),
      now:                  () => new Date('2026-10-29T20:00:00Z'),
    },
    stream: () => {
      if (handlers === null) throw new Error('the shell opened no event stream');
      return handlers;
    },
    sent,
    reloads:    () => reloadCount,
    answerWith: (outcome) => {
      nextOutcome = outcome;
    },
    identityNext: (next) => {
      identity = next;
    },
  };
}

async function renderedLive(bridge: FakeBridge): Promise<void> {
  render(<BridgeApp services={bridge.services} />);
  await act(async () => {
    bridge.stream().onConnection('live');
    bridge.stream().onEvent('board', BOARD);
    await Promise.resolve();
  });
}

function pauseButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: 'Pause' });
}

afterEach(() => {
  cleanup();
});

describe('the shell\'s controls', () => {
  test('a control posts its ControlCommand while the stream is live', async () => {
    const bridge = fakeBridge();
    await renderedLive(bridge);
    expect(pauseButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(pauseButton());
      await Promise.resolve();
    });
    expect(bridge.sent).toEqual([{ kind: 'runner-pause' }]);
  });

  test('every control is disabled while the stream is down, under the unreachable banner, and the board stays on screen', async () => {
    const bridge = fakeBridge();
    await renderedLive(bridge);
    act(() => bridge.stream().onConnection('down'));
    expect(pauseButton().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toStartWith('Overseer unreachable, reconnecting; showing the board as of ');
    expect(screen.getByRole('heading').textContent).toBe('Example Agency');
  });

  test('a 423 raises the install-change banner with the Overseer\'s sentence and disables every control', async () => {
    const bridge = fakeBridge();
    await renderedLive(bridge);
    bridge.answerWith({ verdict: 'install-held', refusal: 'The install version changed: run `agent-progress-v2 update`.' });
    await act(async () => {
      fireEvent.click(pauseButton());
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toBe('The install version changed: run `agent-progress-v2 update`.');
    expect(pauseButton().disabled).toBe(true);
  });

  test('a board held for an install change disables every control too', async () => {
    const bridge = fakeBridge();
    await renderedLive(bridge);
    act(() => bridge.stream().onEvent('board', { ...BOARD, overseer: { ...BOARD.overseer, state: 'held-by-install-change' } }));
    expect(screen.getByRole('alert').textContent).toContain('The install version changed');
    expect(pauseButton().disabled).toBe(true);
  });

  test('a refusal shows verbatim beside its control', async () => {
    const bridge = fakeBridge();
    await renderedLive(bridge);
    bridge.answerWith({ verdict: 'refused', refusal: 'Ticket 042 is not ready: it has no Brief.' });
    await act(async () => {
      fireEvent.click(pauseButton());
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe('Ticket 042 is not ready: it has no Brief.');
  });
});

describe('new code behind the same port', () => {
  test('a reconnect to an Overseer reporting another code version reloads the page, and one reporting the same does not', async () => {
    const bridge = fakeBridge();
    await renderedLive(bridge);
    await act(async () => {
      bridge.stream().onConnection('down');
      bridge.stream().onConnection('live');
      await Promise.resolve();
    });
    expect(bridge.reloads()).toBe(0);
    bridge.identityNext({ ...IDENTITY, codeVersion: 'code-2' });
    await act(async () => {
      bridge.stream().onConnection('down');
      bridge.stream().onConnection('live');
      await Promise.resolve();
    });
    expect(bridge.reloads()).toBe(1);
  });
});

describe('the error boundary', () => {
  test('a view that throws while rendering leaves the error banner in its place', () => {
    const Failing = (): never => {
      throw new Error('the planted view broke');
    };
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      render(<BridgeErrorBoundary><Failing /></BridgeErrorBoundary>);
    } finally {
      console.error = originalConsoleError;
    }
    expect(screen.getByRole('alert').textContent).toStartWith('The Bridge failed to render: the planted view broke.');
  });
});

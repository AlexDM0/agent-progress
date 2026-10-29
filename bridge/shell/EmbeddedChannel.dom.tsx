/**
 * The embedded channel in a happy-dom window. What matters: a theme message is taken only from the framing parent at its origin, a
 * message from a foreign origin or another window is dropped, and Esc reaches the parent at its origin only while no panel is open.
 */
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { EmbeddedChannel, ESCAPE_MESSAGE_TYPE, THEME_MESSAGE_TYPE } from './EmbeddedChannel.ts';
import type { Theme }                                               from './ThemeBootstrap.ts';

const PARENT_ORIGIN = 'http://127.0.0.1:5101';

interface PostedMessage {
  readonly message:      unknown;
  readonly targetOrigin: string;
}

let closeChannel = (): void => undefined;

afterEach(() => {
  closeChannel();
});

function openedChannel(panelIsOpen = false) {
  const themes: Theme[] = [];
  const posted: PostedMessage[] = [];
  const parent = {
    postMessage: (message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin });
    },
  } as unknown as Window;
  const channel = EmbeddedChannel.open({ window, parent, parentOrigin: PARENT_ORIGIN }, { onTheme: (theme) => themes.push(theme), panelIsOpen: () => panelIsOpen });
  closeChannel = channel.close;
  const deliver = (data: unknown, origin: string, source: unknown) => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }));
  };
  return {
    themes, posted, parent, deliver
  };
}

describe('theme in', () => {
  test('the parent\'s theme message at its origin is applied', () => {
    const { themes, parent, deliver } = openedChannel();
    deliver({ type: THEME_MESSAGE_TYPE, theme: 'dark' }, PARENT_ORIGIN, parent);
    expect(themes).toEqual(['dark']);
  });

  test('a message from a foreign origin, from another window or of another shape is dropped', () => {
    const { themes, parent, deliver } = openedChannel();
    deliver({ type: THEME_MESSAGE_TYPE, theme: 'dark' }, 'http://attacker.example', parent);
    deliver({ type: THEME_MESSAGE_TYPE, theme: 'dark' }, PARENT_ORIGIN, null);
    deliver({ type: THEME_MESSAGE_TYPE, theme: 'neon' }, PARENT_ORIGIN, parent);
    deliver('agent-progress:theme dark', PARENT_ORIGIN, parent);
    expect(themes).toEqual([]);
  });
});

describe('Esc out', () => {
  test('Esc with no panel open posts the escape message to the parent\'s origin only', () => {
    const { posted } = openedChannel();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(posted).toEqual([{ message: { type: ESCAPE_MESSAGE_TYPE }, targetOrigin: PARENT_ORIGIN }]);
  });

  test('Esc with a panel open, and any other key, posts nothing', () => {
    const { posted } = openedChannel(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(posted).toEqual([]);
  });
});

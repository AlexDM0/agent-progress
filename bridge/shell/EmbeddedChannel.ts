/**
 * agent-dashboard frames the Bridge across origins, so theme in and Esc out travel by `postMessage`. A message is accepted only from the
 * framing parent at its own origin: `frame-ancestors` lets only agent-dashboard's origins frame the Bridge, so that origin is one of them.
 * The Bridge posts only to that origin, never to `*`.
 */
import type { Theme } from './ThemeBootstrap.ts';

export const THEME_MESSAGE_TYPE = 'agent-progress:theme';
export const ESCAPE_MESSAGE_TYPE = 'agent-progress:escape';

export interface EmbeddedSurroundings {
  readonly window:       Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly parent:       Pick<Window, 'postMessage'> | null;
  /** The framing parent's origin, `null` when it cannot be known; then nothing is accepted or sent. */
  readonly parentOrigin: string | null;
}

export interface EmbeddedChannelOptions {
  readonly onTheme:     (theme: Theme) => void;
  /** Whether a panel is open, which Esc closes first instead of leaving the frame. */
  readonly panelIsOpen: () => boolean;
}

export interface EmbeddedChannel {
  readonly close: () => void;
}

function themeCarriedBy(data: unknown): Theme | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, theme } = data as { type?: unknown; theme?: unknown };
  return type === THEME_MESSAGE_TYPE && (theme === 'light' || theme === 'dark') ? theme : null;
}

function open(surroundings: EmbeddedSurroundings, options: EmbeddedChannelOptions): EmbeddedChannel {
  const { parent, parentOrigin } = surroundings;
  const onMessage = (event: MessageEvent): void => {
    if (parentOrigin === null || event.origin !== parentOrigin || event.source !== parent) return;
    const theme = themeCarriedBy(event.data);
    if (theme !== null) options.onTheme(theme);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || options.panelIsOpen() || parent === null || parentOrigin === null) return;
    parent.postMessage({ type: ESCAPE_MESSAGE_TYPE }, parentOrigin);
  };
  surroundings.window.addEventListener('message', onMessage as EventListener);
  surroundings.window.addEventListener('keydown', onKeyDown as EventListener);
  return {
    close: () => {
      surroundings.window.removeEventListener('message', onMessage as EventListener);
      surroundings.window.removeEventListener('keydown', onKeyDown as EventListener);
    },
  };
}

/** The parent's origin from the browser's ancestor list where it has one, otherwise from the referrer the framing page sent. */
function parentOriginOf(location: Location, referrer: string): string | null {
  const [ancestorOrigin] = location.ancestorOrigins ?? [];
  if (ancestorOrigin !== undefined) return ancestorOrigin;
  try {
    return referrer === '' ? null : new URL(referrer).origin;
  } catch {
    return null;
  }
}

function browserSurroundings(): EmbeddedSurroundings {
  const framed = window.parent !== window;
  return { window, parent: framed ? window.parent : null, parentOrigin: framed ? parentOriginOf(window.location, document.referrer) : null };
}

export const EmbeddedChannel = Object.freeze({ open, browserSurroundings });

/**
 * The Bridge loaded for real: `run --port 0` on a scratch board with the fake agent, the page opened in headless Chrome over the DevTools
 * protocol, every tab visited, and every console error, uncaught exception, failed request and error-level log entry (a CSP violation is
 * one) collected. Dispatched workers have no browser skill, so this is their check; `bridge/HeadlessBridge.spec.ts` runs it.
 */
import { join } from 'node:path';

import { runAgentProgress, startAgentProgress }           from '../../cli/testing/CliProcess.ts';
import { createInitializedScratchRepository }             from '../../cli/testing/InitializedScratchRepository.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { BRIDGE_TABS }                                    from '../shell/HashRouter.ts';

export const HEADLESS_CHECK_PROJECT = 'Example Agency';

export interface HeadlessBridgeReading {
  /** Each console error, exception, failed request or error-level log entry, worded with its source. */
  readonly problems:       readonly string[];
  /** The project heading the shell rendered, `null` when it never rendered one. */
  readonly projectHeading: string | null;
  readonly visitedTabs:    readonly string[];
}

interface DevToolsMessage {
  readonly id?:     number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
}

const DEVTOOLS_LISTENING_PATTERN = /DevTools listening on (ws:\/\/[^\s]+)/;
const POLL_INTERVAL_MILLISECONDS = 100;
const POLL_ATTEMPTS = 100;
const TAB_SETTLE_MILLISECONDS = 300;
const FIXED_CLOCK = (): Date => new Date('2026-10-29T20:00:00Z');

async function devToolsAddressOf(chrome: Bun.Subprocess<'ignore', 'ignore', 'pipe'>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of chrome.stderr) {
    text += decoder.decode(chunk, { stream: true });
    const address = DEVTOOLS_LISTENING_PATTERN.exec(text)?.[1];
    if (address !== undefined) return address;
  }
  throw new Error(`Chrome exited before it listened for DevTools: ${text}`);
}

async function pageSocketAddressOf(browserAddress: string): Promise<string> {
  const { host } = new URL(browserAddress);
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const targets = await (await fetch(`http://${host}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    const page = targets.find((target) => target.type === 'page');
    if (page !== undefined) return page.webSocketDebuggerUrl;
    await Bun.sleep(POLL_INTERVAL_MILLISECONDS);
  }
  throw new Error('Chrome opened no page target');
}

function connectDevTools(address: string, onEvent: (message: DevToolsMessage) => void) {
  const socket = new WebSocket(address);
  const pending = new Map<number, (result: Record<string, unknown>) => void>();
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as DevToolsMessage;
    if (message.id !== undefined) pending.get(message.id)?.(message.result ?? {});
    else onEvent(message);
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('the DevTools socket failed')));
  });
  const send = async (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    await opened;
    const id = nextId;
    nextId += 1;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  return { send, close: () => socket.close() };
}

function problemOf(message: DevToolsMessage): string | null {
  const params = message.params ?? {};
  switch (message.method) {
    case 'Runtime.exceptionThrown':
      return `exception: ${JSON.stringify((params['exceptionDetails'] as { exception?: { description?: string }; text?: string } | undefined)?.exception?.description ?? params)}`;
    case 'Runtime.consoleAPICalled':
      return params['type'] === 'error' ? `console error: ${JSON.stringify(params['args'])}` : null;
    case 'Log.entryAdded': {
      const entry = params['entry'] as { level?: string; text?: string; url?: string } | undefined;
      return entry?.level === 'error' ? `log error: ${entry.text ?? ''} ${entry.url ?? ''}`.trim() : null;
    }
    case 'Network.loadingFailed':
      return params['canceled'] === true ? null : `failed request: ${String(params['errorText'])} (${String(params['requestId'])})`;
    case 'Network.responseReceived': {
      const response = params['response'] as { status?: number; url?: string } | undefined;
      return (response?.status ?? 0) >= 400 ? `failed request: ${response?.status} ${response?.url}` : null;
    }
    default:
      return null;
  }
}

/** Starts a runner and Chrome, reads the Bridge, and removes both and every scratch folder again, whatever happened. */
export async function readTheBridgeHeadless(chromePath: string): Promise<HeadlessBridgeReading> {
  const repositoryDirectory = await createInitializedScratchRepository('headless-bridge', ['--project', HEADLESS_CHECK_PROJECT, '--no-claude-md', '--no-hooks'], FIXED_CLOCK);
  const homeDirectory = createScratchDirectory('headless-bridge-home');
  const chromeProfileDirectory = createScratchDirectory('headless-bridge-chrome');
  let chrome: Bun.Subprocess<'ignore', 'ignore', 'pipe'> | null = null;
  let devTools: ReturnType<typeof connectDevTools> | null = null;
  try {
    const runner = startAgentProgress(['run', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory });
    const url = await runner.firstOutputLine ?? '';
    chrome = Bun.spawn([
      chromePath,
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${join(chromeProfileDirectory, 'profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      'about:blank',
    ], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
    const problems: string[] = [];
    devTools = connectDevTools(await pageSocketAddressOf(await devToolsAddressOf(chrome)), (message) => {
      const problem = problemOf(message);
      if (problem !== null) problems.push(problem);
    });
    for (const domain of ['Runtime', 'Log', 'Network', 'Page']) await devTools.send(`${domain}.enable`);
    await devTools.send('Page.navigate', { url });
    const evaluate = async (expression: string): Promise<unknown> => {
      const answer = await devTools?.send('Runtime.evaluate', { expression, returnByValue: true });
      return (answer?.['result'] as { value?: unknown } | undefined)?.value ?? null;
    };
    let projectHeading: string | null = null;
    for (let attempt = 0; attempt < POLL_ATTEMPTS && projectHeading !== HEADLESS_CHECK_PROJECT; attempt += 1) {
      await Bun.sleep(POLL_INTERVAL_MILLISECONDS);
      const heading = await evaluate('document.querySelector(\'.bridge-project\')?.textContent ?? null');
      projectHeading = typeof heading === 'string' ? heading : null;
    }
    const visitedTabs: string[] = [];
    for (const tab of BRIDGE_TABS) {
      await evaluate(`window.location.hash = '#${tab}'`);
      await Bun.sleep(TAB_SETTLE_MILLISECONDS);
      const shown = await evaluate('document.querySelector(\'.bridge-panel\')?.getAttribute(\'data-tab\') ?? null');
      if (shown === tab) visitedTabs.push(tab);
    }
    return { problems, projectHeading, visitedTabs };
  } finally {
    devTools?.close();
    chrome?.kill();
    await chrome?.exited;
    await runAgentProgress(['run', 'stop'], { currentDirectory: repositoryDirectory, homeDirectory });
    removeScratchDirectory(chromeProfileDirectory);
    removeScratchDirectory(homeDirectory);
    removeScratchDirectory(repositoryDirectory);
  }
}

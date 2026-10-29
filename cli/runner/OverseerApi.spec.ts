/**
 * The Overseer's API end to end against a spawned runner on a scratch board, the fake agent playing every session. What matters: the
 * Baton names the token file and never holds the token, and that file's token is the one `POST /api/commands` accepts from an Origin-less
 * server request; a command answers 200, 409 worded or 400; `/api/state` carries the status document beside the page, jobs with live facts
 * and the Overseer; `/api/summary` has the fixture's shape; and an event-stream client sees a `board` event for a ticket move and a `job`
 * event for each state the build job passes through, launching to running.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join }                                    from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { PRODUCT_NAMES }                                  from '../../src/shared/constants/ProductNames.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { runAgentProgress, startAgentProgress }           from '../testing/CliProcess.ts';
import { createInitializedScratchRepository }             from '../testing/InitializedScratchRepository.ts';
import { fileReadyTicketThrough }                         from '../testing/ReadyTicketFiling.ts';

const SPEC_CLOCK = (): Date => new Date('2026-09-18T20:11:03Z');
const API_TEST_TIMEOUT_MILLISECONDS = 60_000;
const SUMMARY_FIXTURE_PATH = join(import.meta.dir, '..', '..', 'src', 'services', 'runner', 'testing', 'fixtures', 'summary-v1.json');

let repositoryDirectory = '';
let homeDirectory       = '';

interface StreamedEvent {
  kind: string;
  data: Record<string, unknown>;
}

function run(commandLineArguments: readonly string[]) {
  return runAgentProgress(commandLineArguments, { currentDirectory: repositoryDirectory, homeDirectory });
}

function runnerDirectory(): string {
  return join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'runner');
}

/** Collects every event a stream sends, until `stop` is called. */
function collectEvents(url: string): { events: StreamedEvent[]; stop: () => Promise<void> } {
  const events: StreamedEvent[] = [];
  const controller = new AbortController();
  const reading = (async () => {
    const response = await fetch(new URL('api/events', url), { signal: controller.signal });
    const reader = response.body?.getReader();
    if (reader === undefined) return;
    const decoder = new TextDecoder();
    let pending = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      pending += decoder.decode(chunk.value);
      const blocks = pending.split('\n\n');
      pending = blocks.pop() ?? '';
      for (const block of blocks) {
        const kind = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (kind !== undefined && data !== undefined) events.push({ kind, data: JSON.parse(data) as Record<string, unknown> });
      }
    }
  })().catch(() => undefined);
  return {
    events,
    stop: async () => {
      controller.abort();
      await reading;
    },
  };
}

async function waitFor(isDone: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (isDone()) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('overseer-api', ['--project', 'Example Agency', '--no-claude-md', '--no-hooks'], SPEC_CLOCK);
  homeDirectory       = createScratchDirectory('overseer-api-home');
});

afterEach(async () => {
  await run(['run', 'stop']);
  removeScratchDirectory(repositoryDirectory);
  removeScratchDirectory(homeDirectory);
});

describe('the Overseer API on a scratch board', () => {
  test('the Baton names the token file and holds no token; that token is what an Origin-less command needs, answered 200, 409 or 400', async () => {
    const runner = startAgentProgress(['run', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory });
    const url = await runner.firstOutputLine ?? '';
    const leaseFile = readdirSync(runnerDirectory()).find((fileName) => fileName.startsWith('lease-')) ?? '';
    const leaseText = readFileSync(join(runnerDirectory(), leaseFile), 'utf8');
    const lease = JSON.parse(leaseText) as { tokenFile: string };
    expect(realpathSync(lease.tokenFile)).toBe(realpathSync(join(runnerDirectory(), 'token')));
    const token = readFileSync(lease.tokenFile, 'utf8');
    expect(token.length).toBeGreaterThan(0);
    expect(leaseText).not.toContain(token);
    expect(Object.keys(lease)).not.toContain('token');

    const command = (body: string, authorization = `Bearer ${token}`) => fetch(new URL('api/commands', url), { method: 'POST', headers: { authorization }, body });
    expect((await command(JSON.stringify({ kind: 'runner-resume' }), 'Bearer not-the-token')).status).toBe(401);
    const resumed = await command(JSON.stringify({ kind: 'runner-resume' }));
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ outcome: 'done' });
    const refused = await command(JSON.stringify({ kind: 'ticket-unhold', ticketReference: '999' }));
    expect(refused.status).toBe(409);
    expect(typeof ((await refused.json()) as { refusal: unknown }).refusal).toBe('string');
    expect((await command(JSON.stringify({ kind: 'no-such-command' }))).status).toBe(400);
    expect((await command('not json')).status).toBe(400);

    const state = await (await fetch(new URL('api/state', url))).json() as Record<string, unknown>;
    expect(state).toMatchObject({ project: 'Example Agency', overseer: { state: 'serving', url, paused: false }, usage: { resetsAt: null } });
    for (const field of ['tickets', 'concurrency', 'readyTickets', 'ticketCountByStatus', 'page', 'jobs', 'decisions', 'incidents', 'notices', 'mergeQueue']) {
      expect(Object.keys(state)).toContain(field);
    }
    const summary = await (await fetch(new URL('api/summary', url))).json() as Record<string, unknown>;
    const fixture = JSON.parse(readFileSync(SUMMARY_FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(summary)).toEqual(Object.keys(fixture));
    expect(summary['summaryVersion']).toBe(1);
  }, API_TEST_TIMEOUT_MILLISECONDS);

  test('GET / serves the Bridge from its HTML import, its bundled script and stylesheet served beside it', async () => {
    const runner = startAgentProgress(['run', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory });
    const url = await runner.firstOutputLine ?? '';
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('<div id="bridge-root"></div>');
    const scriptPath = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] ?? '';
    const stylesheetPath = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(html)?.[1] ?? /<link[^>]+href="([^"]+)"[^>]+rel="stylesheet"/.exec(html)?.[1] ?? '';
    const script = await fetch(new URL(scriptPath, url));
    expect(script.status).toBe(200);
    expect(await script.text()).toContain('bridge-root');
    expect((await fetch(new URL(stylesheetPath, url))).status).toBe(200);
  }, API_TEST_TIMEOUT_MILLISECONDS);

  test('an event-stream client sees a board event for a ticket move and a job event for each state the build job is published in', async () => {
    const runner = startAgentProgress(['run', '--port', '0'], { currentDirectory: repositoryDirectory, homeDirectory });
    const url = await runner.firstOutputLine ?? '';
    const stream = collectEvents(url);
    try {
      await waitFor(() => stream.events.some((event) => event.kind === 'board'), 'the first board event');
      await run(['checks', 'true']);
      await run(['run', 'resume']);
      await fileReadyTicketThrough(run, (result) => result.standardOutput, ['ticket', 'add', '--type', 'ticket', 'Export the example roles']);
      const ticketStatusesOf = (event: StreamedEvent) => (event.data['tickets'] as { id: string; status: string }[] | undefined) ?? [];
      await waitFor(() => stream.events.some((event) => event.kind === 'board' && ticketStatusesOf(event).some((ticket) => ticket.id === '001')), 'the filed ticket');
      const buildJobStates = () => stream.events.filter((event) => event.kind === 'job' && event.data['kind'] === 'build').map((event) => event.data['state']);
      await waitFor(() => buildJobStates().includes('running'), 'the build job running');
      expect([...new Set(buildJobStates())]).toEqual(['launching', 'preparing', 'running']);
      const buildJobEvent = stream.events.find((event) => event.kind === 'job' && event.data['kind'] === 'build');
      expect(buildJobEvent?.data['live']).toMatchObject({ toolCalls: 0, toolCallsWithSubagents: 0, lastToolCall: null });
    } finally {
      await stream.stop();
    }
  }, API_TEST_TIMEOUT_MILLISECONDS);
});

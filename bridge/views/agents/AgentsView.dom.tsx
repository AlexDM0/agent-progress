/**
 * The Agents view in a happy-dom document, against a fake clock, a fake transcript stream and a fake command client. What matters: a job
 * row carries every live fact and a `job` event replaces it; subagents sit under their job with their own counts and tokens; the elapsed
 * time ticks each second, says "running" while the call has no result, and is tinted only while silent sweeps are above zero; the
 * transcript replays then follows, resumes after its last cursor when reopened, and renders an agent's markup as text; each control posts
 * its ControlCommand and shows a refusal verbatim; a watch-only Watcher is worded and offers only Stop.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { BoardStateDocument, OverseerIdentity }                                       from '../../@types/BoardStateDocument.ts';
import type { CommandOutcome, ControlCommandBody }                                         from '../../api/CommandClient.ts';
import type { EventStreamHandlers }                                                        from '../../api/EventStreamClient.ts';
import type { TranscriptEntryDocument, TranscriptStreamHandlers, TranscriptStreamOptions } from '../../api/TranscriptStreamClient.ts';
import { BridgeApp }                                                                       from '../../shell/BridgeApp.tsx';
import { ControlSurroundingsContext }                                                      from '../../shell/ControlAvailability.ts';
import type { AgentJobDocument, JobLiveFactsDocument }                                     from './AgentJobDocument.ts';
import { AgentsView, type AgentsClock }                                                    from './AgentsView.tsx';

const STARTED_AT = '2026-10-29T20:00:00Z';

const LIVE: JobLiveFactsDocument = {
  calls:        12,
  callBudget:   150,
  tokens:       48_000,
  toolCalls:    7,
  lastToolCall: { toolName: 'Bash', startedAt: STARTED_AT, running: true },
  subagents:    [{
    parentToolUseId: 'toolu-agent-1', toolCalls: 4, lastToolCall: { toolName: 'Grep', startedAt: STARTED_AT, running: false }, tokens: 9_000
  }],
  toolCallsWithSubagents: 11,
  silentSweeps:           0,
  watcherProtocol:        1,
  watchOnly:              false,
};

const BUILD_JOB: AgentJobDocument = {
  id: 'J12', kind: 'build', role: 'builder', ticketIds: ['042'], state: 'running', attempt: 1, watcherInstance: 1, crashResumes: 0, live: LIVE,
};

interface FakeClock {
  readonly clock:   AgentsClock;
  readonly advance: (seconds: number) => void;
}

function fakeClock(): FakeClock {
  let current = new Date('2026-10-29T20:00:05Z').getTime();
  const ticks = new Set<() => void>();
  return {
    clock: {
      now:         () => new Date(current),
      everySecond: (tick) => {
        ticks.add(tick);
        return () => ticks.delete(tick);
      },
    },
    advance: (seconds) => {
      for (let i = 0; i < seconds; i += 1) {
        current += 1000;
        act(() => ticks.forEach((tick) => tick()));
      }
    },
  };
}

interface FakeTranscripts {
  readonly follow:  (jobId: string, handlers: TranscriptStreamHandlers, options?: TranscriptStreamOptions) => { close: () => void; lastCursor: () => string | null };
  readonly opened:  { jobId: string; after: string | null }[];
  readonly deliver: (entries: readonly TranscriptEntryDocument[]) => void;
}

function fakeTranscripts(): FakeTranscripts {
  const opened: { jobId: string; after: string | null }[] = [];
  let handlers: TranscriptStreamHandlers | null = null;
  return {
    follow: (jobId, streamHandlers, options) => {
      opened.push({ jobId, after: options?.after ?? null });
      handlers = streamHandlers;
      return { close: () => undefined, lastCursor: () => null };
    },
    opened,
    deliver: (entries) => act(() => handlers?.onEntries(entries)),
  };
}

interface Rendered {
  readonly sent:     ControlCommandBody[];
  readonly rerender: (jobs: readonly AgentJobDocument[], selectedJobId?: string | null) => void;
}

interface RenderOptions {
  readonly selectedJobId?: string | null;
  readonly clock?:         AgentsClock;
  readonly transcripts?:   FakeTranscripts;
  readonly outcome?:       CommandOutcome;
  readonly decisions?:     readonly { id: string; jobId: string }[];
}

function renderAgents(jobs: readonly AgentJobDocument[], options: RenderOptions = {}): Rendered {
  const sent: ControlCommandBody[] = [];
  const surroundings = {
    availability:  'enabled' as const,
    commandClient: {
      send: (command: ControlCommandBody) => {
        sent.push(command);
        return Promise.resolve(options.outcome ?? { verdict: 'applied' as const, outcome: 'done', result: null });
      },
    },
    onInstallHeld: () => undefined,
  };
  const clock = options.clock ?? fakeClock().clock;
  const transcripts = options.transcripts ?? fakeTranscripts();
  const view = (shownJobs: readonly AgentJobDocument[], selectedJobId: string | null) => (
    <ControlSurroundingsContext.Provider value={surroundings}>
      <AgentsView jobs={shownJobs} decisions={options.decisions ?? []} selectedJobId={selectedJobId} clock={clock} followTranscript={transcripts.follow} />
    </ControlSurroundingsContext.Provider>
  );
  const { rerender } = render(view(jobs, options.selectedJobId ?? null));
  return { sent, rerender: (shownJobs, selectedJobId = options.selectedJobId ?? null) => rerender(view(shownJobs, selectedJobId)) };
}

function jobRow(jobId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`tr[data-job-id="${jobId}"]`);
  if (row === null) throw new Error(`no row for ${jobId}`);
  return row;
}

function cellOf(row: Element, column: string): HTMLElement {
  const cell = row.querySelector<HTMLElement>(`td[data-column="${column}"]`);
  if (cell === null) throw new Error(`no ${column} cell`);
  return cell;
}

async function clicked(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('the job rows', () => {
  test('a job row shows its state, phase, calls against budget, tool calls, tokens, last tool, silent sweeps and Watcher protocol', () => {
    renderAgents([{
      ...BUILD_JOB, kind: 'merge', role: null, airlock: { phase: 'gating' }
    }]);
    const row = jobRow('J12');
    expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual([
      'J12', 'merge', '#042', 'running', 'gating', '12 / 150', '7 (11 with subagents)', '48,000', 'Bashrunning5s', '0', 'protocol 1',
    ]);
  });

  test('subagents sit under their job by parent_tool_use_id, each with its own tool calls, last call and tokens', () => {
    renderAgents([BUILD_JOB]);
    const subagentRow = document.querySelector('tr[data-parent-tool-use-id="toolu-agent-1"]');
    if (subagentRow === null) throw new Error('no subagent row');
    expect(subagentRow.previousElementSibling).toBe(jobRow('J12'));
    expect(cellOf(subagentRow, 'tool-calls').textContent).toBe('4');
    expect(cellOf(subagentRow, 'tokens').textContent).toBe('9,000');
    expect(cellOf(subagentRow, 'last-tool').textContent).toBe('Grep5s');
  });

  test('a job event delivered through the shell replaces the job\'s row', async () => {
    window.location.hash = '#agents';
    let handlers: EventStreamHandlers | null = null;
    const identity: OverseerIdentity = { trackerId: 'example-tracker', project: 'Example Agency', codeVersion: 'code-1' };
    const board: BoardStateDocument = {
      project: 'Example Agency', jobs: [BUILD_JOB], decisions: [], incidents: [], overseer: { state: 'serving', paused: false, codeVersion: 'code-1' }, usage: null,
    };
    render(<BridgeApp services={{
      commandClient:   { send: () => Promise.resolve({ verdict: 'unreachable' }) },
      openEventStream: (streamHandlers) => {
        handlers = streamHandlers;
        return { close: () => undefined };
      },
      fetchIdentity:        () => Promise.resolve(identity),
      reload:               () => undefined,
      storage:              () => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }),
      embedded:             false,
      embeddedSurroundings: () => ({ window, parent: null, parentOrigin: null }),
      now:                  () => new Date('2026-10-29T20:00:05Z'),
      followTranscript:     () => ({ close: () => undefined }),
      questionNotifier:     {
        allowance:         () => 'denied',
        askAllowance:      () => Promise.resolve('denied'),
        notify:            () => undefined,
        setDocumentTitle:  () => undefined,
        baseDocumentTitle: 'agent-progress',
      },
    }} />);
    const stream = (): EventStreamHandlers => {
      if (handlers === null) throw new Error('no event stream');
      return handlers;
    };
    await act(async () => {
      stream().onConnection('live');
      stream().onEvent('board', board);
      await Promise.resolve();
    });
    expect(cellOf(jobRow('J12'), 'calls').textContent).toBe('12 / 150');
    act(() => stream().onEvent('job', { ...BUILD_JOB, state: 'in-customs', live: { ...LIVE, calls: 13 } }));
    expect(cellOf(jobRow('J12'), 'calls').textContent).toBe('13 / 150');
    expect(within(jobRow('J12')).getByText('in-customs')).toBeDefined();
  });
});

describe('the time since the last tool call', () => {
  test('ticks each second with the tool\'s name and "running" while the call has no result', () => {
    const { clock, advance } = fakeClock();
    const { rerender } = renderAgents([BUILD_JOB], { clock });
    expect(cellOf(jobRow('J12'), 'last-tool').textContent).toBe('Bashrunning5s');
    advance(2);
    expect(cellOf(jobRow('J12'), 'last-tool').textContent).toBe('Bashrunning7s');
    advance(60);
    expect(cellOf(jobRow('J12'), 'last-tool').textContent).toBe('Bashrunning1m 07s');
    rerender([{ ...BUILD_JOB, live: { ...LIVE, lastToolCall: { toolName: 'Bash', startedAt: STARTED_AT, running: false } } }]);
    expect(cellOf(jobRow('J12'), 'last-tool').textContent).toBe('Bash1m 07s');
  });

  test('takes the warning tint only while the job\'s silent sweeps are above zero, however long the time grows', () => {
    const { clock, advance } = fakeClock();
    const { rerender } = renderAgents([BUILD_JOB], { clock });
    const tinted = () => jobRow('J12').querySelector('.agents-elapsed')?.classList.contains('agents-elapsed-silent');
    advance(3600);
    expect(tinted()).toBe(false);
    rerender([{ ...BUILD_JOB, live: { ...LIVE, silentSweeps: 1 } }]);
    expect(tinted()).toBe(true);
    expect(cellOf(jobRow('J12'), 'silent-sweeps').textContent).toBe('1');
    rerender([{ ...BUILD_JOB, live: { ...LIVE, silentSweeps: 0 } }]);
    expect(tinted()).toBe(false);
  });
});

describe('the transcript', () => {
  test('replays history then follows, renders agent markup as text, and resumes after its last cursor when the panel is reopened', () => {
    const transcripts = fakeTranscripts();
    const { rerender } = renderAgents([BUILD_JOB], { selectedJobId: 'J12', transcripts });
    expect(transcripts.opened).toEqual([{ jobId: 'J12', after: null }]);
    transcripts.deliver([{ cursor: '1.1', role: 'assistant', text: '<b>Reading</b> the ticket.' }]);
    transcripts.deliver([{
      cursor: '1.2', role: 'tool-call', text: '{"command":"ls"}', toolName: 'Bash'
    }]);
    const texts = () => [...document.querySelectorAll('.agents-transcript-text')].map((text) => text.textContent);
    expect(texts()).toEqual(['<b>Reading</b> the ticket.', 'Bash']);
    expect(document.querySelector('.agents-transcript b')).toBeNull();
    rerender([BUILD_JOB], null);
    rerender([BUILD_JOB], 'J12');
    expect(transcripts.opened.at(-1)).toEqual({ jobId: 'J12', after: '1.2' });
    expect(texts()).toEqual(['<b>Reading</b> the ticket.', 'Bash']);
  });
});

describe('the controls', () => {
  test('Message, Answer, Wind down, Stop and Fresh agent post their ControlCommands', async () => {
    const { sent } = renderAgents([{ ...BUILD_JOB, state: 'waiting-for-answer' }], { selectedJobId: 'J12', decisions: [{ id: 'D3', jobId: 'J12' }] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Rebase first.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), { target: { value: 'Use the shared helper.' } });
    for (const name of ['Send message', 'Send answer', 'Wind down', 'Stop', 'Fresh agent']) await clicked(name);
    expect(sent).toEqual([
      { kind: 'job-message', jobId: 'J12', text: 'Rebase first.' },
      { kind: 'decision-answer', decisionId: 'D3', answer: { form: 'text', text: 'Use the shared helper.' } },
      { kind: 'job-stop', jobId: 'J12', mode: 'wind-down' },
      { kind: 'job-stop', jobId: 'J12', mode: 'stop' },
      { kind: 'job-fresh', jobId: 'J12' },
    ]);
  });

  test('Answer is offered only while one of the job\'s decisions is open', () => {
    renderAgents([BUILD_JOB], { selectedJobId: 'J12' });
    expect(screen.queryByRole('button', { name: 'Send answer' })).toBeNull();
  });

  test('a refusal shows its worded text beside the control', async () => {
    renderAgents([BUILD_JOB], { selectedJobId: 'J12', outcome: { verdict: 'refused', refusal: 'Job J12 is not running: it is verifying.' } });
    await clicked('Fresh agent');
    expect(screen.getByRole('status').textContent).toBe('Job J12 is not running: it is verifying.');
  });

  test('a legacy Watcher shows "running on Watcher protocol N: watch only" and offers only Stop', () => {
    renderAgents([{ ...BUILD_JOB, live: { ...LIVE, watcherProtocol: 0, watchOnly: true } }], { selectedJobId: 'J12' });
    expect(cellOf(jobRow('J12'), 'watcher').textContent).toBe('running on Watcher protocol 0: watch only');
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Stop']);
  });
});

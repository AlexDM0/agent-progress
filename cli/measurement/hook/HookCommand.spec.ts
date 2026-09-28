/**
 * The one line this command writes, the rows its brief names that it adds the agent's tokens to, and
 * the eight ways it is allowed to write nothing, installed files of another install version among them. The failure
 * cases carry the weight: each one asserts **exit 0 and an untouched tracker**. The agent has already
 * finished when this runs, so a non-zero exit prevents nothing; what it does produce is an error the
 * orchestrator has to read and a delay before it hears its agent is done, and both cost more than the
 * log line nobody gets.
 */
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { LogFileIngestion }                               from '../../../src/adapters/log/LogFileIngestion.ts';
import { OperationRefusalWordingUtil }                    from '../../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { LIMITS }                                         from '../../../src/shared/constants/Limits.ts';
import { lockRetryWaitsDuring }                           from '../../../src/testing/LockRetryWaits.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                       from '../../../src/testing/ToolGuard.ts';
import { installedFilePathsIn }                           from '../../InstalledFiles.ts';
import { runCommandLine }                                 from '../../Main.ts';
import { INSTALL_VERSION }                                from '../../constants/InstallVersion.ts';
import { createCapturedCommandContext }                   from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }             from '../../testing/InitializedScratchRepository.ts';
import { storedLogEntriesOf }                             from '../../testing/StoredLogEntries.ts';
import { storedProgressOf }                               from '../../testing/StoredProgress.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const TRANSCRIPT_FILE_NAME = 'agent-example.jsonl';

let repositoryDirectory = '';
let transcriptPath      = '';

function assistantLine(messageIdentifier: string, inputTokens: number, cacheReadTokens: number, outputTokens: number, cacheCreationTokens = 0): string {
  return JSON.stringify({
    type:    'assistant',
    message: {
      id:    messageIdentifier,
      usage: {
        input_tokens:            inputTokens,
        cache_read_input_tokens: cacheReadTokens,
        ...(cacheCreationTokens > 0 ? { cache_creation_input_tokens: cacheCreationTokens } : {}),
        output_tokens:           outputTokens,
      },
    },
  });
}

function writeTranscript(lines: readonly string[]): string {
  const path = join(repositoryDirectory, TRANSCRIPT_FILE_NAME);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function hookInput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    agent_id:              'agent_42',
    agent_type:            'general-purpose',
    agent_transcript_path: transcriptPath,
    cwd:                   repositoryDirectory,
    ...overrides,
  });
}

function contextWith(standardInputText: string, currentDirectory = repositoryDirectory): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory, now: () => FROZEN_NOW, standardInputText });
}

function storedTokensOf(rowIdentifier: number): number | null | undefined {
  return storedProgressOf(repositoryDirectory).tasks.find((task) => task.id === rowIdentifier)?.tokens;
}

async function addedRow(name: string): Promise<number> {
  expect(await runCommandLine(['task', 'add', name], contextWith(''))).toBe(0);
  const rowIdentifier = storedProgressOf(repositoryDirectory).tasks.at(-1)?.id;
  if (rowIdentifier === undefined) throw new Error(`task add "${name}" filed no row`);
  return rowIdentifier;
}

function lastStoredLogLine(): Record<string, unknown> {
  const logLines = readFileSync(join(repositoryDirectory, '.agent-progress', 'log.jsonl'), 'utf8').trim().split('\n');
  return JSON.parse(logLines.at(-1) ?? '{}') as Record<string, unknown>;
}

function userLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
}

/** The fixture's two calls: 10 + 90,000 and 20 + 140,000, the figure the log line rounds to `input 230k`. */
const FIXTURE_INPUT_TOKENS = 230_030;

const FIXTURE_CALLS = [
  assistantLine('msg_one', 10, 90_000, 400),
  assistantLine('msg_one', 10, 90_000, 1200),
  assistantLine('msg_two', 20, 140_000, 800),
];

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('hook-command', ['--project', 'Example Agency'], () => FROZEN_NOW);
  transcriptPath = writeTranscript([
    assistantLine('msg_one', 10, 90_000, 400),
    assistantLine('msg_one', 10, 90_000, 1200),
    assistantLine('msg_two', 20, 140_000, 800),
  ]);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('a subagent that stopped', () => {
  test('gets one log line naming it, its calls and what it cost, summed per call and not per line', async () => {
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    const lastEntry = storedLogEntriesOf(repositoryDirectory).at(-1);
    expect(lastEntry?.text).toBe('Agent agent_42 (general-purpose) stopped: 2 calls, end context 140k, input 230k (cache read 230k), output 2k');
    expect(context.errorText()).toBe('');
  });

  /**
   * The hook runs wherever the harness is, and the agent that stopped may have been in a worktree, so
   * the tracker is found from the hook input's `cwd` rather than from this process's directory.
   */
  test('the tracker is found from the hook input\'s cwd, not from where the command was run', async () => {
    const elsewhere = createScratchDirectory('hook-command-elsewhere');
    try {
      const context = contextWith(hookInput(), elsewhere);

      expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

      expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('Agent agent_42');
    } finally {
      removeScratchDirectory(elsewhere);
    }
  });

  test('an input without an agent id or type still records the cost, under a name that says so', async () => {
    const context = contextWith(hookInput({ agent_id: undefined, agent_type: undefined }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toStartWith('Agent unknown (unknown) stopped: 2 calls');
  });

  // The log's input figure must count cache creation too, and only this case pins that the hook does the addition.
  test('the logged input counts fresh input, cache read and cache creation together', async () => {
    transcriptPath = writeTranscript([assistantLine('msg_one', 1000, 9000, 500, 2000)]);
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('input 12k (cache read 9k)');
  });

  // The log's ingestion refuses a count that is not whole, so a stored fraction would leave every later command unable to read the log.
  test('a fractional token count in the transcript is logged as zero, and the log stays readable for the next command', async () => {
    transcriptPath = writeTranscript([assistantLine('msg_one', 10.5, 9000, 500)]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    const reading = new LogFileIngestion(join(repositoryDirectory, '.agent-progress', 'log.jsonl')).read();
    if (reading.verdict !== 'readable') throw new Error(`the log is ${reading.verdict} after the hook ran`);
    const agentStopped = reading.records.at(-1);
    if (agentStopped?.kind !== 'agent-stopped') throw new Error('the hook logged no agent-stopped record');
    expect(agentStopped.fields.totalInputTokens).toBe(9000);
    expect(agentStopped.fields.endContextTokens).toBe(9000);
    expect(await runCommandLine(['status'], contextWith(''))).toBe(0);
  });
});

describeWhenGitIsPresent('the row the brief names', () => {
  /** Adding rather than setting is the claim: a row an implementer and a second pass both worked on carries what both cost. */
  test('a brief naming a row takes its tokens from unset to the input total, and another agent on the same brief doubles it', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([userLine(`Do the work.\nagent-progress row: ${rowIdentifier}\nStop at 150 calls.`), ...FIXTURE_CALLS]);
    expect(storedTokensOf(rowIdentifier)).toBeNull();

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);
    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('input 230k');

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput({ agent_id: 'agent_43' })))).toBe(0);
    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS * 2);
  });

  /** A resumed agent appends to the transcript it stopped with, so its second stop's total already holds the first's. */
  test('a resumed agent that stops twice leaves its row holding its transcript total once, and each stop is still logged whole', async () => {
    const rowIdentifier = await addedRow('Example resumed work');
    const briefLine     = userLine(`agent-progress row: ${rowIdentifier}`);
    transcriptPath      = writeTranscript([briefLine, ...FIXTURE_CALLS]);
    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    transcriptPath = writeTranscript([briefLine, ...FIXTURE_CALLS, userLine('Carry on.'), assistantLine('msg_three', 30, 150_000, 100)]);
    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);
    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS + 150_030);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('3 calls, end context 150k, input 380.1k');

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);
    expect(storedTokensOf(rowIdentifier), 'a stop that added nothing credits nothing').toBe(FIXTURE_INPUT_TOKENS + 150_030);
  });

  test('two stops the input names no agent for are both credited whole, since nothing tells them apart', async () => {
    const rowIdentifier = await addedRow('Example anonymous work');
    transcriptPath      = writeTranscript([userLine(`agent-progress row: ${rowIdentifier}`), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput({ agent_id: undefined })))).toBe(0);
    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput({ agent_id: undefined })))).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS * 2);
  });

  test('a bundle divides the total evenly, and the remainder goes to the first row named', async () => {
    const firstRow  = await addedRow('Example first');
    const secondRow = await addedRow('Example second');
    transcriptPath  = writeTranscript([userLine(`agent-progress row: ${firstRow}, ${secondRow}`), assistantLine('msg_only', 1001, 0, 50)]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOf(firstRow)).toBe(501);
    expect(storedTokensOf(secondRow)).toBe(500);
  });

  /** A reviewer's brief can quote the builder's marker further down the conversation; only the agent's own brief may name its row. */
  test('a marker that appears only in a later message changes no row, and the log line is still written', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([
      userLine('Review the branch.'),
      assistantLine('msg_one', 10, 90_000, 400),
      userLine(`agent-progress row: ${rowIdentifier}`),
      assistantLine('msg_two', 20, 140_000, 800),
    ]);
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBeNull();
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('Agent agent_42');
    expect(context.errorText()).toBe('');
  });

  test('a brief without a marker leaves every row as it was', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([userLine('Do the work.'), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBeNull();
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('input 230k');
  });

  test('a row the tracker does not hold is named on standard error, the rows it does hold are recorded, and it exits 0', async () => {
    const rowIdentifier = await addedRow('Example work');
    const missingRow    = rowIdentifier + 900;
    transcriptPath      = writeTranscript([userLine(`agent-progress row: ${rowIdentifier}, ${missingRow}`), assistantLine('msg_only', 1001, 0, 50)]);
    const context       = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBe(501);
    expect(context.errorText()).toContain(`#${missingRow}`);
    expect(context.errorText().trim().split('\n'), 'one sentence for the one missing row').toHaveLength(1);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('Agent agent_42');
  });

  /** The path and the agent type a workflow agent was observed with; nothing in them may stop the row from being found. */
  test('a workflow agent\'s transcript under subagents/workflows/<runId>/ is recorded like any other', async () => {
    const rowIdentifier    = await addedRow('Example workflow step');
    const workflowFolder   = join(repositoryDirectory, 'session', 'subagents', 'workflows', 'run_example');
    const workflowPath     = join(workflowFolder, 'agent-example.jsonl');
    mkdirSync(workflowFolder, { recursive: true });
    writeFileSync(workflowPath, `${[userLine(`agent-progress row: ${rowIdentifier}`), ...FIXTURE_CALLS].join('\n')}\n`);
    const context = contextWith(hookInput({ agent_type: 'workflow-subagent', agent_transcript_path: workflowPath }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toStartWith('Agent agent_42 (workflow-subagent) of workflow run run_example stopped:');
  });

  test('a workflow agent\'s record names its run and the label from the .meta.json beside its transcript', async () => {
    const workflowFolder = join(repositoryDirectory, 'session', 'subagents', 'workflows', 'wf_example-run');
    const workflowPath   = join(workflowFolder, 'agent-example.jsonl');
    mkdirSync(workflowFolder, { recursive: true });
    writeFileSync(workflowPath, `${FIXTURE_CALLS.join('\n')}\n`);
    writeFileSync(join(workflowFolder, 'agent-example.meta.json'), JSON.stringify({ agentType: 'workflow-subagent', description: 'build #7' }));

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput({ agent_type: 'workflow-subagent', agent_transcript_path: workflowPath })))).toBe(0);

    const agentStopped = lastStoredLogLine();
    expect(agentStopped['fields']).toMatchObject({ workflowRunId: 'wf_example-run', agentLabel: 'build #7' });
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text)
      .toStartWith('Agent agent_42 "build #7" (workflow-subagent) of workflow run wf_example-run stopped:');
    expect(await runCommandLine(['status'], contextWith(''))).toBe(0);
  });

  test('a plain subagent\'s record holds exactly the keys it always held, even with a .meta.json beside its transcript', async () => {
    writeFileSync(join(repositoryDirectory, 'agent-example.meta.json'), JSON.stringify({ description: 'Example plain agent' }));

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(JSON.stringify(lastStoredLogLine()['fields'])).toBe(JSON.stringify({
      agentId:              'agent_42',
      agentType:            'general-purpose',
      apiCallCount:         2,
      endContextTokens:     140_020,
      totalInputTokens:     FIXTURE_INPUT_TOKENS,
      cacheReadInputTokens: 230_000,
      outputTokens:         2000,
    }));
  });

  test('a transcript path starting with ~ is read under the home directory the context carries', async () => {
    const rowIdentifier     = await addedRow('Example home transcript');
    const homeDirectory     = join(repositoryDirectory, 'example-home');
    const transcriptsFolder = join(homeDirectory, 'transcripts');
    mkdirSync(transcriptsFolder, { recursive: true });
    writeFileSync(join(transcriptsFolder, TRANSCRIPT_FILE_NAME), `${[userLine(`agent-progress row: ${rowIdentifier}`), ...FIXTURE_CALLS].join('\n')}\n`);
    const context = createCapturedCommandContext({
      currentDirectory:  repositoryDirectory,
      now:               () => FROZEN_NOW,
      standardInputText: hookInput({ agent_transcript_path: `~/transcripts/${TRANSCRIPT_FILE_NAME}` }),
      homeDirectory,
    });

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(context.errorText()).toBe('');
    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS);
  });
});

/**
 * The ticket form exists because a low ticket has no row until its builder claims it, after the brief
 * is written. So every case files the ticket, writes the brief, and only then creates the row — the
 * claim is resolved when the hook runs, never when the brief was written.
 */
describeWhenGitIsPresent('the tickets the brief names', () => {
  async function filedLowTicket(title: string): Promise<void> {
    expect(await runCommandLine(['ticket', 'add', title, '--priority', 'low'], contextWith(''))).toBe(0);
  }

  async function startedTicket(reference: string): Promise<void> {
    expect(await runCommandLine(['ticket', 'start', reference], contextWith(''))).toBe(0);
  }

  function storedTokensOfTicketRow(ticketIdentifier: string): number | null | undefined {
    return storedProgressOf(repositoryDirectory).tasks.find((task) => task.ticket === ticketIdentifier)?.tokens;
  }

  test('a ticket given no row until after the brief was written takes the input total on the row it has when the hook runs', async () => {
    await filedLowTicket('Example low work');
    transcriptPath = writeTranscript([userLine('Claim it first.\nagent-progress ticket: 1'), ...FIXTURE_CALLS]);
    expect(storedTokensOfTicketRow('001')).toBeUndefined();
    await startedTicket('1');

    const context = contextWith(hookInput());
    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOfTicketRow('001')).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('input 230k');
    expect(context.errorText()).toBe('');
  });

  test('a bundle named by padded and unpadded ids divides the total as the row form does, remainder to the first named', async () => {
    await filedLowTicket('Example first');
    await filedLowTicket('Example second');
    await startedTicket('1');
    await startedTicket('2');
    transcriptPath = writeTranscript([userLine('agent-progress ticket: 002, 1'), assistantLine('msg_only', 1001, 0, 50)]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOfTicketRow('002')).toBe(501);
    expect(storedTokensOfTicketRow('001')).toBe(500);
  });

  /** An unclaimed ticket's share is lost rather than moved onto its neighbour, exactly as a missing row's is in the row form. */
  test('a named ticket with no row at hook time is skipped in one sentence on standard error, and it exits 0', async () => {
    await filedLowTicket('Example claimed');
    await filedLowTicket('Example never claimed');
    await startedTicket('1');
    transcriptPath = writeTranscript([userLine('agent-progress ticket: 1, 2'), assistantLine('msg_only', 1001, 0, 50)]);
    const context  = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOfTicketRow('001')).toBe(501);
    expect(storedTokensOfTicketRow('002')).toBeUndefined();
    expect(context.errorText()).toContain('ticket #002, which has no row yet');
    expect(context.errorText().trim().split('\n'), 'one sentence for the one ticket without a row').toHaveLength(1);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('Agent agent_42');
  });

  test('a named ticket the tracker does not hold is skipped in one sentence, and it exits 0', async () => {
    transcriptPath = writeTranscript([userLine('agent-progress ticket: 42'), ...FIXTURE_CALLS]);
    const context  = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(context.errorText().trim()).toBe(
      'agent-progress hook subagent-stop: the brief names ticket #042, which the tracker does not hold, so its share of the tokens was not recorded.',
    );
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('Agent agent_42');
  });

  /** Adding both would count the agent twice when the orchestrator named a ticket and its row; the row line names the bar directly, so it wins. */
  test('a brief carrying both lines is read by its row line alone, and the ticket\'s row is left as it was', async () => {
    const freeRow = await addedRow('Example review');
    await filedLowTicket('Example low work');
    await startedTicket('1');
    transcriptPath = writeTranscript([userLine(`agent-progress ticket: 1\nagent-progress row: ${freeRow}`), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOf(freeRow)).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedTokensOfTicketRow('001')).toBeNull();
  });
});

/**
 * Shaped like a dispatcher agent's transcript: plain-string user turns, the harness's relay of the session user's request first and the
 * script's computed task, whose lines the harness indents, second. The brief is the computed task, and nothing after a relay stands in for it.
 */
describeWhenGitIsPresent('a workflow agent\'s brief after the harness\'s relay', () => {
  const BUILT_TICKET_NUMBER = 7;

  const RELAY_TURN = '[Workflow harness — user request] The harness relays, verbatim and indented below, the user request.\n  Run the board.';

  function plainUserLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  }

  function computedTaskLine(indentedTask: string): string {
    return plainUserLine(`[Workflow harness — computed task] The task text below was computed at runtime by a workflow script.\n${indentedTask}`);
  }

  function storedTokensOfBuiltTicketRow(): number | null | undefined {
    return storedProgressOf(repositoryDirectory).tasks.find((task) => task.ticket === '007')?.tokens;
  }

  beforeEach(async () => {
    for (let i = 1; i <= BUILT_TICKET_NUMBER; i++) {
      expect(await runCommandLine(['ticket', 'add', `Example work ${i}`], contextWith(''))).toBe(0);
    }
    expect(storedTokensOfBuiltTicketRow()).toBeNull();
  });

  test('the computed task\'s ticket line adds the input total to that ticket\'s row', async () => {
    transcriptPath = writeTranscript([
      plainUserLine(RELAY_TURN),
      computedTaskLine(`  agent-progress ticket: ${BUILT_TICKET_NUMBER}\n  You build ticket #007.`),
      ...FIXTURE_CALLS,
    ]);
    const context = contextWith(hookInput({ agent_type: 'workflow-subagent' }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOfBuiltTicketRow()).toBe(FIXTURE_INPUT_TOKENS);
    expect(context.errorText()).toBe('');
  });

  test('a computed task without a marker records nothing on any row', async () => {
    transcriptPath = writeTranscript([plainUserLine(RELAY_TURN), computedTaskLine('  Build the ticket.'), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedProgressOf(repositoryDirectory).tasks.every((task) => task.tokens === null)).toBe(true);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('input 230k');
  });

  test('a relay whose later ordinary user message carries a marker records nothing on any row', async () => {
    transcriptPath = writeTranscript([
      plainUserLine(RELAY_TURN),
      assistantLine('msg_one', 10, 90_000, 400),
      plainUserLine(`agent-progress ticket: ${BUILT_TICKET_NUMBER}`),
      assistantLine('msg_two', 20, 140_000, 800),
    ]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedProgressOf(repositoryDirectory).tasks.every((task) => task.tokens === null)).toBe(true);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('Agent agent_42');
  });
});

/**
 * The review form exists because a reviewer inside a workflow files its own review row, after its brief was written, so the brief can
 * name only the ticket. Every case writes the brief first and files the row after; the row is found when the hook runs, whatever its
 * status, because `release` has already delivered it by the time the reviewer stops.
 */
describeWhenGitIsPresent('the ticket a reviewer\'s brief names', () => {
  const REVIEWED_TICKET_NUMBER = 7;

  beforeEach(async () => {
    for (let i = 1; i <= REVIEWED_TICKET_NUMBER; i++) {
      expect(await runCommandLine(['ticket', 'add', `Example work ${i}`], contextWith(''))).toBe(0);
    }
  });

  async function reviewRowFiled(commandArguments: readonly string[]): Promise<number> {
    expect(await runCommandLine(['task', 'add', ...commandArguments], contextWith(''))).toBe(0);
    const rowIdentifier = storedProgressOf(repositoryDirectory).tasks.at(-1)?.id;
    if (rowIdentifier === undefined) throw new Error('task add filed no row');
    return rowIdentifier;
  }

  test('the review row created after the brief takes the input total, delivered or not', async () => {
    transcriptPath = writeTranscript([userLine('Review the branch.\nagent-progress review: 7'), ...FIXTURE_CALLS]);
    const reviewRow = await reviewRowFiled(['Review 1 #007 — Example work 7', '--review-of', '7', '--start']);
    expect(await runCommandLine(['task', 'deliver', String(reviewRow)], contextWith(''))).toBe(0);
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOf(reviewRow)).toBe(FIXTURE_INPUT_TOKENS);
    expect(context.errorText()).toBe('');
  });

  // A second round files a second row; the reviewer that stops is the one whose row was filed last, linked by its reviewOf.
  test('with two review rows for the ticket, the later one gets it and the earlier is left as it was', async () => {
    const firstRound  = await reviewRowFiled(['Review 1 #007 — Example work 7', '--review-of', '7']);
    transcriptPath    = writeTranscript([userLine('agent-progress review: #007'), ...FIXTURE_CALLS]);
    const secondRound = await reviewRowFiled(['Review 2 #7 — Example work 7', '--review-of', '7']);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOf(secondRound)).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedTokensOf(firstRound)).toBeNull();
  });

  test('a ticket with no review row is skipped in one sentence on standard error, and it exits 0 with the log line written', async () => {
    transcriptPath = writeTranscript([userLine('agent-progress review: 7'), ...FIXTURE_CALLS]);
    const context  = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(context.errorText().trim()).toBe(
      'agent-progress hook subagent-stop: the brief names the review of ticket #007, which has no review row, so its share of the tokens was not recorded.',
    );
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('Agent agent_42');
  });

  /** The ticket line names the builder's bar; a brief carrying both belongs to the builder, and counting it on the review too would count it twice. */
  test('a brief carrying the ticket line and the review line is read by its ticket line alone', async () => {
    expect(await runCommandLine(['ticket', 'start', '7'], contextWith(''))).toBe(0);
    const reviewRow = await reviewRowFiled(['Review 1 #007 — Example work 7', '--review-of', '7']);
    transcriptPath  = writeTranscript([userLine('agent-progress review: 7\nagent-progress ticket: 7'), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedProgressOf(repositoryDirectory).tasks.find((task) => task.ticket === '007')?.tokens).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedTokensOf(reviewRow)).toBeNull();
  });

  test('a brief carrying the row line and the review line is read by its row line alone', async () => {
    const freeRow   = await addedRow('Example free row');
    const reviewRow = await reviewRowFiled(['Review 1 #007 — Example work 7', '--review-of', '7']);
    transcriptPath  = writeTranscript([userLine(`agent-progress review: 7\nagent-progress row: ${freeRow}`), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOf(freeRow)).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedTokensOf(reviewRow)).toBeNull();
  });
});

describeWhenGitIsPresent('every way it can fail', () => {
  /** The table is the whole claim: each of these leaves the tracker as it was and still answers 0. */
  test('nothing piped in, input that is not JSON, input that is not an object, and no transcript path all exit 0 and record nothing', async () => {
    const cases: Record<string, string> = {
      'nothing piped in':           '',
      'whitespace only':            '   \n  ',
      'not JSON at all':            'the agent stopped',
      'JSON that is not an object': '["agent_42"]',
      'no transcript path':         hookInput({ agent_transcript_path: undefined }),
    };

    for (const [description, standardInputText] of Object.entries(cases)) {
      const context = contextWith(standardInputText);

      expect(await runCommandLine(['hook', 'subagent-stop'], context), description).toBe(0);

      expect(storedLogEntriesOf(repositoryDirectory), description).toEqual([]);
      expect(context.errorText(), description).toContain('nothing was recorded');
      expect(context.outputText(), description).toBe('');
    }
  });

  test('a transcript that is not there is reported by name and exits 0', async () => {
    const missingPath = join(repositoryDirectory, 'no-such-transcript.jsonl');
    const context     = contextWith(hookInput({ agent_transcript_path: missingPath }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLogEntriesOf(repositoryDirectory)).toEqual([]);
    expect(context.errorText()).toContain(missingPath);
    expect(context.errorText()).toContain('could not be read');
  });

  /** A line of noughts is worse than no line: it reads as a subagent that cost nothing rather than as one nobody measured. */
  test('a transcript holding no API calls records nothing rather than a line of zeroes', async () => {
    const context = contextWith(hookInput({ agent_transcript_path: writeTranscript(['{"type":"user","message":{"content":"do it"}}']) }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLogEntriesOf(repositoryDirectory)).toEqual([]);
    expect(context.errorText()).toContain('holds no API calls');
  });

  /**
   * The only failure that reaches this command as a throw from inside the tracker, and the one a
   * fan-out actually produces: a sibling command holds the lock when the agent stops. A `.lock` that
   * is a plain file rather than the lock directory is one `src/services/tracker/TrackerLock.ts` cannot judge, so it
   * waits it out and then refuses rather than assuming free — so the line is lost, and nothing else is.
   */
  test('a lock the tracker will not give up costs the line only, leaving the log and the lock as they were', async () => {
    const lockFilePath = join(repositoryDirectory, '.agent-progress', '.lock');
    rmSync(lockFilePath, { force: true, recursive: true });
    writeFileSync(lockFilePath, '');
    const context = contextWith(hookInput());

    const { outcome, sleepMilliseconds } = await lockRetryWaitsDuring(() => runCommandLine(['hook', 'subagent-stop'], context));

    expect(outcome).toEqual({ settled: 'fulfilled', value: 0 });
    expect(sleepMilliseconds, 'it waited out the whole retry budget before giving up').toEqual(
      Array.from({ length: LIMITS.LOCK_RETRY_COUNT }, () => LIMITS.LOCK_RETRY_INTERVAL_MILLISECONDS),
    );
    expect(storedLogEntriesOf(repositoryDirectory)).toEqual([]);
    expect(context.errorText().split('\n'), 'one sentence, not a stack the orchestrator has to read').toHaveLength(1);
    expect(context.errorText()).toContain('could not be recorded');
    expect(context.outputText()).toBe('');
    expect(readFileSync(lockFilePath, 'utf8'), 'the lock it refused to take is left exactly as it was').toBe('');
  });

  test('a cwd with no tracker above it is reported and still exits 0, because a hook failure must never reach the orchestrator', async () => {
    const untrackedDirectory = createScratchDirectory('hook-command-untracked');
    try {
      const context = contextWith(hookInput({ cwd: untrackedDirectory }));

      expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

      expect(storedLogEntriesOf(repositoryDirectory)).toEqual([]);
      expect(context.errorText()).toContain(untrackedDirectory);
      expect(context.errorText()).toContain('could not be recorded');
    } finally {
      removeScratchDirectory(untrackedDirectory);
    }
  });

  test('a tracker the input\'s cwd names whose installed files are of another install version is reported once, credits nothing and exits 0', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([userLine(`Do the work.\nagent-progress row: ${rowIdentifier}`), ...FIXTURE_CALLS]);
    const rootDirectory = realpathSync(repositoryDirectory);
    rmSync(installedFilePathsIn(rootDirectory).installManifest);
    const elsewhereDirectory = createScratchDirectory('hook-command-elsewhere');
    try {
      const context = contextWith(hookInput(), elsewhereDirectory);

      expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

      const mismatchParagraph = OperationRefusalWordingUtil.installVersionMismatchMessageOf({
        kind:             'install-version-mismatch',
        rootDirectory,
        manifestFilePath: installedFilePathsIn(rootDirectory).installManifest,
        installVersion:   INSTALL_VERSION,
        mismatch:         { reason: 'unversioned' },
      });
      expect(context.errorText()).toBe(`agent-progress hook subagent-stop: the line could not be recorded in ${repositoryDirectory}: ${mismatchParagraph}`);
      expect(storedLogEntriesOf(repositoryDirectory).map((entry) => entry.text).filter((text) => text.startsWith('Agent '))).toEqual([]);
      expect(storedTokensOf(rowIdentifier)).toBeNull();
      expect(context.outputText()).toBe('');
    } finally {
      removeScratchDirectory(elsewhereDirectory);
    }
  });
});

describeWhenGitIsPresent('the one thing it does refuse', () => {
  test('a missing or misspelled event is refused with exit 1, since only a person typing it can get that wrong', async () => {
    for (const commandLineArguments of [['hook'], ['hook', 'subagent-stopped']]) {
      const context = contextWith(hookInput());

      expect(await runCommandLine(commandLineArguments, context), commandLineArguments.join(' ')).toBe(1);

      expect(context.errorText()).toContain('agent-progress hook takes one event');
      expect(storedLogEntriesOf(repositoryDirectory)).toEqual([]);
    }
  });
});

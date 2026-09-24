/**
 * The one line this command writes, the rows its brief names that it adds the agent's tokens to, and
 * the seven ways it is allowed to write nothing. The failure
 * cases carry the weight: each one asserts **exit 0 and an untouched tracker**. The agent has already
 * finished when this runs, so a non-zero exit prevents nothing; what it does produce is an error the
 * orchestrator has to read and a delay before it hears its agent is done, and both cost more than the
 * log line nobody gets.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { LOCK_RETRY_COUNT, LOCK_RETRY_INTERVAL_MILLISECONDS } from '../../lib/constants/Limits';
import type { ProgressFile }                                  from '../../lib/constants/Types';
import { createCapturedCommandContext }                       from '../../lib/tooling/dev/CapturedCommandContext';
import {
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                                                             from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine } from '../Main';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const TRANSCRIPT_FILE_NAME = 'agent-example.jsonl';

/** The held-lock case waits out the whole retry budget before it is refused, exactly as `lib/platform/Lock.spec.ts` does. */
const HELD_LOCK_TIMEOUT_MILLISECONDS = LOCK_RETRY_COUNT * LOCK_RETRY_INTERVAL_MILLISECONDS * 3;

let repositoryDirectory = '';
let transcriptPath      = '';

function assistantLine(messageIdentifier: string, inputTokens: number, cacheReadTokens: number, outputTokens: number): string {
  return JSON.stringify({
    type:    'assistant',
    message: {
      id:    messageIdentifier,
      usage: { input_tokens: inputTokens, cache_read_input_tokens: cacheReadTokens, output_tokens: outputTokens },
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

function storedProgress(): ProgressFile {
  const progressFilePath = join(repositoryDirectory, '.agent-progress', 'progress.json');
  return JSON.parse(readFileSync(progressFilePath, 'utf8')) as ProgressFile;
}

function storedLog(): ProgressFile['log'] {
  return storedProgress().log;
}

function storedTokensOf(rowIdentifier: number): number | null | undefined {
  return storedProgress().tasks.find((task) => task.id === rowIdentifier)?.tokens;
}

async function addedRow(name: string): Promise<number> {
  expect(await runCommandLine(['task', 'add', name], contextWith(''))).toBe(0);
  const rowIdentifier = storedProgress().tasks.at(-1)?.id;
  if (rowIdentifier === undefined) throw new Error(`task add "${name}" filed no row`);
  return rowIdentifier;
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
  repositoryDirectory = createScratchGitRepository('hook-command');
  const initContext   = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  expect(await runCommandLine(['init', '--project', 'Example Agency'], initContext)).toBe(0);
  transcriptPath = writeTranscript([
    assistantLine('msg_one', 10, 90_000, 400),
    assistantLine('msg_one', 10, 90_000, 1200),
    assistantLine('msg_two', 20, 140_000, 800),
  ]);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('a subagent that stopped', () => {
  test('gets one log line naming it, its calls and what it cost, summed per call and not per line', async () => {
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    const lastEntry = storedLog().at(-1);
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

      expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
    } finally {
      removeScratchDirectory(elsewhere);
    }
  });

  test('an input without an agent id or type still records the cost, under a name that says so', async () => {
    const context = contextWith(hookInput({ agent_id: undefined, agent_type: undefined }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLog().at(-1)?.text).toStartWith('Agent unknown (unknown) stopped: 2 calls');
  });
});

describe.skipIf(!gitIsAvailable())('the row the brief names', () => {
  /** Adding rather than setting is the claim: a row an implementer and a second pass both worked on carries what both cost. */
  test('a brief naming a row takes its tokens from unset to the input total, and the same input again doubles it', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([userLine(`Do the work.\nagent-progress row: ${rowIdentifier}\nStop at 150 calls.`), ...FIXTURE_CALLS]);
    expect(storedTokensOf(rowIdentifier)).toBeNull();

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);
    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedLog().at(-1)?.text).toContain('input 230k');

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);
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
    expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
    expect(context.errorText()).toBe('');
  });

  test('a brief without a marker leaves every row as it was', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([userLine('Do the work.'), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBeNull();
    expect(storedLog().at(-1)?.text).toContain('input 230k');
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
    expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
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
    expect(storedLog().at(-1)?.text).toContain('(workflow-subagent)');
  });
});

/**
 * The ticket form exists because a low ticket has no row until its builder claims it, after the brief
 * is written. So every case files the ticket, writes the brief, and only then creates the row — the
 * claim is resolved when the hook runs, never when the brief was written.
 */
describe.skipIf(!gitIsAvailable())('the tickets the brief names', () => {
  async function filedLowTicket(title: string): Promise<void> {
    expect(await runCommandLine(['ticket', 'add', title, '--priority', 'low'], contextWith(''))).toBe(0);
  }

  async function startedTicket(reference: string): Promise<void> {
    expect(await runCommandLine(['ticket', 'start', reference], contextWith(''))).toBe(0);
  }

  function storedTokensOfTicketRow(ticketIdentifier: string): number | null | undefined {
    return storedProgress().tasks.find((task) => task.ticket === ticketIdentifier)?.tokens;
  }

  test('a ticket given no row until after the brief was written takes the input total on the row it has when the hook runs', async () => {
    await filedLowTicket('Example low work');
    transcriptPath = writeTranscript([userLine('Claim it first.\nagent-progress ticket: 1'), ...FIXTURE_CALLS]);
    expect(storedTokensOfTicketRow('001')).toBeUndefined();
    await startedTicket('1');

    const context = contextWith(hookInput());
    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOfTicketRow('001')).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedLog().at(-1)?.text).toContain('input 230k');
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
    expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
  });

  test('a named ticket the tracker does not hold is skipped in one sentence, and it exits 0', async () => {
    transcriptPath = writeTranscript([userLine('agent-progress ticket: 42'), ...FIXTURE_CALLS]);
    const context  = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(context.errorText().trim()).toBe(
      'agent-progress hook subagent-stop: the brief names ticket #042, which the tracker does not hold, so its share of the tokens was not recorded.',
    );
    expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
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
describe.skipIf(!gitIsAvailable())('a workflow agent\'s brief after the harness\'s relay', () => {
  const BUILT_TICKET_NUMBER = 7;

  const RELAY_TURN = '[Workflow harness — user request] The harness relays, verbatim and indented below, the user request.\n  Run the board.';

  function plainUserLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  }

  function computedTaskLine(indentedTask: string): string {
    return plainUserLine(`[Workflow harness — computed task] The task text below was computed at runtime by a workflow script.\n${indentedTask}`);
  }

  function storedTokensOfBuiltTicketRow(): number | null | undefined {
    return storedProgress().tasks.find((task) => task.ticket === '007')?.tokens;
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

    expect(storedProgress().tasks.every((task) => task.tokens === null)).toBe(true);
    expect(storedLog().at(-1)?.text).toContain('input 230k');
  });

  test('a relay whose later ordinary user message carries a marker records nothing on any row', async () => {
    transcriptPath = writeTranscript([
      plainUserLine(RELAY_TURN),
      assistantLine('msg_one', 10, 90_000, 400),
      plainUserLine(`agent-progress ticket: ${BUILT_TICKET_NUMBER}`),
      assistantLine('msg_two', 20, 140_000, 800),
    ]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedProgress().tasks.every((task) => task.tokens === null)).toBe(true);
    expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
  });
});

/**
 * The review form exists because a reviewer inside a workflow files its own review row, after its brief was written, so the brief can
 * name only the ticket. Every case writes the brief first and files the row after; the row is found when the hook runs, whatever its
 * status, because `release` has already delivered it by the time the reviewer stops.
 */
describe.skipIf(!gitIsAvailable())('the ticket a reviewer\'s brief names', () => {
  const REVIEWED_TICKET_NUMBER = 7;

  beforeEach(async () => {
    for (let i = 1; i <= REVIEWED_TICKET_NUMBER; i++) {
      expect(await runCommandLine(['ticket', 'add', `Example work ${i}`], contextWith(''))).toBe(0);
    }
  });

  async function reviewRowFiled(commandArguments: readonly string[]): Promise<number> {
    expect(await runCommandLine(['task', 'add', ...commandArguments], contextWith(''))).toBe(0);
    const rowIdentifier = storedProgress().tasks.at(-1)?.id;
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

  // A second round files a second row; the reviewer that stops is the one whose row was filed last, linked by field or by name alone.
  test('with two review rows for the ticket, the later one gets it and the earlier is left as it was', async () => {
    const firstRound  = await reviewRowFiled(['Review 1 #007 — Example work 7', '--review-of', '7']);
    transcriptPath    = writeTranscript([userLine('agent-progress review: #007'), ...FIXTURE_CALLS]);
    const secondRound = await reviewRowFiled(['Review 2 #7 — Example work 7']);

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
    expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
  });

  /** The ticket line names the builder's bar; a brief carrying both belongs to the builder, and counting it on the review too would count it twice. */
  test('a brief carrying the ticket line and the review line is read by its ticket line alone', async () => {
    expect(await runCommandLine(['ticket', 'start', '7'], contextWith(''))).toBe(0);
    const reviewRow = await reviewRowFiled(['Review 1 #007 — Example work 7', '--review-of', '7']);
    transcriptPath  = writeTranscript([userLine('agent-progress review: 7\nagent-progress ticket: 7'), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedProgress().tasks.find((task) => task.ticket === '007')?.tokens).toBe(FIXTURE_INPUT_TOKENS);
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

describe.skipIf(!gitIsAvailable())('every way it can fail', () => {
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

      expect(storedLog(), description).toEqual([]);
      expect(context.errorText(), description).toContain('nothing was recorded');
      expect(context.outputText(), description).toBe('');
    }
  });

  test('a transcript that is not there is reported by name and exits 0', async () => {
    const missingPath = join(repositoryDirectory, 'no-such-transcript.jsonl');
    const context     = contextWith(hookInput({ agent_transcript_path: missingPath }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLog()).toEqual([]);
    expect(context.errorText()).toContain(missingPath);
    expect(context.errorText()).toContain('could not be read');
  });

  /** A line of noughts is worse than no line: it reads as a subagent that cost nothing rather than as one nobody measured. */
  test('a transcript holding no API calls records nothing rather than a line of zeroes', async () => {
    const context = contextWith(hookInput({ agent_transcript_path: writeTranscript(['{"type":"user","message":{"content":"do it"}}']) }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLog()).toEqual([]);
    expect(context.errorText()).toContain('holds no API calls');
  });

  /**
   * The only failure that reaches this command as a throw from inside the tracker, and the one a
   * fan-out actually produces: a sibling command is mid-write when the agent stops. An empty `.lock`
   * is a lock nobody finished writing, which `lib/platform/Lock.ts` waits out and then refuses rather
   * than assuming free — so the line is lost, and nothing else is.
   */
  test('a lock the tracker will not give up costs the line only, leaving the log and the lock as they were', async () => {
    const lockFilePath = join(repositoryDirectory, '.agent-progress', '.lock');
    writeFileSync(lockFilePath, '');
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLog()).toEqual([]);
    expect(context.errorText().split('\n'), 'one sentence, not a stack the orchestrator has to read').toHaveLength(1);
    expect(context.errorText()).toContain('could not be recorded');
    expect(context.outputText()).toBe('');
    expect(readFileSync(lockFilePath, 'utf8'), 'the lock it refused to take is left exactly as it was').toBe('');
  }, HELD_LOCK_TIMEOUT_MILLISECONDS);

  test('a cwd with no tracker above it is reported and still exits 0, because a hook failure must never reach the orchestrator', async () => {
    const untrackedDirectory = createScratchDirectory('hook-command-untracked');
    try {
      const context = contextWith(hookInput({ cwd: untrackedDirectory }));

      expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

      expect(storedLog()).toEqual([]);
      expect(context.errorText()).toContain(untrackedDirectory);
      expect(context.errorText()).toContain('could not be recorded');
    } finally {
      removeScratchDirectory(untrackedDirectory);
    }
  });
});

describe.skipIf(!gitIsAvailable())('the one thing it does refuse', () => {
  test('a missing or misspelled event is refused with exit 1, since only a person typing it can get that wrong', async () => {
    for (const commandLineArguments of [['hook'], ['hook', 'subagent-stopped']]) {
      const context = contextWith(hookInput());

      expect(await runCommandLine(commandLineArguments, context), commandLineArguments.join(' ')).toBe(1);

      expect(context.errorText()).toContain('agent-progress hook takes one event');
      expect(storedLog()).toEqual([]);
    }
  });
});

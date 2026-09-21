/**
 * What `agent-progress usage` reports, driven in process against a scratch tracker and a scratch
 * folder of constructed transcripts. The cases that matter are the ones a reader acts on: that the
 * rows are oldest first, that `--since` splits the cohort where it was told to and labels both sides,
 * that the `--json` document carries the folder it read and a cohort for each side, and that a
 * repository with no transcripts is an answer rather than a refusal.
 *
 * `--transcripts` is what makes all of this testable: without it the command would read whatever the
 * developer's own `~/.claude/projects/` happens to hold, and no assertion could be made about it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import type { CohortSummary }                                                 from '../../lib/utils/TranscriptCohortUtil';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-19T20:11:03Z');

/** The instant the constructed cohort is split on: two agents ran before it and one after. */
const BOUNDARY = '2026-09-19T10:00:00Z';

interface UsageDocument {
  transcriptFolder: string;
  agents:           Array<{
    agentIdentifier:             string;
    sessionIdentifier:           string;
    transcriptPath:              string;
    startedAt:                   string | null;
    model:                       string | null;
    apiCallCount:                number;
    totalInputTokens:            number;
    outputTokens:                number;
    endContextTokens:            number;
    oversizedContextTokens:      number;
    browserCallCount:            number;
    bashEditScriptCount:         number;
    verificationRunCount:        number;
    nestedInstructionCharacters: number;
    briefExcerpt:                string;
  }>;
  cohorts: { all: CohortSummary; before?: CohortSummary; after?: CohortSummary };
}

interface ConstructedAgent {
  session:          string;
  agent:            string;
  startedAt:        string;
  brief:            string;
  apiCallCount:     number;
  inputTokens:      number;
  outputTokens:     number;
  browserCallCount: number;
}

let repositoryDirectory = '';
let transcriptsDirectory = '';

const NESTED_INSTRUCTIONS = '# CLAUDE.md\nThe rules of this folder.';

function transcriptTextFor(constructed: ConstructedAgent): string {
  const lines = [JSON.stringify({
    type:      'user',
    timestamp: constructed.startedAt,
    message:   {
      content: [
        { type: 'nested_memory', content: { path: 'lib/CLAUDE.md', content: NESTED_INSTRUCTIONS } },
        { type: 'text', text: constructed.brief },
      ],
    },
  })];

  for (let callIndex = 0; callIndex < constructed.apiCallCount; callIndex++) {
    const browserBlocks = callIndex < constructed.browserCallCount ? [{ type: 'tool_use', name: 'mcp__Claude_Browser__computer' }] : [];
    lines.push(JSON.stringify({
      type:      'assistant',
      timestamp: constructed.startedAt,
      message:   {
        id:      `msg_${callIndex}`,
        model:   'claude-opus-5',
        content: browserBlocks,
        usage:   {
          input_tokens:            constructed.inputTokens,
          cache_read_input_tokens: 0,
          output_tokens:           constructed.outputTokens,
        },
      },
    }));
  }
  return `${lines.join('\n')}\n`;
}

function writeTranscript(constructed: ConstructedAgent): void {
  const subagentsDirectory = join(transcriptsDirectory, constructed.session, 'subagents');
  mkdirSync(subagentsDirectory, { recursive: true });
  writeFileSync(join(subagentsDirectory, `agent-${constructed.agent}.jsonl`), transcriptTextFor(constructed));
}

function contextHere(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

function usageArguments(...extra: readonly string[]): string[] {
  return ['usage', '--transcripts', transcriptsDirectory, ...extra];
}

beforeEach(async () => {
  repositoryDirectory  = createScratchGitRepository('usage-command');
  transcriptsDirectory = join(repositoryDirectory, 'scratch-transcripts');
  await run(['init', '--project', 'Example Agency']);

  writeTranscript({
    session:          'session-one',
    agent:            'alpha',
    startedAt:        '2026-09-19T08:00:00.000Z',
    brief:            'Read the layout module',
    apiCallCount:     10,
    inputTokens:      1_000,
    outputTokens:     100,
    browserCallCount: 0,
  });
  writeTranscript({
    session:          'session-one',
    agent:            'beta',
    startedAt:        '2026-09-19T09:00:00.000Z',
    brief:            'Rename the export button',
    apiCallCount:     30,
    inputTokens:      3_000,
    outputTokens:     300,
    browserCallCount: 2,
  });
  writeTranscript({
    session:          'session-two',
    agent:            'gamma',
    startedAt:        '2026-09-19T11:00:00.000Z',
    brief:            'Add the usage command',
    apiCallCount:     20,
    inputTokens:      2_000,
    outputTokens:     200,
    browserCallCount: 0,
  });
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the report a reader sees', () => {
  // Asserted as the order the briefs appear in rather than as fixed line numbers: the sort is by stamp, where the file order is alphabetical by path.
  test('lists every agent oldest first with its calls and its brief', async () => {
    const printed = (await run(usageArguments())).outputText();
    const lines   = printed.split('\n');

    const briefOrder = ['Read the layout module', 'Rename the export button', 'Add the usage command']
      .map((brief) => lines.findIndex((line) => line.includes(brief)));

    expect(briefOrder.every((index) => index > 0)).toBe(true);
    expect([...briefOrder].sort((a, b) => a - b)).toEqual(briefOrder);
    expect(printed).toContain('started');
    expect(printed).toContain('brief');
  });

  test('ends with a cohort summary naming the median calls and the mean input', async () => {
    const printed = (await run(usageArguments())).outputText();

    expect(printed).toContain('All: 3 agents, median 20 calls');
    // 10 calls of 1k, 30 of 3k and 20 of 2k: 10k, 90k and 40k of input, a mean of 46,667.
    expect(printed).toContain('mean input 46.7k');
  });

  test('--since labels the two sides with the instant it split on', async () => {
    const printed = (await run(usageArguments('--since', BOUNDARY))).outputText();

    expect(printed).toContain('Before ');
    expect(printed).toContain('Since ');
    expect(printed).toContain('2 agents, median 20 calls');
    expect(printed).toContain('1 agent, median 20 calls');
  });

  /** A `--since` nobody can read is a refusal rather than a silent report of the whole cohort, which would answer a question that was not asked. */
  test('a --since that is not a time is refused at exit 1, naming what it would accept', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(usageArguments('--since', 'last tuesday'), context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('--since "last tuesday" is not a time');
    expect(context.outputText()).toBe('');
  });
});

describe.skipIf(!gitIsAvailable())('the --json document', () => {
  test('carries the folder it read, one entry per agent and the cohort', async () => {
    const document = JSON.parse((await run(usageArguments('--json'))).outputText()) as UsageDocument;

    expect(document.transcriptFolder).toBe(transcriptsDirectory);
    expect(document.agents.map((agent) => agent.agentIdentifier)).toEqual(['alpha', 'beta', 'gamma']);
    expect(document.cohorts.all.transcriptCount).toBe(3);
    expect(document.cohorts.before).toBeUndefined();
    expect(document.cohorts.after).toBeUndefined();
  });

  test('each agent carries the fields the row is printed from, in raw counts rather than shortened text', async () => {
    const document = JSON.parse((await run(usageArguments('--json'))).outputText()) as UsageDocument;
    const [, beta] = document.agents;

    expect(beta).toMatchObject({
      sessionIdentifier: 'session-one',
      agentIdentifier:   'beta',
      startedAt:         '2026-09-19T09:00:00.000Z',
      model:             'claude-opus-5',
      apiCallCount:      30,
      browserCallCount:  2,
      briefExcerpt:      'Rename the export button',
    });
    expect(beta?.totalInputTokens).toBe(90_000);
    expect(beta?.outputTokens).toBe(9_000);
    expect(beta?.nestedInstructionCharacters).toBe(NESTED_INSTRUCTIONS.length);
    expect(beta?.transcriptPath).toContain('agent-beta.jsonl');
  });

  test('--since adds a cohort for each side, split where it was told to', async () => {
    const document = JSON.parse((await run(usageArguments('--since', BOUNDARY, '--json'))).outputText()) as UsageDocument;

    expect(document.cohorts.before?.transcriptCount).toBe(2);
    expect(document.cohorts.after?.transcriptCount).toBe(1);
    expect(document.cohorts.all.transcriptCount).toBe(3);
  });
});

/**
 * The three figures that say a brief was breached without anyone opening the transcript: work done at
 * a context the brief capped, files edited by shelling out, and the full checks run per edit. The
 * transcript is written into a folder of its own so the cohort it is the whole of reads 100%.
 */
describe.skipIf(!gitIsAvailable())('the figures a breach of the brief shows up in', () => {
  const OVERSIZED_CACHE_READ_TOKENS = 400_000;

  let breachFolder = '';

  beforeEach(() => {
    breachFolder             = join(repositoryDirectory, 'breach-transcripts');
    const subagentsDirectory = join(breachFolder, 'session-breach', 'subagents');
    mkdirSync(subagentsDirectory, { recursive: true });

    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-09-19T12:00:00.000Z', message: { content: 'Rewrite the layout module' } }),
      JSON.stringify({
        type:    'assistant',
        message: {
          id:      'msg_one',
          model:   'claude-opus-5',
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'cat <<EOF > lib/Thing.ts\nexport const thing = 1;\nEOF' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'sed -i \'\' s/one/two/ lib/Thing.ts' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'bun test && bun run lint' } },
          ],
          usage: { input_tokens: 1_000, cache_read_input_tokens: OVERSIZED_CACHE_READ_TOKENS, output_tokens: 10 },
        },
      }),
    ];
    writeFileSync(join(subagentsDirectory, 'agent-delta.jsonl'), `${lines.join('\n')}\n`);
  });

  test('the row carries the oversized share as a whole percentage, the bash edit scripts and the verification runs', async () => {
    const printed = (await run(['usage', '--transcripts', breachFolder])).outputText();
    const [, row] = printed.split('\n');

    expect(printed).toContain('over 200k');
    expect(printed).toContain('bash edits');
    expect(printed).toContain('checks');
    expect(row).toContain('100%');
    expect(row?.includes('Rewrite the layout module')).toBe(true);
  });

  test('the cohort line reports the mean of each figure beside the ones it already had', async () => {
    const printed = (await run(['usage', '--transcripts', breachFolder])).outputText();

    expect(printed).toContain('mean 100% over 200k context');
    expect(printed).toContain('mean 2.0 bash edit scripts');
    expect(printed).toContain('mean 1.0 verification runs');
  });

  test('--json carries the oversized figure as a raw token count rather than as the share the table shows', async () => {
    const document  = JSON.parse((await run(['usage', '--transcripts', breachFolder, '--json'])).outputText()) as UsageDocument;
    const [delta]   = document.agents;

    expect(delta?.oversizedContextTokens).toBe(OVERSIZED_CACHE_READ_TOKENS + 1_000);
    expect(delta?.bashEditScriptCount).toBe(2);
    expect(delta?.verificationRunCount).toBe(1);
  });

  /** An agent that edited through the editing tools and batched its checks reads as clean rather than as unmeasured. */
  test('an agent that shelled out for nothing reports zero of all three', async () => {
    const document = JSON.parse((await run(usageArguments('--json'))).outputText()) as UsageDocument;

    expect(document.agents.map((agent) => agent.bashEditScriptCount)).toEqual([0, 0, 0]);
    expect(document.agents.map((agent) => agent.verificationRunCount)).toEqual([0, 0, 0]);
    expect(document.agents.map((agent) => agent.oversizedContextTokens)).toEqual([0, 0, 0]);
  });
});

describe.skipIf(!gitIsAvailable())('a folder with no subagent transcripts in it', () => {
  /** A repository that has never delegated anything is not a state the tool should complain about, so this is exit 0 and one sentence. */
  test('is one sentence at exit 0, naming the folder that was read', async () => {
    const emptyFolder = join(repositoryDirectory, 'no-transcripts-here');
    mkdirSync(emptyFolder, { recursive: true });

    const printed = (await run(['usage', '--transcripts', emptyFolder])).outputText();

    expect(printed).toContain('No subagent transcripts were found');
    expect(printed).toContain(emptyFolder);
  });

  test('--json still answers a document, with no agents and an empty cohort', async () => {
    const missingFolder = join(repositoryDirectory, 'never-created');

    const document = JSON.parse((await run(['usage', '--transcripts', missingFolder, '--json'])).outputText()) as UsageDocument;

    expect(document.agents).toEqual([]);
    expect(document.cohorts.all.transcriptCount).toBe(0);
    expect(document.transcriptFolder).toBe(missingFolder);
  });
});

describe.skipIf(!gitIsAvailable())('what the command does not do', () => {
  test('it is refused outside a tracker, like every other command', async () => {
    const outsideDirectory = createScratchGitRepository('usage-untracked');
    const context = createCapturedCommandContext({ currentDirectory: outsideDirectory, now: () => FROZEN_NOW });

    const exitCode = await runCommandLine(['usage', '--transcripts', transcriptsDirectory], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('agent-progress init');
    removeScratchDirectory(outsideDirectory);
  });

  test('an unknown option is refused rather than ignored', async () => {
    const context  = contextHere();
    const exitCode = await runCommandLine(['usage', '--sine', BOUNDARY], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('--sine');
  });
});

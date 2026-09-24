/**
 * The Next line each of the eight commands an orchestrator runs between dispatches ends its human output
 * with, driven in process against one scratch tracker per case. What matters is that the line describes the
 * board after the move rather than before it — a claim that fills the last slot says so — and that no
 * `--json` document carries it, since a script parses that output whole. The wordings themselves are
 * pinned in `lib/utils/NextLineUtil.spec.ts`.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { createCapturedCommandContext }                                       from '../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from './Main';

const FROZEN_NOW = new Date('2026-09-23T10:00:00Z');

interface NextLineCase {
  command:          string[];
  setup:            string[][];
  expectedNextLine: string;
}

/**
 * Each case starts from three open tickets (rows #1 to #3) and a free-standing row #4 under the default
 * limit of 2, with the dispatcher running. The expected line is written out from that state by hand, never taken from a run.
 */
const NEXT_LINE_CASES: NextLineCase[] = [
  {
    command:          ['status'],
    setup:            [],
    expectedNextLine: 'Next: 2 of 2 slots free; ready: #001, #002, #003',
  },
  {
    command:          ['ticket', 'add', 'Import the roles'],
    setup:            [],
    expectedNextLine: 'Next: 2 of 2 slots free; ready: #001, #002, #003, #004',
  },
  {
    command:          ['ticket', 'claim', '1'],
    setup:            [['task', 'start', '4']],
    expectedNextLine: 'Next: no slot free (2 agents in flight); ready: #002, #003',
  },
  {
    command:          ['ticket', 'review', '1'],
    setup:            [['ticket', 'claim', '1']],
    expectedNextLine: 'Next: 2 of 2 slots free; ready: #002, #003',
  },
  {
    command:          ['ticket', 'deliver', '1'],
    setup:            [['ticket', 'claim', '1'], ['ticket', 'review', '1'], ['ticket', 'done', '1']],
    expectedNextLine: 'Next: 2 of 2 slots free; ready: #002, #003',
  },
  {
    command:          ['ticket', 'abandon', '2', '--reason', 'superseded by #3'],
    setup:            [],
    expectedNextLine: 'Next: 2 of 2 slots free; ready: #001, #003',
  },
  {
    command:          ['task', 'finish', '4'],
    setup:            [['task', 'start', '4'], ['ticket', 'claim', '3']],
    expectedNextLine: 'Next: 1 of 2 slots free; ready: #001, #002',
  },
  // Delivered straight from running, so the move frees a slot and a line read before it would differ.
  {
    command:          ['task', 'deliver', '4'],
    setup:            [['task', 'start', '4']],
    expectedNextLine: 'Next: 2 of 2 slots free; ready: #001, #002, #003',
  },
];

let repositoryDirectory = '';

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

async function runSetup(setup: readonly string[][]): Promise<void> {
  for (const commandLineArguments of setup) await run(commandLineArguments);
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('next-line');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Double-click a role to edit it']);
  await run(['ticket', 'add', 'Show the role history']);
  await run(['ticket', 'add', 'Export the roles']);
  await run(['task', 'add', 'Review pass']);
  // A running dispatcher adds no advice, so these lines pin slots and queue alone; `cli/dispatcher/DispatcherCommand.spec.ts` pins the advice.
  await run(['dispatcher', 'running']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the line the human output ends with', () => {
  test('every case names a different command, so the table covers all eight', () => {
    expect(new Set(NEXT_LINE_CASES.map((nextLineCase) => nextLineCase.command.slice(0, 2).join(' '))).size).toBe(8);
  });

  for (const nextLineCase of NEXT_LINE_CASES) {
    test(`\`${nextLineCase.command.join(' ')}\` ends with the board as the move left it`, async () => {
      await runSetup(nextLineCase.setup);

      // `ticket add` follows it with the running dispatcher notice, pinned in `cli/ticket/TicketCommand.dispatcher.spec.ts`.
      const lines = (await run(nextLineCase.command)).outputText().split('\n').filter((line) => !line.startsWith('Dispatcher running:'));

      expect(lines.at(-1)).toBe(nextLineCase.expectedNextLine);
      expect(lines.filter((line) => line.startsWith('Next:'))).toHaveLength(1);
    });
  }
});

describe.skipIf(!gitIsAvailable())('the --json output', () => {
  for (const nextLineCase of NEXT_LINE_CASES) {
    test(`\`${nextLineCase.command.join(' ')} --json\` is one parseable document with no Next line in it`, async () => {
      await runSetup(nextLineCase.setup);

      const printed = (await run([...nextLineCase.command, '--json'])).outputText();

      expect(() => JSON.parse(printed) as unknown).not.toThrow();
      expect(printed).not.toContain('Next:');
    });
  }
});

/**
 * The notice the five intake moves end on while a dispatcher runs: filing, reprioritising, re-agenting, re-ordering or reopening a ticket
 * is picked up by the running dispatcher at its next agent's return, and an orchestrator that stopped the run to add work lost the agents
 * in flight. What matters is that the line is there exactly while the state is `running`, and that no `--json` document ever carries it.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import type { DispatcherState }                                               from '../../lib/constants/Types';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-24T12:00:00Z');

// Written out by hand, not imported, so a reworded notice fails here as well as in `lib/utils/NextLineUtil.spec.ts`.
const RUNNING_DISPATCHER_NOTICE = 'Dispatcher running: it picks this change up at its next agent\'s return. Never stop or relaunch it for this.';

const STATES_WITHOUT_THE_NOTICE: readonly DispatcherState[] = ['finished', 'stopped'];

interface IntakeCase {
  command: string[];
  setup:   string[][];
}

/** Each case starts from two open tickets, #001 and #002. */
const INTAKE_CASES: IntakeCase[] = [
  { command: ['ticket', 'add', 'Import the roles'], setup: [] },
  { command: ['ticket', 'priority', '1', 'high'], setup: [] },
  { command: ['ticket', 'agent', '1', '--model', 'sonnet'], setup: [] },
  { command: ['ticket', 'depends', '2', '1'], setup: [] },
  { command: ['ticket', 'reopen', '1'], setup: [['ticket', 'abandon', '1', '--reason', 'superseded by #2']] },
];

let repositoryDirectory = '';

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

async function runCaseWithTheDispatcher(intakeCase: IntakeCase, dispatcherState: DispatcherState, extraArguments: readonly string[] = []): Promise<string> {
  for (const commandLineArguments of intakeCase.setup) await run(commandLineArguments);
  await run(['dispatcher', dispatcherState]);
  return (await run([...intakeCase.command, ...extraArguments])).outputText();
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('running-dispatcher-notice');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Double-click a role to edit it']);
  await run(['ticket', 'add', 'Show the role history']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the running dispatcher notice', () => {
  test('every case names a different subcommand, so the table covers all five', () => {
    expect(new Set(INTAKE_CASES.map((intakeCase) => intakeCase.command[1])).size).toBe(5);
  });

  for (const intakeCase of INTAKE_CASES) {
    const commandText = intakeCase.command.join(' ');

    test(`\`${commandText}\` ends with the notice, once, after the Next line while the dispatcher is running`, async () => {
      const lines = (await runCaseWithTheDispatcher(intakeCase, 'running')).split('\n');

      expect(lines.at(-1)).toBe(RUNNING_DISPATCHER_NOTICE);
      expect(lines.filter((line) => line === RUNNING_DISPATCHER_NOTICE)).toHaveLength(1);
    });

    for (const dispatcherState of STATES_WITHOUT_THE_NOTICE) {
      test(`\`${commandText}\` prints no notice while the dispatcher is ${dispatcherState}`, async () => {
        const printed = await runCaseWithTheDispatcher(intakeCase, dispatcherState);

        expect(printed).not.toContain('Dispatcher running');
      });
    }

    // A script parses the document whole, so a trailing sentence would break it.
    test(`\`${commandText} --json\` carries no notice while the dispatcher is running`, async () => {
      const printed = await runCaseWithTheDispatcher(intakeCase, 'running', ['--json']);

      expect(() => JSON.parse(printed) as unknown).not.toThrow();
      expect(printed).not.toContain('Dispatcher running');
    });
  }

  // Claiming is the dispatcher's own move, not intake, so the notice would tell its builder to leave alone the run it belongs to.
  test('`ticket claim` prints no notice while the dispatcher is running', async () => {
    await run(['dispatcher', 'running']);

    const lines = (await run(['ticket', 'claim', '1'])).outputText().split('\n');

    expect(lines.at(-1)).toStartWith('Next:');
    expect(lines).not.toContain(RUNNING_DISPATCHER_NOTICE);
  });
});

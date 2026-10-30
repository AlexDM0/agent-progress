/**
 * The Workflow dispatcher, its hook verbs and the by-hand lifecycle verbs are retired: the runner makes those moves now (owner answer Q41).
 * What matters is that each is refused at exit 1 as unknown, writing nothing, on a tracked repository where the verb would otherwise have
 * had a ticket to act on; `ticket deliver --by-hand`, the one record-only lifecycle verb kept, still delivers.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import {
  afterAll,
  beforeAll,
  expect,
  test
}                                             from 'bun:test';
import { PRODUCT_NAMES }                      from '../src/shared/constants/ProductNames.ts';
import { removeScratchDirectory }             from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../src/testing/ToolGuard.ts';
import { runCommandLine }                     from './Main.ts';
import { createCapturedCommandContext }       from './testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from './testing/InitializedScratchRepository.ts';
import { fileReadyTicket }                    from './testing/ReadyTicketFiling.ts';

const FROZEN_NOW = new Date('2026-10-29T12:00:00Z');

const RETIRED_COMMAND_LINES: readonly (readonly string[])[] = [
  ['dispatcher'],
  ['dispatcher', 'running'],
  ['dispatcher', 'running', '--run', 'wf_example-run'],
  ['dispatcher', 'stopped'],
  ['dispatcher', 'finished'],
  ['release', '1', '--branch', 'ticket-001'],
  ['review', 'record', '1', '--worktree', '.', '--since', 'HEAD', '--findings-file', '-'],
  ['rework', '--since', 'HEAD'],
];

const RETIRED_TICKET_LINES: readonly (readonly string[])[] = [
  ['ticket', 'claim', '1'],
  ['ticket', 'start', '1'],
  ['ticket', 'finish', '1'],
  ['ticket', 'approve', '1'],
  ['ticket', 'deliver', '1'],
];

const RETIRED_HOOK_EVENTS = ['subagent-stop', 'pre-tool-use', 'post-tool-use'];

let repositoryDirectory = '';

async function runHere(commandLineArguments: readonly string[]): Promise<{ exitCode: number; errorText: string }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, errorText: context.errorText() };
}

function storedTrackerText(): string {
  const dataFolder = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER);
  return ['progress.json', 'log.jsonl'].map((fileName) => readFileSync(join(dataFolder, fileName), 'utf8')).join('\n');
}

beforeAll(async () => {
  repositoryDirectory = await createInitializedScratchRepository('retired-verbs', ['--project', 'Example Agency'], () => FROZEN_NOW);
  await fileReadyTicket(async (commandLineArguments) => {
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
    expect(await runCommandLine(commandLineArguments, context), context.errorText()).toBe(0);
    return context;
  }, ['ticket', 'add', '--type', 'ticket', 'Example checkout flow']);
});

afterAll(() => {
  if (repositoryDirectory !== '') removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the retired verbs', () => {
  test('dispatcher, release, review record and rework are unknown commands, refused at exit 1 with nothing written', async () => {
    const before = storedTrackerText();
    for (const commandLine of RETIRED_COMMAND_LINES) {
      const { exitCode, errorText } = await runHere(commandLine);
      expect(exitCode, commandLine.join(' ')).toBe(1);
      expect(errorText, commandLine.join(' ')).toStartWith(`Unknown command: "${commandLine[0] ?? ''}".`);
    }
    expect(storedTrackerText()).toBe(before);
  });

  test('ticket claim, start, finish, approve and a bare deliver are not ticket subcommands, and the ticket stays pending', async () => {
    const before = storedTrackerText();
    for (const commandLine of RETIRED_TICKET_LINES) {
      const { exitCode, errorText } = await runHere(commandLine);
      expect(exitCode, commandLine.join(' ')).toBe(1);
      expect(errorText, commandLine.join(' ')).toContain(`is not a ${PRODUCT_NAMES.PROGRAM} ticket subcommand.`);
    }
    expect(storedTrackerText()).toBe(before);
  });

  test('the measurement hook events are refused at exit 1 as events the hook does not take', async () => {
    for (const event of RETIRED_HOOK_EVENTS) {
      const { exitCode, errorText } = await runHere(['hook', event]);
      expect(exitCode, event).toBe(1);
      expect(errorText, event).toContain(`${PRODUCT_NAMES.PROGRAM} hook takes one event and was given "${event}".`);
    }
  });

  test('ticket deliver --by-hand, the one record-only lifecycle verb kept, still delivers', async () => {
    expect((await runHere(['ticket', 'deliver', '1', '--by-hand'])).exitCode).toBe(0);
    expect(storedTrackerText()).toContain('"status": "delivered"');
  });
});

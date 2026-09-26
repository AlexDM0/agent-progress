/**
 * The ticket command's seams to the retired verbs and status words, seen from the current side: every verb of the subcommand groups reaches
 * its own handler, and every current status is taken by `ticket status` and `ticket list --status`, so none is ever answered as a retired word
 * or an unknown one. It imports nothing from `cli/legacy/`, so it still holds once that folder and its seam lines are dropped.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { TICKET_STATUSES }                                                    from '../../src/lib/tracker-model/constants/Statuses';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../src/testing/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';
import { createCapturedCommandContext }                                       from '../testing/CapturedCommandContext';
import { TICKET_CLAIM_SUBCOMMANDS }                                           from './TicketClaims';
import { TICKET_FILING_SUBCOMMANDS }                                          from './TicketFiling';
import { TICKET_MOVE_SUBCOMMANDS }                                            from './TicketMoves';
import { TICKET_READING_SUBCOMMANDS }                                         from './TicketReading';
import { TICKET_SETTING_SUBCOMMANDS }                                         from './TicketSettings';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const RETIRED_OR_UNKNOWN_WORD_ANSWER_PATTERN = /was renamed|old name|is not an agent-progress ticket subcommand|is not a ticket status/;

let repositoryDirectory = '';

async function exitCodeAndContextOf(commandLineArguments: readonly string[]): Promise<[number, ReturnType<typeof createCapturedCommandContext>]> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(context.errorText(), commandLineArguments.join(' ')).not.toMatch(RETIRED_OR_UNKNOWN_WORD_ANSWER_PATTERN);
  return [exitCode, context];
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const [exitCode, context] = await exitCodeAndContextOf(commandLineArguments);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('ticket-command-legacy-seam');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', 'Double-click a role to edit it']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('the ticket command with current words only', () => {
  test('every verb of the subcommand groups reaches its own handler, never the retired or unknown refusal', async () => {
    const currentVerbs = Object.keys({
      ...TICKET_FILING_SUBCOMMANDS,
      ...TICKET_READING_SUBCOMMANDS,
      ...TICKET_MOVE_SUBCOMMANDS,
      ...TICKET_CLAIM_SUBCOMMANDS,
      ...TICKET_SETTING_SUBCOMMANDS,
    });
    expect(currentVerbs.length).toBeGreaterThan(0);

    for (const verb of currentVerbs) {
      const [exitCode] = await exitCodeAndContextOf(['ticket', verb]);
      expect([0, 1], `ticket ${verb}`).toContain(exitCode);
    }
  });

  test('every current status is taken by ticket status and stored as written', async () => {
    // A filed ticket is already pending, and a move to the status it holds is refused, so pending comes last; abandoning needs a reason.
    for (const status of [...TICKET_STATUSES.slice(1), ...TICKET_STATUSES.slice(0, 1)]) {
      await run(['ticket', 'status', '1', status, '--reason', 'Example reason']);
      const shown = await run(['ticket', 'show', '1', '--json']);
      expect((JSON.parse(shown.outputText()) as { status: string }).status, status).toBe(status);
    }
  });

  test('every current status is taken by ticket list --status', async () => {
    for (const status of TICKET_STATUSES) {
      await run(['ticket', 'list', '--status', status]);
    }
  });
});

/**
 * The refusals of the verbs and status words the rename retired, pinned against their contract: each retired word is refused with its exact
 * text naming the word that replaced it, since an agent briefed before the rename reads it to retry, and every current verb and status word,
 * and a name every object inherits, returns so the caller goes on as it would without this module. The texts are frozen from
 * `cli/tracking/task/TaskCommand.ts`, `cli/tickets/TicketMoves.ts` and `cli/tickets/utils/TicketArgumentUtil.ts` at 8e0f74a; retake them with
 * `git show 8e0f74a:<path>`.
 */
import { describe, expect, test } from 'bun:test';

import { TASK_STATUSES, TICKET_STATUSES }                   from '../../../src/lib/tracker-model/constants/Statuses.ts';
import { refusalIsOperationRefusal, type OperationRefusal } from '../../../src/shared/OperationRefusal.ts';
import { createArgumentParser }                             from '../../arguments/ArgumentParser.ts';
import { TICKET_CLAIM_SUBCOMMANDS }                         from '../../tickets/TicketClaims.ts';
import { TICKET_FILING_SUBCOMMANDS }                        from '../../tickets/TicketFiling.ts';
import { TICKET_MOVE_SUBCOMMANDS }                          from '../../tickets/TicketMoves.ts';
import { TICKET_READING_SUBCOMMANDS }                       from '../../tickets/TicketReading.ts';
import { TICKET_SETTING_SUBCOMMANDS }                       from '../../tickets/TicketSettings.ts';
import { RetiredWordRefusalUtil }                           from './RetiredWordRefusalUtil.ts';

const {
  refuseARetiredTaskVerb,
  refuseARetiredTicketVerb,
  refuseARetiredTaskStatus,
  refuseARetiredTicketStatus,
} = RetiredWordRefusalUtil;

const CURRENT_TASK_VERBS = ['add', 'start', 'pause', 'finish', 'approve', 'rereview', 'deliver', 'update', 'remove'];

const CURRENT_TICKET_VERBS = Object.keys({
  ...TICKET_FILING_SUBCOMMANDS,
  ...TICKET_READING_SUBCOMMANDS,
  ...TICKET_MOVE_SUBCOMMANDS,
  ...TICKET_CLAIM_SUBCOMMANDS,
  ...TICKET_SETTING_SUBCOMMANDS,
});

const INHERITED_NAMES = ['constructor', '__proto__', 'toString'];

function refusalFrom(action: () => unknown): OperationRefusal {
  try {
    action();
  } catch (error) {
    if (refusalIsOperationRefusal(error)) return error;
    throw error;
  }
  throw new Error('the call was expected to refuse and it returned instead');
}

describe('RetiredWordRefusalUtil verbs', () => {
  test.each([
    [
      ['review', '1'],
      '`agent-progress task review` was renamed: `agent-progress task approve 1` moves a row to reviewed. Nothing was written.',
    ],
    [
      ['review'],
      '`agent-progress task review` was renamed: `agent-progress task approve <id>` moves a row to reviewed. Nothing was written.',
    ],
  ])('the retired task verb in `task %p` is refused naming the verb that replaced it', (commandLineArguments, expectedMessage) => {
    const refusal = refusalFrom(() => refuseARetiredTaskVerb('review', createArgumentParser(commandLineArguments)));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe(expectedMessage);
  });

  test.each([
    [
      ['review', '1', '--start-review'],
      '`agent-progress ticket review` was renamed: `agent-progress ticket finish 1` moves a ticket to in-review, and takes --start-review the same way. '
      + 'Nothing was written.',
    ],
    [
      ['review'],
      '`agent-progress ticket review` was renamed: `agent-progress ticket finish <id>` moves a ticket to in-review, and takes --start-review the same way. '
      + 'Nothing was written.',
    ],
    [
      ['done', '1'],
      '`agent-progress ticket done` was renamed: `agent-progress ticket approve 1` moves a ticket to reviewed. Nothing was written.',
    ],
  ])('the retired ticket verb in `ticket %p` is refused naming the verb that replaced it', (commandLineArguments, expectedMessage) => {
    const [subcommand = ''] = commandLineArguments;
    const refusal           = refusalFrom(() => refuseARetiredTicketVerb(subcommand, createArgumentParser(commandLineArguments)));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe(expectedMessage);
  });

  test('every current task verb, and a name every object inherits, returns without refusing', () => {
    for (const subcommand of [...CURRENT_TASK_VERBS, ...INHERITED_NAMES]) {
      expect(() => refuseARetiredTaskVerb(subcommand, createArgumentParser([subcommand, '1'])), subcommand).not.toThrow();
    }
  });

  test('every current ticket verb, and a name every object inherits, returns without refusing', () => {
    expect(CURRENT_TICKET_VERBS.length).toBeGreaterThan(0);
    for (const subcommand of [...CURRENT_TICKET_VERBS, ...INHERITED_NAMES]) {
      expect(() => refuseARetiredTicketVerb(subcommand, createArgumentParser([subcommand, '1'])), subcommand).not.toThrow();
    }
  });
});

describe('RetiredWordRefusalUtil status words', () => {
  test.each([
    ['running', '"running" is the old name of the task status in-progress; pass --status in-progress.'],
    ['finished', '"finished" is the old name of the task status in-review; pass --status in-review.'],
  ])('the retired task status %p is refused naming the status that replaced it', (writtenStatus, expectedMessage) => {
    const refusal = refusalFrom(() => refuseARetiredTaskStatus(writtenStatus));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe(expectedMessage);
  });

  test('a retired status word is refused naming the word that replaced it, with the caller\'s retry advice', () => {
    const refusal = refusalFrom(() => refuseARetiredTicketStatus('done', (renamedStatus) => `pass --status ${renamedStatus}`));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe('"done" is the old name of the ticket status reviewed; pass --status reviewed.');
  });

  test('the retired ticket status open is refused naming pending, with the caller\'s retry advice', () => {
    const refusal = refusalFrom(() => refuseARetiredTicketStatus('open', (renamedStatus) => `run \`agent-progress ticket status 1 ${renamedStatus}\``));

    expect(refusal.status).toBe('refused');
    expect(refusal.message).toBe('"open" is the old name of the ticket status pending; run `agent-progress ticket status 1 pending`.');
  });

  test('every current task status, a retired ticket word and a name every object inherits return without refusing', () => {
    for (const writtenStatus of [...TASK_STATUSES, 'open', 'done', ...INHERITED_NAMES]) {
      expect(() => refuseARetiredTaskStatus(writtenStatus), writtenStatus).not.toThrow();
    }
  });

  test('every current ticket status, a retired task word and a name every object inherits return without refusing', () => {
    for (const writtenStatus of [...TICKET_STATUSES, 'running', 'finished', ...INHERITED_NAMES]) {
      expect(() => refuseARetiredTicketStatus(writtenStatus, () => 'unused advice'), writtenStatus).not.toThrow();
    }
  });
});

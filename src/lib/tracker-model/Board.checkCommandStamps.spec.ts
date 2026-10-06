/**
 * A release holds a ticket's row to the check command it started under, so every move into in-progress must stamp the stored command (and
 * write no key with none stored), and a change of the command while tickets are in flight must either be refused, writing nothing, or
 * restamp every in-progress and in-review row in the same change.
 */
import { describe, expect, test } from 'bun:test';

import {
  boardFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures.ts';

const CHANGED_AT = '2026-10-06T18:00:00+02:00';

const OLD_COMMAND = 'bun run example-checks';

const NEW_COMMAND = 'bun run example-checks && bun run example-lint';

function boardWithTicketsInFlight() {
  const fixture = boardFixture({
    tasks: [
      taskFixture({
        id: 1, status: 'in-progress', ticket: '001', checkCommand: OLD_COMMAND
      }),
      taskFixture({
        id: 2, status: 'in-review', ticket: '002', checkCommand: OLD_COMMAND
      }),
      taskFixture({ id: 3, status: 'pending', ticket: '003' }),
    ],
    tickets: [
      ticketFixture({ id: '001', status: 'in-progress', task: 1 }),
      ticketFixture({ id: '002', status: 'in-review', task: 2 }),
      ticketFixture({ id: '003', status: 'pending', task: 3 }),
    ],
  });
  fixture.progress.checkCommand = OLD_COMMAND;
  return fixture;
}

describe('a ticket moving into in-progress', () => {
  test('ticket start and ticket claim stamp the stored command on the row', () => {
    const { board, progress } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })] });
    board.setCheckCommand(OLD_COMMAND, false, CHANGED_AT);

    board.moveTicket('001', 'in-progress', { checksLegality: true }, CHANGED_AT);
    board.claimTickets(['002'], {}, CHANGED_AT);

    expect(progress.tasks.map((task) => [task.ticket, task.checkCommand])).toEqual([['001', OLD_COMMAND], ['002', OLD_COMMAND]]);
  });

  test('with no command stored writes no key, and drops a stamp a row kept from an earlier start', () => {
    const { board, progress } = boardFixture({
      tasks: [taskFixture({
        id: 1, status: 'in-review', ticket: '001', checkCommand: OLD_COMMAND
      })],
      tickets: [ticketFixture({ id: '001', status: 'in-review', task: 1 }), ticketFixture({ id: '002' })],
    });

    board.moveTicket('002', 'in-progress', { checksLegality: true }, CHANGED_AT);
    board.claimTickets(['001'], {}, CHANGED_AT);

    expect(progress.tasks.every((task) => !('checkCommand' in task))).toBe(true);
  });

  test('another move leaves the stamp as it was', () => {
    const { board, progress } = boardWithTicketsInFlight();
    progress.checkCommand     = NEW_COMMAND;

    board.moveTicket('001', 'in-review', { checksLegality: true }, CHANGED_AT);

    expect(progress.tasks[0]?.checkCommand).toBe(OLD_COMMAND);
  });
});

describe('changing the command with tickets in flight', () => {
  test('is refused without restamping, naming every ticket whose stamp would differ, and writes nothing', () => {
    const { board, progress, records } = boardWithTicketsInFlight();

    const refusal = { reason: 'check-command-change-with-tickets-in-flight', ticketIds: ['001', '002'] } as const;
    expect(refusalDetailOf(() => board.setCheckCommand(NEW_COMMAND, false, CHANGED_AT))).toEqual(refusal);
    expect(refusalDetailOf(() => board.setCheckCommand(null, false, CHANGED_AT))).toEqual(refusal);
    expect(progress.checkCommand).toBe(OLD_COMMAND);
    expect(records).toEqual([]);
  });

  test('setting the command every stamp already holds is no change and passes', () => {
    const { board } = boardWithTicketsInFlight();
    expect(board.setCheckCommand(OLD_COMMAND, false, CHANGED_AT).restampedTicketIds).toEqual([]);
  });

  test('restamping stamps every in-progress and in-review row, and logs the change and each restamp', () => {
    const { board, progress, records } = boardWithTicketsInFlight();

    const changed = board.setCheckCommand(NEW_COMMAND, true, CHANGED_AT);

    expect(changed.restampedTicketIds).toEqual(['001', '002']);
    expect(progress.tasks.map((task) => task.checkCommand)).toEqual([NEW_COMMAND, NEW_COMMAND, undefined]);
    expect(records.map((record) => record.kind)).toEqual(['check-command-set', 'ticket-check-command-restamped', 'ticket-check-command-restamped']);
  });

  test('clearing with a restamp removes every in-flight stamp', () => {
    const { board, progress } = boardWithTicketsInFlight();

    board.setCheckCommand(null, true, CHANGED_AT);

    expect(progress.tasks.some((task) => 'checkCommand' in task)).toBe(false);
  });
});

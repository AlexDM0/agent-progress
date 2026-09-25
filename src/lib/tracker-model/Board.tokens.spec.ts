/**
 * The Board's token crediting, which the `SubagentStop` hook makes. What it relies on: a share adds to what a row already holds, an
 * unset count counting as 0; a ticket's share lands on the row the ticket has when the hook runs; a share that cannot land is a verdict
 * that costs only that share, never a throw, because the agent has already stopped; and the usage is logged once, after the credits.
 */
import { expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures';
import type { AgentUsage }                          from './@types/LogRecord';
import type { Task }                                from './@types/Task';
import { Board }                                    from './Board';
import { createLogger }                             from './Logger';

const STOPPED_AT = '2026-09-18T16:20:00+02:00';

const EXAMPLE_USAGE: AgentUsage = {
  agentId:              'agent_example',
  agentType:            'general-purpose',
  apiCallCount:         3,
  endContextTokens:     40_000,
  totalInputTokens:     1_001,
  cacheReadInputTokens: 800,
  outputTokens:         50,
};

test('a share takes a row from unset to its tokens, and the same share again doubles them', () => {
  const { board, progress } = boardFixture({ tasks: [taskFixture({ id: 3 })] });

  board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'row', taskId: 3, tokens: 1_001 }], STOPPED_AT);
  expect(progress.tasks[0]?.tokens).toBe(1_001);

  board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'row', taskId: 3, tokens: 1_001 }], STOPPED_AT);
  expect(progress.tasks[0]?.tokens).toBe(2_002);
});

test('a share adds to the tokens other agents already recorded on the row', () => {
  const { board, progress } = boardFixture({ tasks: [taskFixture({ id: 3, tokens: 500 })] });

  const { outcomes } = board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'row', taskId: 3, tokens: 1_001 }], STOPPED_AT);

  expect(outcomes).toEqual([{ verdict: 'credited', taskId: 3 }]);
  expect(progress.tasks[0]?.tokens).toBe(1_501);
});

// A low ticket has no row until its builder claims it, after the brief was written, so the row is looked up when the hook runs.
test('a ticket\'s share lands on the row the ticket has now', () => {
  const { board, progress } = boardFixture({
    tasks:   [taskFixture({ id: 7, name: '#002 Example basket badge', ticket: '002' })],
    tickets: [ticketFixture({ id: '002', title: 'Example basket badge', task: 7 })],
  });

  const { outcomes } = board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'ticket', ticketId: '002', tokens: 700 }], STOPPED_AT);

  expect(outcomes).toEqual([{ verdict: 'credited', taskId: 7 }]);
  expect(progress.tasks[0]?.tokens).toBe(700);
});

// A share that cannot land is lost rather than moved onto a neighbour, and it must never cost the other shares theirs.
test('each share that cannot land is a verdict of its own, credits nothing else and lets the other credits land', () => {
  const { board, progress } = boardFixture({
    tasks: [
      taskFixture({ id: 1, name: 'Example free-standing task' }),
      taskFixture({ id: 2, name: '#001 Example checkout page', ticket: '001' }),
    ],
    tickets: [
      ticketFixture({ id: '001', status: 'in-progress', task: 2 }),
      ticketFixture({ id: '002', title: 'Example basket badge', priority: 'low' }),
      ticketFixture({ id: '003', title: 'Example order history', task: 9 }),
    ],
  });
  const tasksBefore = structuredClone(progress.tasks);

  const { outcomes } = board.recordAgentStop(EXAMPLE_USAGE, [
    { target: 'row', taskId: 900, tokens: 100 },
    { target: 'ticket', ticketId: '042', tokens: 200 },
    { target: 'ticket', ticketId: '002', tokens: 300 },
    { target: 'ticket', ticketId: '003', tokens: 400 },
    { target: 'row', taskId: 1, tokens: 500 },
    { target: 'ticket', ticketId: '001', tokens: 600 },
  ], STOPPED_AT);

  expect(outcomes).toEqual([
    { verdict: 'unknown-row', taskId: 900 },
    { verdict: 'unknown-ticket', ticketId: '042' },
    { verdict: 'ticket-without-row', ticketId: '002' },
    { verdict: 'ticket-row-missing', ticketId: '003', taskId: 9 },
    { verdict: 'credited', taskId: 1 },
    { verdict: 'credited', taskId: 2 },
  ]);
  expect(progress.tasks.map((task) => task.tokens)).toEqual([500, 600]);
  expect(progress.tasks.map((task): Task => ({ ...task, tokens: null }))).toEqual(tasksBefore);
});

test('no share at all still logs the usage', () => {
  const { board, progress, records } = boardFixture({ tasks: [taskFixture({ id: 1 })] });

  const { outcomes, logged } = board.recordAgentStop(EXAMPLE_USAGE, [], STOPPED_AT);

  expect(outcomes).toEqual([]);
  expect(progress.tasks[0]?.tokens).toBeNull();
  expect(logged).toEqual([{ at: STOPPED_AT, kind: 'agent-stopped', fields: EXAMPLE_USAGE }]);
  expect(records).toEqual([...logged]);
});

// The usage line follows the credits in the log, so the sink must see the rows already credited when it is handed the record.
test('the usage is logged once, after every credit has landed', () => {
  const { progress, tickets } = boardFixture({ tasks: [taskFixture({ id: 1 }), taskFixture({ id: 2 })] });
  const tokensWhenLogged: (number | null)[][] = [];
  const board = new Board({
    progress,
    tickets,
    logger: createLogger(() => tokensWhenLogged.push(progress.tasks.map((task) => task.tokens))),
  });

  board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'row', taskId: 1, tokens: 501 }, { target: 'row', taskId: 2, tokens: 500 }], STOPPED_AT);

  expect(tokensWhenLogged).toEqual([[501, 500]]);
});

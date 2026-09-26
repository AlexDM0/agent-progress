/**
 * The Board's token crediting, which the `SubagentStop` hook makes. What it relies on: a share adds to what a row already holds, an
 * unset count counting as 0; a ticket's share lands on the row the ticket has when the hook runs; a review share lands on the ticket's
 * newest free-standing review bar, whatever its status; a share that cannot land is a verdict that costs only that share, never a throw,
 * because the agent has already stopped; and the usage is logged once, after the credits.
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

function deliveredReviewBarFixture(id: number, reviewOf: string, reviewBarRound: number): Task {
  return taskFixture({
    id,
    name:   `Review ${reviewBarRound} #${reviewOf} — Example review`,
    status: 'delivered',
    reviewOf,
    reviewBarRound,
  });
}

// A reviewer files its own bar after its brief was written, and release delivers that bar before the reviewer stops.
test('a review share lands on the ticket\'s newest filed review bar, a delivered one included, and leaves the earlier bar as it was', () => {
  const { board, progress } = boardFixture({
    tasks: [
      deliveredReviewBarFixture(6, '001', 2),
      { ...deliveredReviewBarFixture(2, '001', 1), tokens: 300 },
      { ...deliveredReviewBarFixture(4, '002', 1), status: 'in-progress' },
    ],
    tickets: [ticketFixture({ id: '001', status: 'delivered' }), ticketFixture({ id: '002', title: 'Example basket badge' })],
  });

  const { outcomes } = board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'review', ticketId: '001', tokens: 1_001 }], STOPPED_AT);

  expect(outcomes).toEqual([{ verdict: 'credited', taskId: 6 }]);
  expect(progress.tasks.map((task) => task.tokens)).toEqual([1_001, 300, null]);
});

// A hand-edited file can repeat an id; the page's Kanban takes the first bar holding the highest one, and so does crediting.
test('a review share on two bars sharing the highest id lands on the first of them in the file', () => {
  const firstBar  = deliveredReviewBarFixture(5, '003', 1);
  const secondBar = deliveredReviewBarFixture(5, '003', 2);
  const { board } = boardFixture({ tasks: [firstBar, secondBar], tickets: [ticketFixture({ id: '003', status: 'delivered' })] });

  board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'review', ticketId: '003', tokens: 1_001 }], STOPPED_AT);

  expect(firstBar.tokens).toBe(1_001);
  expect(secondBar.tokens).toBeNull();
});

// The hook before the Board queries credited the first row holding the bar's id, whatever it was; a reviewer's share belongs on its bar.
test('a review share lands on the newest bar even when an earlier row that is not a review bar holds the same id', () => {
  const buildRow  = taskFixture({ id: 5, name: 'Example build', tokens: 200 });
  const reviewBar = deliveredReviewBarFixture(5, '003', 1);
  const { board } = boardFixture({ tasks: [buildRow, reviewBar], tickets: [ticketFixture({ id: '003', status: 'delivered' })] });

  const { outcomes } = board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'review', ticketId: '003', tokens: 1_001 }], STOPPED_AT);

  expect(outcomes).toEqual([{ verdict: 'credited', taskId: 5 }]);
  expect(reviewBar.tokens).toBe(1_001);
  expect(buildRow.tokens).toBe(200);
});

// The hook's sentence for a review nobody filed a bar for depends on this verdict, and the other shares must still land.
test('a review share for a ticket without a free-standing review bar is its own verdict, costs only that share, and the usage is still logged once', () => {
  const { board, progress, records } = boardFixture({
    tasks:   [taskFixture({ id: 1, name: 'Example free-standing task' })],
    tickets: [ticketFixture({ id: '001', status: 'in-review' })],
  });

  const { outcomes, logged } = board.recordAgentStop(EXAMPLE_USAGE, [
    { target: 'review', ticketId: '001', tokens: 400 },
    { target: 'row', taskId: 1, tokens: 500 },
  ], STOPPED_AT);

  expect(outcomes).toEqual([{ verdict: 'ticket-without-review-bar', ticketId: '001' }, { verdict: 'credited', taskId: 1 }]);
  expect(progress.tasks.map((task) => task.tokens)).toEqual([500]);
  expect(logged).toEqual([{ at: STOPPED_AT, kind: 'agent-stopped', fields: EXAMPLE_USAGE }]);
  expect(records).toEqual([...logged]);
});

// A ticket's own row is never a review bar, even when it names a reviewed ticket, so a reviewer's tokens never land on a build row.
test('a ticket-owned row whose reviewOf names the ticket takes no review share', () => {
  const { board, progress } = boardFixture({
    tasks: [
      taskFixture({
        id:       3,
        name:     '#002 Example basket badge',
        ticket:   '002',
        reviewOf: '001',
      }),
    ],
    tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002', title: 'Example basket badge', task: 3 })],
  });

  const { outcomes } = board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'review', ticketId: '001', tokens: 700 }], STOPPED_AT);

  expect(outcomes).toEqual([{ verdict: 'ticket-without-review-bar', ticketId: '001' }]);
  expect(progress.tasks[0]?.tokens).toBeNull();
});

// A bar is found by its reviewOf, never through the ticket, so a ticket missing from the board does not cost the reviewer's share.
test('a review bar is credited even when its ticket id names no ticket on the board', () => {
  const { board, progress } = boardFixture({ tasks: [deliveredReviewBarFixture(5, '042', 1)] });

  const { outcomes } = board.recordAgentStop(EXAMPLE_USAGE, [{ target: 'review', ticketId: '042', tokens: 900 }], STOPPED_AT);

  expect(outcomes).toEqual([{ verdict: 'credited', taskId: 5 }]);
  expect(progress.tasks[0]?.tokens).toBe(900);
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

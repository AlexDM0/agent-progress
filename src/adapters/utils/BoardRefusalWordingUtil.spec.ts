/**
 * A refusal is what the person who ran the command reads, and scripts match on it, so each reason must word as the command did before
 * the Board refused for it. The frozen table pins one row per reason, plus both hold actions, the singular and plural limit, a
 * rereview with and without the first-review advice, and a ticket-owned row sent to each end of the verb table.
 */
import { expect, test } from 'bun:test';

import type { BoardRefusalDetail } from '../../lib/tracker-model/BoardRefusal';
import { BoardRefusalWordingUtil } from './BoardRefusalWordingUtil';

const { messageOf } = BoardRefusalWordingUtil;

/**
 * Taken from the binary before the Board existed, at bc42604 (the last commit before step 4b). To retake a row, check that commit out in
 * a worktree, run the refused command with `bun run <worktree>/agent-progress.ts` in a scratch git repository after `init`, and copy its
 * standard error. Rows no command reaches easily (the singular limit, a ticket-owned row sent to re-review, a held-back ticket with one
 * blocker) are read from the wording in bc42604:cli/task/TaskCommand.ts, bc42604:cli/ticket/TicketCommand.ts and
 * bc42604:lib/tickets/TicketTransitions.ts.
 */
const MESSAGE_FOR_REFUSAL: readonly (readonly [BoardRefusalDetail, string])[] = [
  [{ reason: 'unknown-task', taskId: 99 }, 'There is no task #99. Run `agent-progress status` to see the rows this tracker holds.'],
  [
    {
      reason:       'ticket-owned-row',
      taskId:       3,
      ticketId:     '004',
      targetStatus: 'in-review',
    },
    'Task #3 belongs to ticket #004, so moving it here would leave the row and the ticket disagreeing. '
    + 'Run `agent-progress ticket finish 004` instead, which moves both, or pass --force to move only the row.',
  ],
  [
    {
      reason:       'ticket-owned-row',
      taskId:       3,
      ticketId:     '004',
      targetStatus: 'pending',
    },
    'Task #3 belongs to ticket #004, so moving it here would leave the row and the ticket disagreeing. '
    + 'Run `agent-progress ticket reopen 004` instead, which moves both, or pass --force to move only the row.',
  ],
  [
    {
      reason:       'ticket-owned-row',
      taskId:       1,
      ticketId:     '001',
      targetStatus: 're-review',
    },
    'Task #1 belongs to ticket #001, so moving it here would leave the row and the ticket disagreeing. '
    + 'Run `agent-progress ticket rereview 001` instead, which moves both, or pass --force to move only the row.',
  ],
  [
    {
      reason:   'ticket-already-has-row',
      ticketId: '001',
      taskId:   1,
      taskName: '#001 Example checkout flow',
    },
    'Ticket #001 already has task #1 ("#001 Example checkout flow"). Pass --force to move the ticket on to the new row, or leave --ticket off.',
  ],
  [
    {
      reason:         'task-belongs-to-another-ticket',
      taskId:         3,
      owningTicketId: '004',
      ticketId:       '007',
    },
    'Task #3 already belongs to ticket #004. Pass --force to move it to ticket #007.',
  ],
  [
    { reason: 'ticket-already-in-status', ticketId: '004', status: 'reviewed' },
    'Ticket #004 is already reviewed, so nothing was changed and nothing was logged.',
  ],
  [
    {
      reason:       'illegal-ticket-move',
      ticketId:     '001',
      status:       'pending',
      targetStatus: 'reviewed',
    },
    'Ticket #001 is pending, and `agent-progress ticket approve` moves a ticket that is in-progress or in-review. '
    + 'Run `agent-progress ticket status 001 reviewed` if you mean to set it directly.',
  ],
  [
    { reason: 'abandon-without-reason', ticketId: '006' },
    'Ticket #006 was not moved: abandon needs --reason. Say why the work was dropped, for example `agent-progress ticket abandon 3 --reason "superseded by #7"`.',
  ],
  [
    { reason: 'tokens-without-a-row', ticketId: '006' },
    'Ticket #006 has no row, so --tokens has nowhere to be recorded: a low-priority ticket gets its row when it is started. Drop --tokens.',
  ],
  [
    { reason: 'rereview-outside-review', ticketId: '001', status: 'pending' },
    'Ticket #001 is pending, and another review pass needs a ticket that is in-review.',
  ],
  [
    { reason: 'rereview-outside-review', ticketId: '003', status: 'in-progress' },
    'Ticket #003 is in-progress, and another review pass needs a ticket that is in-review. Run `agent-progress ticket finish 003` to send it to its first reviewer.',
  ],
  [
    { reason: 'unclaimable-status', ticketId: '003', status: 'in-progress' },
    'Ticket #003 is in-progress, and `agent-progress ticket claim` takes a ticket that is pending or in-review. Nothing was written.',
  ],
  [
    { reason: 'claim-waits-on-dependencies', ticketId: '007', unsettledTicketIds: ['001'] },
    'Ticket #007 is waiting on #001, which must be reviewed or delivered before it is claimed. Nothing was written.',
  ],
  [
    { reason: 'claim-of-a-held-ticket', ticketId: '001' },
    'Ticket #001 is held, so it is not claimed. Nothing was written; `agent-progress ticket unhold 001` lets it be claimed.',
  ],
  [
    { reason: 'claim-of-held-back-low-ticket', ticketId: '006', holdingBackTicketIds: ['001', '003', '004', '005', '007'] },
    'Ticket #006 is low priority, and #001, #003, #004, #005, #007 are normal or high and not delivered or abandoned yet, so it is not claimed. '
    + 'Nothing was written; `agent-progress ticket start 006` starts it regardless.',
  ],
  [
    { reason: 'claim-of-held-back-low-ticket', ticketId: '002', holdingBackTicketIds: ['001'] },
    'Ticket #002 is low priority, and #001 is normal or high and not delivered or abandoned yet, so it is not claimed. '
    + 'Nothing was written; `agent-progress ticket start 002` starts it regardless.',
  ],
  [
    { reason: 'claim-under-review', ticketId: '004', reviewBarTaskId: 7 },
    'Ticket #004 is under review: its review row #7 is in progress. Nothing was written.',
  ],
  [
    {
      reason:             'concurrency-limit-reached',
      ticketIds:          ['001'],
      agentsInFlight:     3,
      inProgressRowCount: 4,
      limit:              2,
    },
    'Ticket #001 was not claimed: 3 agents are in flight (4 rows are in progress) and the concurrency limit is 2 agents. '
    + 'Nothing was written; claim once an agent has finished.',
  ],
  [
    {
      reason:             'concurrency-limit-reached',
      ticketIds:          ['001'],
      agentsInFlight:     1,
      inProgressRowCount: 1,
      limit:              1,
    },
    'Ticket #001 was not claimed: 1 agent is in flight (1 row is in progress) and the concurrency limit is 1 agent. '
    + 'Nothing was written; claim once an agent has finished.',
  ],
  [
    {
      reason:             'concurrency-limit-reached',
      ticketIds:          ['003', '004', '005'],
      agentsInFlight:     2,
      inProgressRowCount: 2,
      limit:              2,
    },
    'Tickets #003, #004, #005 were not claimed: 2 agents are in flight (2 rows are in progress) and the concurrency limit is 2 agents. '
    + 'Nothing was written; claim once an agent has finished.',
  ],
  [
    { reason: 'unknown-dependency', missingTicketIds: ['042'] },
    'There is no ticket #042. Run `agent-progress ticket list` to see what this tracker holds.',
  ],
  [
    { reason: 'dependency-loop', loopTicketIds: ['001', '003', '001'] },
    'That would make tickets wait on each other in a circle: #001 → #003 → #001.',
  ],
  [
    { reason: 'dependency-loop', loopTicketIds: ['001', '001'] },
    'That would make tickets wait on each other in a circle: #001 → #001.',
  ],
  [
    {
      reason:   'priority-unchanged',
      ticketId: '001',
      status:   'pending',
      priority: 'normal',
    },
    'Ticket #001 is pending, and its priority was not changed: it is already normal priority. Nothing was written.',
  ],
  [
    { reason: 'lowering-a-ticket-that-is-not-pending', ticketId: '003', status: 'in-progress' },
    'Ticket #003 is in-progress, and its priority was not changed: only a pending ticket can be lowered to low, since a low ticket has no row until it is started. '
    + 'Nothing was written.',
  ],
  [
    { reason: 'agents-of-a-settled-ticket', ticketId: '004', status: 'delivered' },
    'Ticket #004 is delivered, and its agents were not changed: no agent will work it again. Nothing was written.',
  ],
  [
    {
      reason:   'agents-unchanged',
      ticketId: '003',
      status:   'in-progress',
      agents:   { model: 'sonnet', effort: 'high' },
    },
    'Ticket #003 is in-progress, and its agents were not changed: they already run on sonnet/high. Nothing was written.',
  ],
  [
    {
      reason:   'hold-of-a-settled-ticket',
      ticketId: '004',
      status:   'delivered',
      action:   'hold',
    },
    'Ticket #004 is delivered, and no agent will work it again, so there is nothing to hold. Nothing was written.',
  ],
  [
    {
      reason:   'hold-of-a-settled-ticket',
      ticketId: '004',
      status:   'delivered',
      action:   'unhold',
    },
    'Ticket #004 is delivered, and no agent will work it again, so there is nothing to unhold. Nothing was written.',
  ],
  [{ reason: 'ticket-already-held', ticketId: '001' }, 'Ticket #001 is already held. Nothing was written.'],
  [{ reason: 'ticket-not-held', ticketId: '001' }, 'Ticket #001 is not held. Nothing was written.'],
];

const REFUSAL_REASON_COUNT = 24;

test('every reason words as the refusal the command printed before the Board refused for it', () => {
  expect(new Set(MESSAGE_FOR_REFUSAL.map(([detail]) => detail.reason)).size, 'the table covers every reason').toBe(REFUSAL_REASON_COUNT);
  for (const [detail, message] of MESSAGE_FOR_REFUSAL) expect(messageOf(detail), detail.reason).toBe(message);
});

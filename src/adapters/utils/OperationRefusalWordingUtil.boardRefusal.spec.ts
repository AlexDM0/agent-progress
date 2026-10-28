/**
 * A refusal is what the person who ran the command reads, and scripts match on it, so each reason must word as the command did before
 * the Board refused for it. The frozen table pins one row per reason, plus both hold actions, the singular and plural limit, a
 * rereview with and without the first-review advice, and a ticket-owned row sent to each end of the verb table.
 */
import { expect, test } from 'bun:test';

import type { BoardRefusalDetail }               from '../../lib/tracker-model/BoardRefusal.ts';
import { ORIGINAL_PRODUCT_NAMES, PRODUCT_NAMES } from '../../shared/constants/ProductNames.ts';
import { OperationRefusalWordingUtil }           from './OperationRefusalWordingUtil.ts';

const { boardRefusalMessageOf: messageOf } = OperationRefusalWordingUtil;

/** The table keeps the released program's name it was taken with; the wording names the program this build is linked by. */
function namingThisProgram(message: string): string {
  return message.replaceAll(new RegExp(`\`${RegExp.escape(ORIGINAL_PRODUCT_NAMES.PROGRAM)} (?!row:)`, 'g'), `\`${PRODUCT_NAMES.PROGRAM} `);
}

/**
 * Taken from the binary before the Board existed, at bc42604 (the last commit before step 4b). To retake a row, check that commit out in
 * a worktree, run the refused command with `bun run <worktree>/agent-progress.ts` in a scratch git repository after `init`, and copy its
 * standard error. Rows no command reaches easily (the singular limit, a ticket-owned row sent to re-review) are read from the wording in
 * bc42604:cli/task/TaskCommand.ts, bc42604:cli/ticket/TicketCommand.ts and bc42604:lib/tickets/TicketTransitions.ts. The two review-record
 * reasons are newer than bc42604, and their rows were taken from the wording util when they were added, as were the four draft reasons, the
 * lowering row's "draft or pending" and the three network reasons.
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
    { reason: 'review-record-without-a-review-bar', ticketId: '006' },
    'Ticket #006 has no in-progress review bar, so there is no review pass to record and nothing was logged. '
    + 'A review is recorded on its own bar: `agent-progress task add "<name>" --review-of 006 --start` starts one.',
  ],
  [
    { reason: 'review-bar-without-a-round', ticketId: '006', taskId: 7 },
    'Review bar #7 of ticket #006 stores no round, so the pass cannot be recorded and nothing was logged. '
    + 'Start the pass on a bar of its own with `agent-progress task add "<name>" --review-of 006 --start`.',
  ],
  [
    { reason: 'review-record-on-a-row-that-is-not-a-review-bar', ticketId: '006', taskId: 7 },
    'Row #7 is not an in-progress review bar, so the review of ticket #006 cannot be recorded on it and nothing was logged. '
    + 'Pass --bar the row your review runs on, the `agent-progress row:` line of your prompt.',
  ],
  [
    {
      reason: 'review-record-on-a-bar-outside-the-bundle', ticketId: '006', taskId: 7, reviewOf: '004'
    },
    'Review bar #7 reviews ticket #004, which was not claimed with ticket #006, so the review cannot be recorded on it and nothing was logged. '
    + 'Pass --bar the review bar of the bundle holding the ticket.',
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
    { reason: 'network-of-a-ticket-past-pending', ticketId: '006', status: 'in-progress' },
    'Ticket #006 is in-progress, and its network line was not changed: it is set only while the ticket is draft or pending. Nothing was written.',
  ],
  [
    { reason: 'network-domain-not-public', ticketId: '002', domains: ['localhost'] },
    'Ticket #002\'s network line was not changed: localhost is not a public domain, '
    + 'and a loopback name, a .local name or a loopback or private IP address is never granted. Nothing was written.',
  ],
  [
    { reason: 'network-domain-not-public', ticketId: '002', domains: ['printer.local', '10.0.0.1'] },
    'Ticket #002\'s network line was not changed: printer.local, 10.0.0.1 are not public domains, '
    + 'and a loopback name, a .local name or a loopback or private IP address is never granted. Nothing was written.',
  ],
  [
    { reason: 'network-unchanged', ticketId: '002', domains: [] },
    'Ticket #002\'s network line was not changed: it already reads no domain. Nothing was written.',
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
    'Ticket #003 is in-progress, and its priority was not changed: only a draft or pending ticket can be lowered to low, since a low ticket has no row until it is started. '
    + 'Nothing was written.',
  ],
  [
    { reason: 'move-to-draft', ticketId: '003', status: 'pending' },
    'Ticket #003 is pending, and no move returns a ticket to draft: filing is the only way in. '
    + 'Run `agent-progress ticket hold 003` to keep it from being built for now.',
  ],
  [
    { reason: 'move-of-a-draft', ticketId: '003', targetStatus: 'in-progress' },
    'Ticket #003 is a draft ticket, so it was not moved: '
    + 'run `agent-progress ticket ready 003` to ready it to build, which checks its Acceptance and Brief.',
  ],
  [
    { reason: 'ready-of-a-ticket-not-in-draft', ticketId: '003', status: 'in-review' },
    'Ticket #003 is in-review, not a draft ticket, so nothing was readied: only a draft ticket is readied. Nothing was written.',
  ],
  [
    {
      reason:            'incomplete-tickets',
      incompleteTickets: [{ ticketId: '003', gaps: ['acceptance-unnumbered'] }, { ticketId: '004', gaps: ['acceptance-unnumbered', 'brief-missing'] }],
    },
    'Nothing was readied: ticket #003 is incomplete: its `## Acceptance` holds no numbered item (acceptance-unnumbered); '
    + 'ticket #004 is incomplete: its `## Acceptance` holds no numbered item (acceptance-unnumbered), and it has no `## Brief` with a non-blank line (brief-missing). '
    + 'Number every Acceptance item as `A1.` at the start of a line and write a `## Brief`, then ready them again.',
  ],
  [
    { reason: 'agents-of-a-settled-ticket', ticketId: '004', status: 'delivered' },
    'Ticket #004 is delivered, and its agents were not changed: no agent will work it again. Nothing was written.',
  ],
  [
    {
      reason:   'size-unchanged',
      ticketId: '003',
      status:   'delivered',
      size:     'M',
    },
    'Ticket #003 is delivered, and its size was not changed: it is already M. Nothing was written.',
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
  [
    {
      reason:   'release-mark-of-a-settled-ticket',
      ticketId: '004',
      status:   'abandoned',
      action:   'mark',
    },
    'Ticket #004 is abandoned, and its release mark was not set: no agent will work it again. Nothing was written.',
  ],
  [
    {
      reason:   'release-mark-of-a-settled-ticket',
      ticketId: '004',
      status:   'delivered',
      action:   'clear',
    },
    'Ticket #004 is delivered, and its release mark was not cleared: no agent will work it again. Nothing was written.',
  ],
  [
    { reason: 'release-mark-of-an-ungrouped-ticket', ticketId: '001' },
    'Ticket #001 belongs to no group, so it cannot be a group\'s release ticket. Nothing was written.',
  ],
  [
    {
      reason:          'group-already-has-a-release-ticket',
      ticketId:        '003',
      group:           'example-shop',
      releaseTicketId: '002',
    },
    'Group example-shop already has its release ticket, #002: clear it with `agent-progress ticket release-of 002 --clear` first. Nothing was written.',
  ],
  [
    {
      reason:          'group-already-has-a-release-ticket',
      ticketId:        '002',
      group:           'example-shop',
      releaseTicketId: '002',
    },
    'Ticket #002 is already the release ticket of group example-shop. Nothing was written.',
  ],
  [{ reason: 'ticket-is-not-a-release-ticket', ticketId: '001' }, 'Ticket #001 is not its group\'s release ticket. Nothing was written.'],
  [
    {
      reason:          'reopen-beside-an-open-release-ticket',
      ticketId:        '001',
      status:          'abandoned',
      targetStatus:    'pending',
      group:           'example-shop',
      releaseTicketId: '002',
    },
    'Ticket #001 is abandoned and carries the release mark of group example-shop, so it was not moved to pending: '
      + 'the group already has its open release ticket, #002, and a group has one. '
      + 'Clear that mark with `agent-progress ticket release-of 002 --clear` first. Nothing was written.',
  ],
  [
    { reason: 'malformed-epic-key', epicKey: 'Checkout_Redesign' },
    '"Checkout_Redesign" is not a usable epic key: a key is lower-case letters and digits, in words joined by single hyphens, '
    + 'such as `checkout-redesign`. Nothing was written.',
  ],
  [
    { reason: 'epic-already-exists', epicKey: 'checkout-redesign' },
    'There is already an epic checkout-redesign. Nothing was written; `agent-progress epic edit checkout-redesign` changes it.',
  ],
  [
    { reason: 'unknown-epic', missingEpicKeys: ['checkout-redesign', 'search'] },
    'There is no epic checkout-redesign, search. Nothing was written; run `agent-progress epic list` to see what this tracker holds.',
  ],
  [
    { reason: 'epic-still-named', epicKey: 'checkout-redesign', ticketIds: ['003'] },
    'Epic checkout-redesign was not removed: #003 still names it. Nothing was written; '
    + '`agent-progress ticket epic <id> --remove checkout-redesign` takes it off a ticket.',
  ],
  [
    { reason: 'check-command-change-with-tickets-in-flight', ticketIds: ['003', '005'] },
    'The check command was not changed: #003, #005 are in progress or in review under the one stored, and a release refuses a ticket '
    + 'whose stamp differs from the command it runs. Nothing was written; add --restamp to stamp every ticket in flight with the new command.',
  ],
];

const REFUSAL_REASON_COUNT = 45;

test('every reason words as the refusal the command printed before the Board refused for it', () => {
  expect(new Set(MESSAGE_FOR_REFUSAL.map(([detail]) => detail.reason)).size, 'the table covers every reason').toBe(REFUSAL_REASON_COUNT);
  for (const [detail, message] of MESSAGE_FOR_REFUSAL) expect(messageOf(detail), detail.reason).toBe(namingThisProgram(message));
});

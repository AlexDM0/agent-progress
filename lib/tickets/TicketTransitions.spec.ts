/**
 * A claim per row of the "Ticket → task transitions" table in `docs/plan.md`; the store operations
 * are a recording double because `lib/tickets/` may not import `lib/progress/`.
 */

import { describe, expect, test }          from 'bun:test';
import { TICKET_STATUSES }                 from '../constants/Statuses.ts';
import type { ProgressFile, Task, Ticket } from '../constants/Types.ts';
import {
  LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS,
  applyTicketRereview,
  applyTicketTransition,
  ensureTaskForTicket,
  seedTaskFromTicket,
  ticketMoveIsLegal
}                                                               from './TicketTransitions.ts';
import type { ApplyTicketTransitionResult, ProgressOperations } from './TicketTransitions.ts';

const FILED_AT            = '2026-09-18T09:00:00+02:00';
const STARTED_AT          = '2026-09-18T10:00:00+02:00';
const FINISHED_AT         = '2026-09-18T12:00:00+02:00';
const REREVIEWED_AT       = '2026-09-18T13:00:00+02:00';
const REREVIEWED_AGAIN_AT = '2026-09-18T14:00:00+02:00';
const DELIVERED_AT        = '2026-09-18T15:00:00+02:00';
const TICKET_BODY         = '# Example\n\n## Report\n\nReported by Alex Example.\n';
const TICKET_NAME         = '#003 Fix the export dialog';

function progressFixture(): ProgressFile {
  return {
    version:    1,
    trackerId:  'tracker-example',
    project:    'Example Agency',
    startedAt:  FILED_AT,
    view:       { kind: 'auto' },
    nextTaskId: 1,
    tasks:      [],
    log:        [],
  };
}

function ticketFixture(): Ticket {
  return {
    frontmatter: {
      id:          '003',
      title:       'Fix the export dialog',
      type:        'bug',
      status:      'open',
      filed:       FILED_AT,
      updated:     FILED_AT,
      started:     null,
      finished:    null,
      delivered:   null,
      abandonedAt: null,
      task:        null,
      extra:       [],
    },
    body:     TICKET_BODY,
    filePath: '/scratch/.agent-progress/tickets/003-fix-the-export-dialog.md',
  };
}

function progressOperations(): ProgressOperations {
  return {
    addTask: (progress, input) => {
      const task: Task = {
        id:     progress.nextTaskId++,
        name:   input.name,
        status: input.status ?? 'pending',
        start:  input.start ?? null,
        end:    input.end ?? null,
        owner:  input.owner ?? '',
        note:   input.note ?? '',
        ticket: input.ticket ?? null,
        tokens: null,
        ...(input.reviewed === undefined ? {} : { reviewed: input.reviewed }),
      };
      progress.tasks.push(task);
      return task;
    },

    findTask: (progress, taskId) => progress.tasks.find((task) => task.id === taskId),

    transitionTask: (progress, taskId, status, at) => {
      const task = progress.tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined) {
        return 'no-such-task';
      }
      task.status = status;
      switch (status) {
        case 'pending':
          task.start = null;
          task.end   = null;
          break;
        case 'running':
          task.start ??= at;
          task.end = null;
          break;
        case 'finished':
        case 'reviewed':
        case 'delivered':
          task.start ??= at;
          task.end ??= at;
          break;
        case 're-review':
          task.start ??= at;
          task.end ??= at;
          task.reviewRound = task.reviewRound === undefined ? 2 : task.reviewRound + 1;
          break;
        case 'abandoned':
          if (task.start !== null) {
            task.end ??= at;
          }
          break;
      }
      return 'applied';
    },

    appendLogEntry: (progress, at, text) => {
      progress.log.push({ at, text });
    },
  };
}

function applied(result: ApplyTicketTransitionResult): { ticket: Ticket; logText: string } {
  if (result.verdict !== 'applied') {
    throw new Error(`expected the transition to apply, got a refusal: ${result.reason}`);
  }
  return result;
}

describe('ensureTaskForTicket', () => {
  test('creates a pending row named after the ticket and links the two together', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    const task = ensureTaskForTicket({ progress, ticket, operations });

    expect(task.name).toBe(TICKET_NAME);
    expect(task.status).toBe('pending');
    expect(task.ticket).toBe('003');
    expect(ticket.frontmatter.task).toBe(task.id);
    expect(progress.tasks).toHaveLength(1);
  });

  test('returns the row the ticket already names instead of filing a second one', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    const first  = ensureTaskForTicket({ progress, ticket, operations });
    const second = ensureTaskForTicket({ progress, ticket, operations });

    expect(second.id).toBe(first.id);
    expect(progress.tasks).toHaveLength(1);
  });
});

describe('applyTicketTransition', () => {
  test('start puts the ticket in progress, stamps started, and sets its row running', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    const result = applied(applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-progress',
      at:           STARTED_AT,
    }));

    expect(ticket.frontmatter.status).toBe('in-progress');
    expect(ticket.frontmatter.started).toBe(STARTED_AT);
    expect(ticket.frontmatter.updated).toBe(STARTED_AT);
    expect(progress.tasks[0]?.status).toBe('running');
    expect(progress.tasks[0]?.start).toBe(STARTED_AT);
    expect(result.logText).toBe('Ticket #003 started');
    expect(progress.log).toEqual([{ at: STARTED_AT, text: 'Ticket #003 started' }]);
  });

  test('review stamps finished and sets the row finished', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-progress',
      at:           STARTED_AT,
    });
    const result = applied(applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-review',
      at:           FINISHED_AT,
    }));

    expect(ticket.frontmatter.status).toBe('in-review');
    expect(ticket.frontmatter.finished).toBe(FINISHED_AT);
    expect(progress.tasks[0]?.status).toBe('finished');
    expect(progress.tasks[0]?.end).toBe(FINISHED_AT);
    expect(result.logText).toBe('Ticket #003 in review');
  });

  test('done sets the row reviewed and stamps finished when the ticket never went through review', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    const result = applied(applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'done',
      at:           FINISHED_AT,
    }));

    expect(ticket.frontmatter.finished).toBe(FINISHED_AT);
    expect(progress.tasks[0]?.status).toBe('reviewed');
    expect(result.logText).toBe('Ticket #003 done');
  });

  test('deliver stamps delivered, sets the row delivered, and leaves an earlier finish alone', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'done',
      at:           FINISHED_AT,
    });
    const result = applied(applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'delivered',
      at:           DELIVERED_AT,
    }));

    expect(ticket.frontmatter.status).toBe('delivered');
    expect(ticket.frontmatter.finished).toBe(FINISHED_AT);
    expect(ticket.frontmatter.delivered).toBe(DELIVERED_AT);
    expect(progress.tasks[0]?.status).toBe('delivered');
    expect(result.logText).toBe('Ticket #003 delivered');
  });

  test('abandon stamps abandonedAt, records the reason, and puts it in the log line', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-progress',
      at:           STARTED_AT,
    });
    const result = applied(applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'abandoned',
      at:           FINISHED_AT,
      reason:       'the export dialog is being replaced',
    }));

    expect(ticket.frontmatter.status).toBe('abandoned');
    expect(ticket.frontmatter.abandonedAt).toBe(FINISHED_AT);
    expect(ticket.frontmatter.reason).toBe('the export dialog is being replaced');
    expect(progress.tasks[0]?.status).toBe('abandoned');
    expect(progress.tasks[0]?.end).toBe(FINISHED_AT);
    expect(result.logText).toBe('Ticket #003 abandoned: the export dialog is being replaced');
  });

  test('abandoning without a reason is refused, and nothing about the ticket moves', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    const result = applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'abandoned',
      at:           FINISHED_AT,
    });

    expect(result).toEqual({ verdict: 'refused', reason: 'abandon needs --reason' });
    expect(ticket.frontmatter.status).toBe('open');
    expect(ticket.frontmatter.abandonedAt).toBeNull();
    expect(ticket.frontmatter.updated).toBe(FILED_AT);
    expect(progress.tasks).toEqual([]);
    expect(progress.log).toEqual([]);
  });

  test('reopen clears every timestamp and the reason, and the row goes back to pending', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-progress',
      at:           STARTED_AT,
    });
    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'abandoned',
      at:           FINISHED_AT,
      reason:       'superseded',
    });
    const result = applied(applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'open',
      at:           DELIVERED_AT,
    }));

    expect(ticket.frontmatter.status).toBe('open');
    expect(ticket.frontmatter.started).toBeNull();
    expect(ticket.frontmatter.finished).toBeNull();
    expect(ticket.frontmatter.delivered).toBeNull();
    expect(ticket.frontmatter.abandonedAt).toBeNull();
    expect(ticket.frontmatter.reason).toBeUndefined();
    expect(progress.tasks[0]?.status).toBe('pending');
    expect(progress.tasks[0]?.start).toBeNull();
    expect(result.logText).toBe('Ticket #003 reopened');
  });

  test('running start twice leaves started where it was and only moves updated', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-progress',
      at:           STARTED_AT,
    });
    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-progress',
      at:           FINISHED_AT,
    });

    expect(ticket.frontmatter.started).toBe(STARTED_AT);
    expect(ticket.frontmatter.updated).toBe(FINISHED_AT);
    expect(progress.tasks[0]?.start).toBe(STARTED_AT);
    expect(progress.tasks).toHaveLength(1);
  });

  test('abandoning twice moves abandonedAt to the second decision', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'abandoned',
      at:           FINISHED_AT,
      reason:       'superseded',
    });
    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'abandoned',
      at:           DELIVERED_AT,
      reason:       'superseded again',
    });

    expect(ticket.frontmatter.abandonedAt).toBe(DELIVERED_AT);
    expect(ticket.frontmatter.reason).toBe('superseded again');
  });

  test('a ticket whose row was cleared away gets a new one rather than a refusal', () => {
    const progress          = progressFixture();
    const ticket            = ticketFixture();
    const operations        = progressOperations();
    ticket.frontmatter.task = 99;

    applied(applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-progress',
      at:           STARTED_AT,
    }));

    expect(progress.tasks).toHaveLength(1);
    expect(ticket.frontmatter.task).toBe(progress.tasks[0]?.id ?? 0);
    expect(progress.tasks[0]?.status).toBe('running');
  });

  test('a branch and a commit handed to a transition are recorded on the ticket', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    applied(applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'done',
      at:           FINISHED_AT,
      branch:       'ticket/export-dialog',
      commit:       'a1b2c3d',
    }));

    expect(ticket.frontmatter.branch).toBe('ticket/export-dialog');
    expect(ticket.frontmatter.commit).toBe('a1b2c3d');
  });
});

describe('applyTicketRereview', () => {
  function ticketInReview(progress: ProgressFile, operations: ProgressOperations): Ticket {
    const ticket = ticketFixture();
    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-progress',
      at:           STARTED_AT,
    });
    applyTicketTransition({
      progress,
      ticket,
      operations,
      targetStatus: 'in-review',
      at:           FINISHED_AT,
    });
    return ticket;
  }

  test('a ticket already in review goes round again: the status stays, only updated moves, and the row counts the second pass', () => {
    const progress   = progressFixture();
    const operations = progressOperations();
    const ticket     = ticketInReview(progress, operations);

    const result = applied(applyTicketRereview({
      progress,
      ticket,
      operations,
      at: REREVIEWED_AT,
    }));

    expect(ticket.frontmatter.status).toBe('in-review');
    expect(ticket.frontmatter.finished).toBe(FINISHED_AT);
    expect(ticket.frontmatter.updated).toBe(REREVIEWED_AT);
    expect(progress.tasks[0]?.status).toBe('re-review');
    expect(progress.tasks[0]?.reviewRound).toBe(2);
    expect(progress.tasks[0]?.end, 'the bar ended when the first review began').toBe(FINISHED_AT);
    expect(result.logText).toBe('Ticket #003 in review, round 2');
    expect(progress.log.at(-1)).toEqual({ at: REREVIEWED_AT, text: 'Ticket #003 in review, round 2' });
  });

  test('running it again on the same ticket reaches the third round and says so', () => {
    const progress   = progressFixture();
    const operations = progressOperations();
    const ticket     = ticketInReview(progress, operations);

    applied(applyTicketRereview({
      progress,
      ticket,
      operations,
      at: REREVIEWED_AT,
    }));
    const result = applied(applyTicketRereview({
      progress,
      ticket,
      operations,
      at: REREVIEWED_AGAIN_AT,
    }));

    expect(progress.tasks[0]?.reviewRound).toBe(3);
    expect(result.logText).toBe('Ticket #003 in review, round 3');
    expect(ticket.frontmatter.status).toBe('in-review');
  });

  test('a ticket in any other status is refused, the reason names the status it needs, and nothing moves', () => {
    for (const status of TICKET_STATUSES.filter((candidate) => candidate !== 'in-review')) {
      const progress            = progressFixture();
      const operations          = progressOperations();
      const ticket              = ticketFixture();
      ticket.frontmatter.status = status;

      const result = applyTicketRereview({
        progress,
        ticket,
        operations,
        at: REREVIEWED_AT,
      });

      expect(result, status).toEqual({ verdict: 'refused', reason: 'another review pass needs a ticket that is in-review' });
      expect(ticket.frontmatter.status, status).toBe(status);
      expect(ticket.frontmatter.updated, status).toBe(FILED_AT);
      expect(progress.tasks, status).toEqual([]);
      expect(progress.log, status).toEqual([]);
    }
  });

  test('a ticket whose row was cleared away gets a new one in its next round rather than a refusal', () => {
    const progress            = progressFixture();
    const operations          = progressOperations();
    const ticket              = ticketInReview(progress, operations);
    progress.tasks.length     = 0;

    const result = applied(applyTicketRereview({
      progress,
      ticket,
      operations,
      at: REREVIEWED_AT,
    }));

    expect(progress.tasks).toHaveLength(1);
    expect(progress.tasks[0]?.reviewRound).toBe(2);
    expect(result.logText).toBe('Ticket #003 in review, round 2');
  });
});

describe('seedTaskFromTicket', () => {
  test('a done ticket comes back as a reviewed bar carrying both of its timestamps', () => {
    const progress                = progressFixture();
    const ticket                  = ticketFixture();
    const operations              = progressOperations();
    ticket.frontmatter.status     = 'done';
    ticket.frontmatter.started    = STARTED_AT;
    ticket.frontmatter.finished   = FINISHED_AT;

    const seeded = seedTaskFromTicket({ progress, ticket, operations });

    expect(seeded.status).toBe('reviewed');
    expect(seeded.start).toBe(STARTED_AT);
    expect(seeded.end).toBe(FINISHED_AT);
    expect(seeded.name).toBe(TICKET_NAME);
    expect(seeded.ticket).toBe('003');
    expect(ticket.frontmatter.task).toBe(seeded.id);
  });

  test('a ticket delivered without ever being marked finished ends its bar at the delivery', () => {
    const progress               = progressFixture();
    const ticket                 = ticketFixture();
    const operations             = progressOperations();
    ticket.frontmatter.status    = 'delivered';
    ticket.frontmatter.started   = STARTED_AT;
    ticket.frontmatter.delivered = DELIVERED_AT;

    const seeded = seedTaskFromTicket({ progress, ticket, operations });

    expect(seeded.status).toBe('delivered');
    expect(seeded.end).toBe(DELIVERED_AT);
  });

  // `clear` re-seeds rows from tickets; a delivered ticket passed `done`, so its row has to come back marked reviewed.
  test('a done or delivered ticket comes back marked reviewed, and an open one does not', () => {
    for (const status of ['done', 'delivered'] as const) {
      const ticket              = ticketFixture();
      ticket.frontmatter.status = status;
      ticket.frontmatter.finished = FINISHED_AT;

      expect(seedTaskFromTicket({ progress: progressFixture(), ticket, operations: progressOperations() }).reviewed).toBe(FINISHED_AT);
    }
    expect(seedTaskFromTicket({ progress: progressFixture(), ticket: ticketFixture(), operations: progressOperations() }).reviewed).toBeUndefined();
  });

  test('an abandoned ticket ends its bar where it was abandoned', () => {
    const progress                 = progressFixture();
    const ticket                   = ticketFixture();
    const operations               = progressOperations();
    ticket.frontmatter.status      = 'abandoned';
    ticket.frontmatter.started     = STARTED_AT;
    ticket.frontmatter.abandonedAt = FINISHED_AT;

    const seeded = seedTaskFromTicket({ progress, ticket, operations });

    expect(seeded.status).toBe('abandoned');
    expect(seeded.end).toBe(FINISHED_AT);
  });

  test('an open ticket comes back as a pending row with no bar at all', () => {
    const progress   = progressFixture();
    const ticket     = ticketFixture();
    const operations = progressOperations();

    const seeded = seedTaskFromTicket({ progress, ticket, operations });

    expect(seeded.status).toBe('pending');
    expect(seeded.start).toBeNull();
    expect(seeded.end).toBeNull();
  });
});

describe('the legality matrix', () => {
  test('every target is reachable from at least one status, and from none that equals it', () => {
    for (const [target, sources] of Object.entries(LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS)) {
      expect(sources.length, target).toBeGreaterThan(0);
      expect(sources, target).not.toContain(target);
    }
    expect(Object.keys(LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS).sort()).toEqual([...TICKET_STATUSES].sort());
  });

  test('the pipeline the skill documents is legal at every step', () => {
    expect(ticketMoveIsLegal('open', 'in-progress')).toBe(true);
    expect(ticketMoveIsLegal('in-progress', 'in-review')).toBe(true);
    expect(ticketMoveIsLegal('in-review', 'done')).toBe(true);
    expect(ticketMoveIsLegal('done', 'delivered')).toBe(true);
    expect(ticketMoveIsLegal('in-progress', 'done')).toBe(true);
    expect(ticketMoveIsLegal('in-review', 'in-progress')).toBe(true);
  });

  test('the steps that skip the pipeline are refused', () => {
    expect(ticketMoveIsLegal('open', 'delivered')).toBe(false);
    expect(ticketMoveIsLegal('open', 'in-review')).toBe(false);
    expect(ticketMoveIsLegal('open', 'done')).toBe(false);
    expect(ticketMoveIsLegal('delivered', 'in-progress')).toBe(false);
  });

  test('abandon reaches anything but the two end states; reopen anything but open', () => {
    for (const status of ['open', 'in-progress', 'in-review', 'done'] as const) {
      expect(ticketMoveIsLegal(status, 'abandoned'), status).toBe(true);
      expect(ticketMoveIsLegal(status === 'open' ? 'done' : status, 'open'), status).toBe(true);
    }
    expect(ticketMoveIsLegal('delivered', 'abandoned')).toBe(false);
    expect(ticketMoveIsLegal('abandoned', 'abandoned')).toBe(false);
    expect(ticketMoveIsLegal('open', 'open')).toBe(false);
  });
});

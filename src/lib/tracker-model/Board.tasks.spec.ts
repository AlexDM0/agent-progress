/**
 * The Board's row changes, which the `task` commands make. What they rely on: an id is never handed out twice, whatever was removed or
 * renumbered by hand; a ticket keeps one row, and moving it to another is a deliberate choice; a row a ticket owns moves only through
 * the ticket, except for a pause and its resume or a deliberate `movesAnyway`; a correction moves no clock; a count of zero stays apart
 * from none; and removing a row unlinks only a ticket that still named it. Refusals are asserted by reason code, never by wording.
 */
import { describe, expect, test } from 'bun:test';

import type { BoardFixture } from '../../testing/BoardFixtures';
import {
  boardFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures';
import type { BoardRefusalDetail } from './BoardRefusal';

const FILED_AT = '2026-09-18T09:30:00+02:00';

const MOVED_AT = '2026-09-18T11:15:00+02:00';

function ticketOwnedRowFixture(status: 'pending' | 'in-progress' | 'paused' = 'in-progress'): BoardFixture {
  return boardFixture({
    tasks: [taskFixture({
      id:     4,
      name:   '#001 Example checkout page',
      status,
      start:  status === 'pending' ? null : FILED_AT,
      ticket: '001',
    })],
    tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 4 })],
  });
}

describe('task ids', () => {
  test('the first row filed on an empty tracker is task #1', () => {
    const { board } = boardFixture();
    expect(board.addTask({ name: 'Example first task', startsNow: false, movesTheLink: false }, FILED_AT).id).toBe(1);
  });

  test('ids start at one and the counter moves past every id it hands out', () => {
    const { board, progress } = boardFixture();
    expect(board.addTask({ name: 'Plan the work', startsNow: false, movesTheLink: false }, FILED_AT).id).toBe(1);
    expect(board.addTask({ name: 'Review pass', startsNow: false, movesTheLink: false }, FILED_AT).id).toBe(2);
    expect(progress.nextTaskId).toBe(3);
  });

  // An orchestrator that still holds a removed row's id would otherwise move a stranger's row with it.
  test('an id is never reused after the row that had it is removed', () => {
    const { board } = boardFixture();
    board.addTask({ name: 'Plan the work', startsNow: false, movesTheLink: false }, FILED_AT);
    const second = board.addTask({ name: 'Review pass', startsNow: false, movesTheLink: false }, FILED_AT);
    board.removeTask(second.id);
    expect(board.addTask({ name: 'A third thing', startsNow: false, movesTheLink: false }, FILED_AT).id).toBe(3);
  });

  test('an id is never reused after the rows are thrown away, which is what clear does', () => {
    const { board } = boardFixture();
    board.addTask({ name: 'Plan the work', startsNow: false, movesTheLink: false }, FILED_AT);
    board.addTask({ name: 'Review pass', startsNow: false, movesTheLink: false }, FILED_AT);
    board.clearTracker({ ticketsSurvive: true }, MOVED_AT);
    expect(board.addTask({ name: 'Re-seeded from a ticket', startsNow: false, movesTheLink: false }, MOVED_AT).id).toBe(3);
  });

  test('a hand-renumbered row cannot be handed its own id by the next allocation', () => {
    const { board, progress } = boardFixture();
    board.addTask({ name: 'Plan the work', startsNow: false, movesTheLink: false }, FILED_AT);
    for (const onlyRow of progress.tasks) onlyRow.id = 40;
    expect(board.addTask({ name: 'Review pass', startsNow: false, movesTheLink: false }, FILED_AT).id).toBe(41);
  });
});

describe('addTask', () => {
  test('a row is filed pending with its first phase at the moment it was filed, and starts at once when asked', () => {
    const { board } = boardFixture();
    const waiting   = board.addTask({ name: 'Example waiting task', startsNow: false, movesTheLink: false }, FILED_AT);
    const started   = board.addTask({ name: 'Example started task', startsNow: true, movesTheLink: false }, FILED_AT);

    expect(waiting.status).toBe('pending');
    expect(waiting.history).toEqual([{ status: 'pending', at: FILED_AT }]);
    expect(started.status).toBe('in-progress');
    expect(started.start).toBe(FILED_AT);
  });

  test('owner, note, tokens and the reviewed ticket are filed as given', () => {
    const { board } = boardFixture();
    const filed     = board.addTask({
      name:         'Review #001',
      owner:        'Alex Example',
      note:         'Example review note',
      tokens:       0,
      reviewOf:     { ticketId: '001', round: 1 },
      startsNow:    false,
      movesTheLink: false,
    }, FILED_AT);

    expect(filed).toMatchObject({
      owner:          'Alex Example',
      note:           'Example review note',
      tokens:         0,
      reviewOf:       '001',
      reviewBarRound: 1,
      ticket:         null,
    });
  });

  test('a row filed for a ticket without one links both sides', () => {
    const { board, tickets } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    const filed              = board.addTask({
      name:         'Example checkout row',
      ticketId:     '001',
      startsNow:    false,
      movesTheLink: false,
    }, FILED_AT);

    expect(filed.ticket).toBe('001');
    expect(tickets[0]?.frontmatter.task).toBe(filed.id);
  });

  // Two rows claiming one ticket would split its work across two bars, so a second row is refused unless the link is moved on purpose.
  test('a ticket that already has a row is refused a second one, and nothing changes', () => {
    const fixture        = ticketOwnedRowFixture();
    const progressBefore = structuredClone(fixture.progress);
    const ticketsBefore  = structuredClone(fixture.tickets);

    expect(refusalDetailOf(() => fixture.board.addTask({
      name:         'Example second row',
      ticketId:     '001',
      startsNow:    false,
      movesTheLink: false,
    }, FILED_AT)))
      .toEqual({
        reason:   'ticket-already-has-row',
        ticketId: '001',
        taskId:   4,
        taskName: '#001 Example checkout page',
      });
    expect(fixture.progress).toEqual(progressBefore);
    expect(fixture.tickets).toEqual(ticketsBefore);
  });

  test('moving the link leaves the old row free-standing and links the new one', () => {
    const { board, progress, tickets } = ticketOwnedRowFixture();
    const filed                        = board.addTask({
      name:         'Example second row',
      ticketId:     '001',
      startsNow:    false,
      movesTheLink: true,
    }, FILED_AT);

    expect(progress.tasks.find((task) => task.id === 4)?.ticket).toBeNull();
    expect(filed.ticket).toBe('001');
    expect(tickets[0]?.frontmatter.task).toBe(filed.id);
  });

  // A ticket naming a row that is gone has nothing to move, so the new row is linked without asking for the link to be moved.
  test('a ticket whose row is gone takes the new row without movesTheLink', () => {
    const { board, tickets } = boardFixture({ tickets: [ticketFixture({ id: '001', task: 7 })] });
    const filed              = board.addTask({
      name:         'Example replacement row',
      ticketId:     '001',
      startsNow:    false,
      movesTheLink: false,
    }, FILED_AT);

    expect(tickets[0]?.frontmatter.task).toBe(filed.id);
  });
});

describe('moveTask and correctTask', () => {
  test('a task that does not exist is refused by both', () => {
    const { board } = boardFixture();
    expect(refusalDetailOf(() => board.moveTask(3, 'in-progress', { movesAnyway: false }, MOVED_AT))).toEqual({ reason: 'unknown-task', taskId: 3 });
    expect(refusalDetailOf(() => board.correctTask(3, { name: 'Example rename' }, { movesAnyway: false }))).toEqual({ reason: 'unknown-task', taskId: 3 });
  });

  test('a row a ticket owns is refused a move by both, and nothing changes', () => {
    const fixture        = ticketOwnedRowFixture();
    const progressBefore = structuredClone(fixture.progress);
    const expected: BoardRefusalDetail = {
      reason:       'ticket-owned-row',
      taskId:       4,
      ticketId:     '001',
      targetStatus: 'in-review',
    };

    expect(refusalDetailOf(() => fixture.board.moveTask(4, 'in-review', { movesAnyway: false }, MOVED_AT))).toEqual(expected);
    expect(refusalDetailOf(() => fixture.board.correctTask(4, { status: 'in-review' }, { movesAnyway: false }))).toEqual(expected);
    expect(fixture.progress).toEqual(progressBefore);
  });

  test('a correction that names no status is not a move, so a ticket\'s row may be renamed', () => {
    const { board } = ticketOwnedRowFixture();
    expect(board.correctTask(4, { name: 'Example renamed row' }, { movesAnyway: false }).name).toBe('Example renamed row');
  });

  // No ticket status says "paused", so a pause and its resume can only ever be made on the row.
  test('a ticket\'s row may still be paused and resumed through both', () => {
    const moved = ticketOwnedRowFixture();
    expect(moved.board.moveTask(4, 'paused', { movesAnyway: false }, MOVED_AT).status).toBe('paused');
    expect(moved.board.moveTask(4, 'in-progress', { movesAnyway: false }, MOVED_AT).status).toBe('in-progress');

    const corrected = ticketOwnedRowFixture();
    expect(corrected.board.correctTask(4, { status: 'paused' }, { movesAnyway: false }).status).toBe('paused');
    expect(corrected.board.correctTask(4, { status: 'in-progress' }, { movesAnyway: false }).status).toBe('in-progress');
  });

  test('starting a ticket\'s row that is not paused is a move, not a resume', () => {
    const { board } = ticketOwnedRowFixture('pending');
    expect(refusalDetailOf(() => board.moveTask(4, 'in-progress', { movesAnyway: false }, MOVED_AT))).toMatchObject({ reason: 'ticket-owned-row' });
  });

  test('movesAnyway moves only the row, through both', () => {
    const moved = ticketOwnedRowFixture();
    expect(moved.board.moveTask(4, 'in-review', { movesAnyway: true }, MOVED_AT).status).toBe('in-review');
    expect(moved.tickets[0]?.frontmatter.status).toBe('in-progress');

    const corrected = ticketOwnedRowFixture();
    expect(corrected.board.correctTask(4, { status: 'in-review' }, { movesAnyway: true }).status).toBe('in-review');
    expect(corrected.tickets[0]?.frontmatter.status).toBe('in-progress');
  });

  test('a move stamps the row and files a phase, into the record the caller holds', () => {
    const { board, progress } = boardFixture({ tasks: [taskFixture({ id: 1 })] });
    const [held]              = progress.tasks;
    const moved               = board.moveTask(1, 'in-progress', { movesAnyway: false }, MOVED_AT);

    expect(held).toBe(moved);
    expect(moved.start).toBe(MOVED_AT);
    expect(moved.history).toEqual([{ status: 'in-progress', at: MOVED_AT }]);
  });

  // Callers hold the row across a move and read or annotate it afterwards, so the move must land in that same record, its keys where they were.
  test('a transition moves the row the caller holds, keeping its keys where the file stores them', () => {
    const held = taskFixture({
      id:      1,
      name:    'Bundle part',
      history: [{ status: 'pending', at: FILED_AT }],
      agent:   '003,004',
    });
    const { board, progress } = boardFixture({ tasks: [held] });

    board.moveTask(1, 'in-review', { movesAnyway: false }, MOVED_AT);
    expect(progress.tasks[0]).toBe(held);
    expect(held.status).toBe('in-review');
    expect(Object.keys(held)).toEqual(['id', 'name', 'status', 'start', 'end', 'owner', 'note', 'ticket', 'tokens', 'history', 'agent']);

    board.moveTask(1, 'in-progress', { movesAnyway: false }, MOVED_AT);
    expect(held.agent, 'a restart drops the key from the held record itself').toBeUndefined();
    expect('agent' in held).toBe(false);
  });

  test('a correction sets the name and the bare status, and moves no stamp and files no phase', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1 })] });
    const corrected = board.correctTask(1, { name: 'Example corrected task', status: 'in-review' }, { movesAnyway: false });

    expect(corrected).toMatchObject({
      name:   'Example corrected task',
      status: 'in-review',
      start:  null,
      end:    null,
    });
    expect(corrected.history).toBeUndefined();
  });
});

describe('annotateTask', () => {
  test('a task that does not exist is refused', () => {
    const { board } = boardFixture();
    expect(refusalDetailOf(() => board.annotateTask(3, { note: 'Example note' }))).toEqual({ reason: 'unknown-task', taskId: 3 });
  });

  test('owner, note and tokens are set when given and left alone when not', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1, note: 'Example earlier note', tokens: 1200 })] });
    const annotated = board.annotateTask(1, { owner: 'Example Agency builder' });

    expect(annotated).toMatchObject({ owner: 'Example Agency builder', note: 'Example earlier note', tokens: 1200 });
  });

  // A row that used no tokens was reported on; a row nobody reported on was not, and the two must not read alike.
  test('a later token count replaces the earlier one, and zero stays apart from none', () => {
    const { board } = boardFixture({ tasks: [taskFixture({ id: 1 }), taskFixture({ id: 2, tokens: 1200 })] });

    expect(board.annotateTask(1, {}).tokens).toBeNull();
    expect(board.annotateTask(1, { tokens: 0 }).tokens).toBe(0);
    expect(board.annotateTask(2, { tokens: 800 }).tokens).toBe(800);
  });

  test('a token count is recorded, replaced by a later report, and kept apart from zero', () => {
    const { board } = boardFixture();
    const task      = board.addTask({
      name:         'Example importer rewrite',
      tokens:       12_000,
      startsNow:    false,
      movesTheLink: false,
    }, FILED_AT);
    expect(task.tokens).toBe(12_000);
    expect(board.annotateTask(task.id, { tokens: 18_500 }).tokens).toBe(18_500);
    expect(board.annotateTask(task.id, { tokens: 0 }).tokens).toBe(0);
    expect(refusalDetailOf(() => board.annotateTask(99, { tokens: 100 }))).toEqual({ reason: 'unknown-task', taskId: 99 });
  });
});

describe('removeTask', () => {
  test('a task that does not exist is refused', () => {
    const { board } = boardFixture();
    expect(refusalDetailOf(() => board.removeTask(3))).toEqual({ reason: 'unknown-task', taskId: 3 });
  });

  test('the row is removed and handed back, and the ticket that named it names no row any more', () => {
    const { board, progress, tickets } = ticketOwnedRowFixture();
    const removed                      = board.removeTask(4);

    expect(removed.id).toBe(4);
    expect(progress.tasks).toEqual([]);
    expect(tickets[0]?.frontmatter.task).toBeNull();
  });

  // After a moved link the old row still says which ticket it served, but the ticket has moved on, and must keep its new row.
  test('a ticket that has moved on to another row keeps it', () => {
    const { board, tickets } = boardFixture({
      tasks:   [taskFixture({ id: 4, ticket: '001' }), taskFixture({ id: 5, ticket: '001' })],
      tickets: [ticketFixture({ id: '001', task: 5 })],
    });
    board.removeTask(4);

    expect(tickets[0]?.frontmatter.task).toBe(5);
  });
});

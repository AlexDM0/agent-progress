/**
 * User's job controls and the product owner's intake, applied through the control service to a Board as a hold carries it. What matters:
 * a stop or wind-down holds the job's ticket in the same hold, before any host exists too, and logs its mode; a message to a finished job
 * is refused `job-finished`; an intake is a product-owner job with no ticket; closing it ends the job once no host is live and lists its
 * drafts in a `ready-drafts` decision whose answer readies the chosen set, and no draft the decision does not list, in the answering hold;
 * a stopped product owner's questions are withdrawn; and past the crash bound a product owner waits on its open question,
 * then a fresh one takes the answers over.
 */
import { describe, expect, test } from 'bun:test';

import { TicketAcceptanceUtil }                         from '../../adapters/tickets/utils/TicketAcceptanceUtil.ts';
import type { DecisionDraft, DecisionWording }          from '../../lib/tracker-model/@types/LifecycleStep.ts';
import type { Ticket }                                  from '../../lib/tracker-model/@types/Ticket.ts';
import type { Board }                                   from '../../lib/tracker-model/Board.ts';
import type { ControlCommand }                          from '../../shared/@types/ControlCommand.ts';
import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { TrackerChange }                           from '../tracker/TrackerPipeline.ts';
import { ControlService }                               from './ControlService.ts';

const AT = '2026-09-26T10:15:00+02:00';

const COMPLETE_BODY = '## Acceptance\nA1. The basket shows its total.\n\n## Brief\nWork in the basket page.\n';

function changeOf(board: Board): TrackerChange {
  // The job and decision appliers read only the Board and the stamp of the hold.
  return { board, at: AT } as unknown as TrackerChange;
}

function apply(board: Board, command: ControlCommand): unknown {
  return ControlService.apply(command, changeOf(board)).result;
}

function loggedKindsOf(result: unknown): string[] {
  return (result as { logged: { kind: string }[] }).logged.map((record) => record.kind);
}

function draftFiledBy(id: string, jobId: string, body = COMPLETE_BODY): Ticket {
  return {
    ...ticketFixture({
      id, status: 'draft', filedByJob: jobId, title: `Example draft ${id}`
    }),
    body
  };
}

function wordingOf(draft: DecisionDraft): DecisionWording {
  const options = [...(draft.readyDrafts?.proposedSets ?? []).map((draftSet) => ({ label: `Ready #${draftSet.join(', #')}`, description: '' })),
    { label: 'None', description: '' }];
  return {
    questions: [{
      question: 'Ready which?', header: 'ready-drafts', multiSelect: false, options
    }],
    context: ''
  };
}

function runningBuildBoard(): Board {
  const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress' })] });
  const { job } = board.launchJob({
    kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main'
  }, AT);
  board.moveJob(job.id, 'preparing', AT);
  board.moveJob(job.id, 'running', AT);
  return board;
}

describe('job stop and wind-down', () => {
  test('wind-down logs its mode and holds the ticket "wound down by User (J1)" in the same hold, leaving the job running', () => {
    const board = runningBuildBoard();
    const result = apply(board, { kind: 'job-stop', jobId: 'J1', mode: 'wind-down' });

    expect(loggedKindsOf(result)).toEqual(['job-stop-requested', 'ticket-held']);
    expect(board.tickets()[0]?.frontmatter.hold).toBe('wound down by User (J1)');
    expect(board.jobById('J1')).toMatchObject({ state: 'running', stopRequest: 'wind-down' });
  });

  test('stop holds the ticket "stopped by User (J1)" and moves a running job to stopping for the runner to stop', () => {
    const board = runningBuildBoard();
    apply(board, { kind: 'job-stop', jobId: 'J1', mode: 'stop' });

    expect(board.tickets()[0]?.frontmatter.hold).toBe('stopped by User (J1)');
    expect(board.jobById('J1')?.state).toBe('stopping');
  });

  test('stop before a host exists holds the ticket and ends the job stopped in the same hold', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    board.launchJob({
      kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main'
    }, AT);
    const result = apply(board, { kind: 'job-stop', jobId: 'J1', mode: 'stop' });

    expect(loggedKindsOf(result)).toEqual(['job-stop-requested', 'ticket-held', 'job-ended']);
    expect(board.jobById('J1')).toBeUndefined();
    expect(board.tickets()[0]?.frontmatter.hold).toBe('stopped by User (J1)');
  });

  test('fresh holds nothing, and is refused job-has-no-ticket for a product owner', () => {
    const board = runningBuildBoard();
    apply(board, { kind: 'job-fresh', jobId: 'J1' });
    expect(board.tickets()[0]?.frontmatter.hold).toBeUndefined();
    expect(board.jobById('J1')).toMatchObject({ state: 'stopping', stopRequest: 'fresh' });

    apply(board, { kind: 'intake-start', text: 'A basket' });
    expect(refusalDetailOf(() => apply(board, { kind: 'job-fresh', jobId: 'J2' }))).toEqual({ reason: 'job-has-no-ticket', jobId: 'J2' });
  });

  test('stop --all pauses the board and stops every build, review and product-owner job', () => {
    const board = runningBuildBoard();
    board.setDispatcherState('running', null, AT);
    apply(board, { kind: 'intake-start', text: 'A basket' });
    const result = apply(board, { kind: 'job-stop-all', mode: 'stop' });

    expect(loggedKindsOf(result)).toEqual(['dispatcher-set', 'job-stop-requested', 'ticket-held', 'job-stop-requested']);
    expect(board.dispatcherState()).toBe('stopped');
    expect(board.jobs().map((job) => job.state)).toEqual(['stopping', 'stopping']);
  });
});

describe('job message', () => {
  test('logs job-messaged with the text for a live job', () => {
    const board = runningBuildBoard();
    const result = apply(board, { kind: 'job-message', jobId: 'J1', text: 'Keep the basket page.' });

    expect((result as { logged: unknown[] }).logged).toEqual([{
      kind: 'job-messaged', jobId: 'J1', fields: { text: 'Keep the basket page.' }, at: AT
    }]);
  });

  test('a finished job, or a session whose input is closing, is refused job-finished, worded by the adapter', () => {
    const board = runningBuildBoard();
    board.endJob('J1', { outcome: 'failed' }, AT);
    expect(refusalDetailOf(() => apply(board, { kind: 'job-message', jobId: 'J1', text: 'Hello' }))).toEqual({ reason: 'job-finished', jobId: 'J1' });

    apply(board, { kind: 'intake-start', text: 'A basket' });
    apply(board, { kind: 'intake-close', jobId: 'J2', proposedDraftSets: [] });
    expect(refusalDetailOf(() => apply(board, { kind: 'job-message', jobId: 'J2', text: 'Hello' }))).toEqual({ reason: 'job-finished', jobId: 'J2' });
  });

  test('a finished reviewer, a closed orchestrator and a product owner replaced past its bound are refused job-finished', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-review' })] });
    board.launchJob({
      kind: 'review', role: 'reviewer', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main'
    }, AT);
    board.endJob('J1', { outcome: 'reviewed' }, AT);
    board.launchJob({
      kind: 'orchestrator', role: 'orchestrator', ticketIds: [], parentJobId: null, attempt: 1, target: null
    }, AT);
    board.endJob('J2', { outcome: 'closed' }, AT);
    apply(board, { kind: 'intake-start', text: 'A basket' });
    // What the refresh past the bound does to the session it replaces.
    board.endJob('J3', { outcome: 'replaced' }, AT);

    for (const jobId of ['J1', 'J2', 'J3']) {
      expect(refusalDetailOf(() => apply(board, { kind: 'job-message', jobId, text: 'Hello' }))).toEqual({ reason: 'job-finished', jobId });
    }
    expect(board.jobs()).toEqual([]);
  });

  test('a closed product owner is reopened: back on the board running its next host instance, the reopening logged with the message', () => {
    const { board } = boardFixture({ tickets: [draftFiledBy('004', 'J1')] });
    apply(board, { kind: 'intake-start', text: 'A basket' });
    board.moveJob('J1', 'running', AT);
    apply(board, { kind: 'intake-close', jobId: 'J1', proposedDraftSets: [] });
    board.endIntakeJob('J1', TicketAcceptanceUtil.readinessGapsOf, wordingOf, AT);
    const result = apply(board, { kind: 'job-message', jobId: 'J1', text: 'Add a wishlist too.' });

    expect((result as { logged: unknown[] }).logged).toEqual([{
      kind: 'job-reopened', jobId: 'J1', fields: { hostInstance: 2, text: 'Add a wishlist too.', offeredTicketIds: ['004'] }, at: AT
    }]);
    expect(board.jobById('J1')).toMatchObject({
      kind: 'product-owner', role: 'product-owner', state: 'running', hostInstance: 2, eventCursor: { instance: 2, sequence: 0 }
    });
  });

  test('a product owner stopped by User is reopened the same way', () => {
    const { board } = boardFixture();
    apply(board, { kind: 'intake-start', text: 'A basket' });
    apply(board, { kind: 'job-stop', jobId: 'J1', mode: 'stop' });
    board.endIntakeJob('J1', TicketAcceptanceUtil.readinessGapsOf, wordingOf, AT);
    apply(board, { kind: 'job-message', jobId: 'J1', text: 'Carry on.' });
    expect(board.jobById('J1')).toMatchObject({ state: 'running', hostInstance: 2 });
  });
});

describe('intake', () => {
  test('intake-start records a launching product-owner job with no ticket, its request kept on the job', () => {
    const { board } = boardFixture();
    apply(board, { kind: 'intake-start', text: 'A basket' });
    apply(board, { kind: 'intake-start', text: 'A wishlist' });

    expect(board.jobs().map((job) => [job.kind, job.role, job.state, job.ticketIds, job.intake?.text])).toEqual([
      ['product-owner', 'product-owner', 'launching', [], 'A basket'],
      ['product-owner', 'product-owner', 'launching', [], 'A wishlist'],
    ]);
    expect(board.concurrency().agentsInFlight).toBe(0);
  });

  test('intake close of another kind of job is refused job-not-intake', () => {
    const board = runningBuildBoard();
    expect(refusalDetailOf(() => apply(board, { kind: 'intake-close', jobId: 'J1', proposedDraftSets: [] }))).toEqual({ reason: 'job-not-intake', jobId: 'J1', kind: 'build' });
  });

  test('a closed intake ends closed and opens ready-drafts listing its drafts; the answer readies the chosen set in its hold', () => {
    const { board } = boardFixture({ tickets: [draftFiledBy('004', 'J1'), draftFiledBy('005', 'J1'), draftFiledBy('006', 'J1', ''), draftFiledBy('007', 'J9')] });
    apply(board, { kind: 'intake-start', text: 'A basket' });
    apply(board, { kind: 'intake-close', jobId: 'J1', proposedDraftSets: [['4', '6'], ['004', '005']] });
    const ended = board.endIntakeJob('J1', TicketAcceptanceUtil.readinessGapsOf, wordingOf, AT);

    expect(ended.logged.map((record) => record.kind)).toEqual(['job-ended', 'decision-opened']);
    const [decision] = board.decisions();
    expect(decision).toMatchObject({ kind: 'ready-drafts', ticketIds: ['004', '005', '006'], askedBy: 'runner' });
    expect(decision?.questions[0]?.options.map((option) => option.label)).toEqual(['Ready #004', 'Ready #004, #005', 'None']);

    const answered = apply(board, { kind: 'decision-answer', decisionId: 'E1', answer: { form: 'letters', choices: ['b'] } });
    expect(loggedKindsOf(answered)).toEqual(['decision-answered', 'ticket-readied', 'ticket-readied']);
    expect(board.tickets().map((ticket) => ticket.frontmatter.status)).toEqual(['pending', 'pending', 'draft', 'draft']);
  });

  test('a free-text ready-drafts answer readies only the drafts the decision lists, an unpadded mention included', () => {
    const { board } = boardFixture({ tickets: [draftFiledBy('004', 'J1'), draftFiledBy('007', 'J9')] });
    apply(board, { kind: 'intake-start', text: 'A basket' });
    apply(board, { kind: 'intake-close', jobId: 'J1', proposedDraftSets: [['004']] });
    board.endIntakeJob('J1', TicketAcceptanceUtil.readinessGapsOf, wordingOf, AT);
    expect(board.decisions()[0]?.ticketIds).toEqual(['004']);

    const answered = apply(board, { kind: 'decision-answer', decisionId: 'E1', answer: { form: 'text', text: 'Ready #4 and #7' } });
    expect(loggedKindsOf(answered)).toEqual(['decision-answered', 'ticket-readied']);
    expect(board.tickets().map((ticket) => ticket.frontmatter.status)).toEqual(['pending', 'draft']);
  });

  test('a reopened product owner files and closes again: the second ready-drafts lists only the drafts filed since the reopening', () => {
    const { board } = boardFixture({ tickets: [draftFiledBy('004', 'J1'), draftFiledBy('005', 'J1')] });
    apply(board, { kind: 'intake-start', text: 'A basket' });
    apply(board, { kind: 'intake-close', jobId: 'J1', proposedDraftSets: [] });
    board.endIntakeJob('J1', TicketAcceptanceUtil.readinessGapsOf, wordingOf, AT);
    apply(board, { kind: 'job-message', jobId: 'J1', text: 'Add a wishlist too.' });
    board.fileTicket(draftFiledBy('006', 'J1'), AT);
    apply(board, { kind: 'intake-close', jobId: 'J1', proposedDraftSets: [['004', '006']] });
    const ended = board.endIntakeJob('J1', TicketAcceptanceUtil.readinessGapsOf, wordingOf, AT);

    expect(ended.logged.map((record) => record.kind)).toEqual(['job-ended', 'decision-opened']);
    expect(board.decisions().map((decision) => decision.ticketIds)).toEqual([['004', '005'], ['006']]);
    expect(board.decisions()[1]?.questions[0]?.options.map((option) => option.label)).toEqual(['Ready #006', 'None']);
    expect(board.jobById('J1')).toBeUndefined();
  });

  test('a stopped product owner withdraws its open questions in the same hold, its drafts staying drafts', () => {
    const { board } = boardFixture({ tickets: [draftFiledBy('004', 'J1')] });
    apply(board, { kind: 'intake-start', text: 'A basket' });
    board.openDecision({
      kind:      'agent-question',
      ticketIds: [],
      jobId:     'J1',
      askedBy:   'product-owner',
      requestId: 'request-1',
      questions: wordingOf({ kind: 'agent-question', ticketIds: [], jobId: 'J1' }).questions,
      context:   '',
    }, AT);
    const result = apply(board, { kind: 'job-stop', jobId: 'J1', mode: 'stop' });

    expect(loggedKindsOf(result)).toEqual(['job-stop-requested', 'decision-withdrawn']);
    expect(board.decisions()).toEqual([]);
    expect(board.jobById('J1')?.state).toBe('stopping');
    expect(board.tickets()[0]?.frontmatter.status).toBe('draft');
  });
});

describe('moves naming an incident', () => {
  function quietJobBoard(): Board {
    const board = runningBuildBoard();
    board.openIncident({
      kind: 'quiet-job', ticketIds: ['001'], jobId: 'J1', facts: {}, defaultMove: 'open-quiet-job-decision'
    }, AT);
    return board;
  }

  test('job message under an incident its kind allows is logged and marks it handled in the same hold', () => {
    const board  = quietJobBoard();
    const result = apply(board, {
      kind: 'job-message', jobId: 'J1', text: 'Commit what you have.', incidentId: 'I1'
    });
    expect(loggedKindsOf(result)).toEqual(['job-messaged', 'incident-handled']);
    expect(board.incidents()).toEqual([]);
  });

  test('a move the incident\'s kind does not allow is refused incident-move-not-allowed, whoever names it', () => {
    const board = quietJobBoard();
    const refusedDetail = { kind: 'role-command-refused', reason: 'incident-move-not-allowed', commandKind: 'incident-answer' };
    expect(() => apply(board, { kind: 'incident-answer', incidentId: 'I1', text: 'bun' })).toThrow(expect.objectContaining({ detail: refusedDetail }) as Error);
  });

  test('job message under an incident is refused to a job waiting on User, to one whose ticket has an open agent-question, and to a product owner', () => {
    const waiting = quietJobBoard();
    waiting.moveJob('J1', 'waiting-for-answer', AT);
    expect(refusalDetailOf(() => apply(waiting, {
      kind: 'job-message', jobId: 'J1', text: 'Go on.', incidentId: 'I1'
    })))
      .toEqual({ reason: 'job-awaits-user-answer', jobId: 'J1' });

    const asked = quietJobBoard();
    asked.openDecision({
      kind:      'agent-question',
      ticketIds: ['001'],
      jobId:     null,
      askedBy:   'builder',
      requestId: 'request-1',
      questions: [{
        question: 'Which?', header: 'h', multiSelect: false, options: []
      }],
      context: '',
    }, AT);
    expect(refusalDetailOf(() => apply(asked, {
      kind: 'job-message', jobId: 'J1', text: 'Go on.', incidentId: 'I1'
    })))
      .toEqual({ reason: 'job-awaits-user-answer', jobId: 'J1' });

    const intake = runningBuildBoard();
    intake.startIntake('Alex Example asks for a basket.', AT);
    intake.openIncident({
      kind: 'quiet-job', ticketIds: [], jobId: 'J2', facts: {}, defaultMove: 'open-quiet-job-decision'
    }, AT);
    expect(refusalDetailOf(() => apply(intake, {
      kind: 'job-message', jobId: 'J2', text: 'Go on.', incidentId: 'I1'
    })))
      .toEqual({ reason: 'job-is-product-owner', jobId: 'J2' });
  });

  test('job fresh under a system-question marks it handled and asks for the fresh agent', () => {
    const board = runningBuildBoard();
    board.openIncident({
      kind: 'system-question', ticketIds: ['001'], jobId: 'J1', facts: { requestId: 'request-1' }, defaultMove: 'incident-escalate'
    }, AT);
    expect(loggedKindsOf(apply(board, { kind: 'job-fresh', jobId: 'J1', incidentId: 'I1' }))).toEqual(['job-stop-requested', 'incident-handled']);
  });
});

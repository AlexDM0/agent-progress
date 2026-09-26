/**
 * The dispatcher's reading of `ticket hold` as claims, shared by the hold suite: each a scenario, what must hold after it, and the mutant that
 * breaks exactly that decision.
 */
import type {
  DispatchScenario,
  FakeBoard,
  RecordedAgentCall,
  RecordedDispatchRun
} from '../DispatchScriptHarness.ts';
import {
  DISPATCHER_MODULE_PATHS,
  kindsAndTickets,
  runSummaryOf,
  type DispatchClaim
} from './DispatchClaim.ts';

const { DISPATCH_RUN, AGENT_PROMPT_UTIL } = DISPATCHER_MODULE_PATHS;

const HELD_TICKET_ID = '001';

function callsOf(run: RecordedDispatchRun, kind: string, ticketId: string): RecordedAgentCall[] {
  return run.calls.filter((call) => call.kind === kind && call.ticketId === ticketId);
}

function removeHold(board: FakeBoard, ticketId: string): void {
  board.heldTicketIds = board.heldTicketIds.filter((heldTicketId) => heldTicketId !== ticketId);
}

/** #001 is held as its builder finishes, before that builder's status block is taken, and unheld as #003's builder finishes. */
const HELD_WHILE_ITS_BUILDER_RUNS: DispatchScenario = {
  limit:          2,
  readyTicketIds: ['001', '002', '003'],
  afterAgent:     (call, board) => {
    if (call.kind === 'build' && call.ticketId === HELD_TICKET_ID) board.heldTicketIds.push(HELD_TICKET_ID);
    if (call.kind === 'build' && call.ticketId === '003') removeHold(board, HELD_TICKET_ID);
  },
};

/** The same hold, never lifted. */
const HELD_AND_NEVER_UNHELD: DispatchScenario = {
  limit:          2,
  readyTicketIds: ['001', '002'],
  afterAgent:     (call, board) => {
    if (call.kind === 'build' && call.ticketId === HELD_TICKET_ID) board.heldTicketIds.push(HELD_TICKET_ID);
  },
};

/** #001's build was left paused by an earlier whole-board run's hold; the orchestrator launches a run for it alone once it is unheld. */
const PAUSED_BUILD_RESUMED_ALONE: DispatchScenario = {
  limit:                      2,
  readyTicketIds:             [],
  ticketIds:                  [HELD_TICKET_ID],
  pausedBuildNotesByTicketId: { [HELD_TICKET_ID]: `Built by the whole-board dispatcher run on ticket-${HELD_TICKET_ID}` },
};

/** #001's first builder stops short and the ticket is held as it returns, so its row is paused; the hold lifts while #002 is reviewed. */
const HELD_AFTER_ITS_BUILDER_STOPPED_SHORT: DispatchScenario = {
  limit:          2,
  readyTicketIds: ['001', '002'],
  builderReply:   (ticketId, pass) => (ticketId === HELD_TICKET_ID && pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
  afterAgent:     (call, board) => {
    if (call.kind === 'build' && call.ticketId === HELD_TICKET_ID && call.ordinal === 1) board.heldTicketIds.push(HELD_TICKET_ID);
    if (call.kind === 'review' && call.ticketId === '002') removeHold(board, HELD_TICKET_ID);
  },
};

/** #007 is held from the start; the hold lifts as #008's review returns, while #009's review still waits in the queue at a limit of 1. */
const HOLD_LIFTED_WHILE_A_REVIEW_WAITS: DispatchScenario = {
  limit:                  1,
  readyTicketIds:         [],
  reviewWaitingTicketIds: ['007', '008', '009'],
  heldTicketIds:          ['007'],
  afterAgent:             (call, board) => {
    if (call.kind === 'review' && call.ticketId === '008') removeHold(board, '007');
  },
};

/**
 * Every review but #008's does not hold, so rebuilds queue; #007 is held as its review returns and unheld as #009's rebuild returns, with #010's
 * rebuild still queued.
 */
const HOLD_LIFTED_WHILE_A_REBUILD_WAITS: DispatchScenario = {
  limit:                  1,
  readyTicketIds:         [],
  reviewWaitingTicketIds: ['007', '008', '009', '010'],
  reviewerReply:          (ticketId, round) => (round === 1 && ticketId !== '008' ? { verdict: 'does-not-hold' } : { verdict: 'released' }),
  afterAgent:             (call, board) => {
    if (call.kind === 'review' && call.ticketId === '007') board.heldTicketIds.push('007');
    if (call.kind === 'build' && call.ticketId === '009') removeHold(board, '007');
  },
};

/** #008 is held and the board stopped as #007's review returns, so the stop ends the run with #008's review still queued. */
const HELD_AND_STOPPED_WHILE_ITS_REVIEW_WAITS: DispatchScenario = {
  limit:                  1,
  readyTicketIds:         [],
  reviewWaitingTicketIds: ['007', '008'],
  afterAgent:             (call, board) => {
    if (call.kind === 'review' && call.ticketId === '007') {
      board.heldTicketIds.push('008');
      board.dispatcherState = 'stopped';
    }
  },
};

/** #001 is held as its failed first builder returns and unheld as the board stops; every agent after that returns with #001 held again. */
const HELD_TAKEOVER_UNHELD_AS_THE_BOARD_STOPS_AND_HELD_AGAIN: DispatchScenario = {
  limit:                   3,
  readyTicketIds:          ['001', '002', '003'],
  turnsBeforeFirstCommand: 1,
  builderReply:            (ticketId, pass) => (ticketId === HELD_TICKET_ID && pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
  afterAgent:              (call, board) => {
    if (call.kind === 'build' && call.ticketId === HELD_TICKET_ID) board.heldTicketIds.push(HELD_TICKET_ID);
    if (call.kind === 'park' && call.ticketId === HELD_TICKET_ID) {
      removeHold(board, HELD_TICKET_ID);
      board.dispatcherState = 'stopped';
    }
    if (call.kind !== 'park' && board.dispatcherState === 'stopped' && call.ticketId !== HELD_TICKET_ID) board.heldTicketIds = [HELD_TICKET_ID];
  },
};

/** #001 is held as its builder hands its review bar on, and unheld as the parking agent releases that bar; no status block lists the rows. */
const HELD_REVIEW_TAKEOVER_UNHELD_WITHOUT_LISTED_ROWS: DispatchScenario = {
  limit:                     2,
  readyTicketIds:            ['001', '002', '003', '004'],
  turnsBeforeFirstCommand:   0,
  statusOmitsInProgressRows: true,
  afterAgent:                (call, board) => {
    if (call.kind === 'build' && call.ticketId === HELD_TICKET_ID) board.heldTicketIds.push(HELD_TICKET_ID);
    if (call.kind === 'park' && call.ticketId === HELD_TICKET_ID) removeHold(board, HELD_TICKET_ID);
  },
};

function ticketOrderOf(run: RecordedDispatchRun, kind: string): string[] {
  return run.calls.filter((call) => call.kind === kind).map((call) => call.ticketId ?? '');
}

const PAUSED_ROW_RESUMPTION_SOURCE_LINE = '    + pausedRowResumptionText(settings, ticketId, previousPass, takeoverText)\n';

function lastBlockBeforeShowsHeld(run: RecordedDispatchRun, call: RecordedAgentCall, ticketId: string): boolean {
  return run.heldTicketIdsReturned[call.statusBlocksReturnedBefore - 1]?.includes(ticketId) ?? false;
}

/** The index of the first status block showing the ticket unheld after one showed it held; -1 when none did. */
function firstBlockShowingTheHoldLifted(run: RecordedDispatchRun, ticketId: string): number {
  const firstHeld = run.heldTicketIdsReturned.findIndex((heldTicketIds) => heldTicketIds.includes(ticketId));
  if (firstHeld === -1) return -1;
  return run.heldTicketIdsReturned.findIndex((heldTicketIds, index) => index > firstHeld && !heldTicketIds.includes(ticketId));
}

function reviewerWaitedForTheUnhold(run: RecordedDispatchRun): boolean {
  const reviewers = callsOf(run, 'review', HELD_TICKET_ID);
  const [firstReviewer] = reviewers;
  const unholdBlock = firstBlockShowingTheHoldLifted(run, HELD_TICKET_ID);
  return firstReviewer !== undefined
    && unholdBlock !== -1
    && reviewers.every((reviewer) => !lastBlockBeforeShowsHeld(run, reviewer, HELD_TICKET_ID))
    && firstReviewer.statusBlocksReturnedBefore === unholdBlock + 1;
}

export const HOLD_CLAIMS: readonly DispatchClaim[] = [
  {
    // The fail-review claim: no reviewer agent() call for a held ticket until a returned status block shows its unhold.
    name:        'a ticket held while its builder runs is not reviewed until unheld, and its reviewer starts at the first board read after the unhold',
    scenarioFor: () => HELD_WHILE_ITS_BUILDER_RUNS,
    holds:       reviewerWaitedForTheUnhold,
    mutant:      { modulePath: DISPATCH_RUN, find: 'if (!this.ticketIsHeld(takeover.ticketId)) return takeover;', replace: 'return takeover;' },
  },
  {
    name:        'a held ticket\'s step starts once a returned status block shows the hold lifted',
    scenarioFor: () => HELD_WHILE_ITS_BUILDER_RUNS,
    holds:       (run) => runSummaryOf(run).delivered.includes(HELD_TICKET_ID) && runSummaryOf(run).held === undefined,
    mutant:      { modulePath: DISPATCH_RUN, find: '    this.resumeUnheldWork();\n', replace: '' },
  },
  {
    name:        'other tickets keep flowing while one is held, and the agents alive never exceed the limit',
    scenarioFor: () => HELD_WHILE_ITS_BUILDER_RUNS,
    holds:       (run) => ['002', '003'].every((ticketId) => runSummaryOf(run).delivered.includes(ticketId))
      && run.mostLiveAgentsAtOnce <= 2
      && run.mostAgentsInFlightAtOnce <= 2,
    // The mutant keeps the held step at the head of the queue, so everything behind it waits with it.
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '        this.holdBack(takeover, true);\n',
      replace:    '        this.takeoversWaiting.set(this.takeoverKeyOf(takeover), takeover);\n        return null;\n',
    },
  },
  {
    name:        'a held ready ticket is not built, and the run returns it as held for a build',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['001', '002'], heldTicketIds: [HELD_TICKET_ID] }),
    holds:       (run) => callsOf(run, 'build', HELD_TICKET_ID).length === 0
      && runSummaryOf(run).delivered.join() === '002'
      && JSON.stringify(runSummaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'build' }]),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '.filter((ticketId) => !this.ticketIsHeld(ticketId) && !this.ticketIdsTakenThisRun',
      replace:    '.filter((ticketId) => !this.ticketIdsTakenThisRun',
    },
  },
  {
    name:        'a run ending with a ticket still held returns it in held, waiting for its review',
    scenarioFor: () => HELD_AND_NEVER_UNHELD,
    holds:       (run) => callsOf(run, 'review', HELD_TICKET_ID).length === 0
      && JSON.stringify(runSummaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'review' }]),
    mutant: { modulePath: DISPATCH_RUN, find: 'held:                    this.heldEntries(),', replace: 'held:                    [],' },
  },
  {
    // A stop can end the run before a queued step's turn comes round to find its hold, and the orchestrator must still hear of it as held.
    name:        'a stop that ends the run with a held review still queued returns it under held, waiting for its review',
    scenarioFor: () => HELD_AND_STOPPED_WHILE_ITS_REVIEW_WAITS,
    holds:       (run) => JSON.stringify(runSummaryOf(run).held) === JSON.stringify([{ id: '008', waitingFor: 'review' }]),
    mutant:      {
      modulePath: DISPATCH_RUN,
      find:       '[...this.heldWork.values(), ...this.takeoversWaiting.values(), ...this.reviewQueue, ...this.rebuildQueue]',
      replace:    '[...this.heldWork.values()]',
    },
  },
  {
    // A held review waits for the unhold, not for the next run's survey, so naming it among the reviews left would send the relaunch to it.
    name:        'the same held review is named under held, never among the reviews left',
    scenarioFor: () => HELD_AND_STOPPED_WHILE_ITS_REVIEW_WAITS,
    holds:       (run) => runSummaryOf(run).reviewsLeft === undefined,
    mutant:      { modulePath: DISPATCH_RUN, find: 'work.kind === \'review\' && !this.ticketIsHeld(work.ticketId)', replace: 'work.kind === \'review\'' },
  },
  {
    // The user's go does not start a held ticket, so the log names it once, among the held.
    name:        'the same held review is left out of the log of tickets left waiting',
    scenarioFor: () => HELD_AND_STOPPED_WHILE_ITS_REVIEW_WAITS,
    holds:       (run) => !run.logs.some((message) => message.includes('Left for the user\'s go'))
      && run.logs.some((message) => message.includes('Held, for the next run once unheld: #008 (review).')),
    mutant: { modulePath: DISPATCH_RUN, find: 'leftWaiting.filter((ticketId) => !this.ticketIsHeld(ticketId))', replace: 'leftWaiting' },
  },
  {
    // A queued step, not a takeover: the survey's in-review ticket and a rebuild after a review that did not hold reach the queue this way.
    name:        'a held ticket the survey found waiting for review gets no reviewer, and the run returns it as held for a review',
    scenarioFor: () => ({
      limit:                  2,
      readyTicketIds:         ['002'],
      reviewWaitingTicketIds: [HELD_TICKET_ID],
      heldTicketIds:          [HELD_TICKET_ID],
    }),
    holds: (run) => callsOf(run, 'review', HELD_TICKET_ID).length === 0
      && runSummaryOf(run).delivered.join() === '002'
      && JSON.stringify(runSummaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'review' }]),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '      if (!this.ticketIsHeld(queued.ticketId)) return queued;\n      this.holdBack(queued, false);\n',
      replace:    '      return queued;\n',
    },
  },
  {
    // A bar left running for a held ticket would count against the limit for as long as the hold lasts.
    name:        'the review bar a builder handed on to a held ticket\'s reviewer is released, not left holding a slot',
    scenarioFor: () => HELD_AND_NEVER_UNHELD,
    holds:       (run) => run.rowsRunningAtEnd.length === 0 && callsOf(run, 'park', HELD_TICKET_ID).length === 1,
    mutant:      {
      modulePath: DISPATCH_RUN,
      find:       '        return { kind: \'park\', ticketId: takeover.ticketId, release: { cause: \'held\' } };',
      replace:    '        continue;',
    },
  },
  {
    // A single-ticket run starts its builder before any status block, so only its arguments can tell it of the hold.
    name:        'a single-ticket run for a held ticket starts no builder, told of the hold by its readyTickets entry',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001'],
      ticketIds:      [HELD_TICKET_ID],
      heldTicketIds:  [HELD_TICKET_ID],
    }),
    holds:  (run) => run.calls.length === 0 && JSON.stringify(runSummaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'build' }]),
    mutant: { modulePath: DISPATCH_RUN, find: 'settings.readyTickets.filter((entry) => entry.ticketIsHeld)', replace: 'settings.readyTickets.filter(() => false)' },
  },
  {
    // The fail-review claim: an in-progress ticket is on no ready list, so a run named for it is the only way its paused build is ever finished.
    name:        'a single-ticket run for an in-progress ticket whose build another run left paused takes it over and delivers it, one agent in flight at most',
    scenarioFor: () => PAUSED_BUILD_RESUMED_ALONE,
    holds:       (run) => runSummaryOf(run).delivered.join() === HELD_TICKET_ID
      && callsOf(run, 'build', HELD_TICKET_ID).length === 1
      && run.mostAgentsInFlightAtOnce <= 1
      && run.mostAgentsOnBoardAtOnce <= 1
      && run.rowsPaused.length === 0
      && run.rowsRunningAtEnd.length === 0,
    mutant: {
      modulePath: AGENT_PROMPT_UTIL,
      find:       '  const takeoverText = pausedBuildTakeoverText(settings, ticketId, pausedBuildWasFoundBySurvey);\n',
      replace:    '  const takeoverText = \'\';\n',
    },
  },
  {
    name:        'the same takeover resumes the paused row, so the build holds its slot while it runs',
    scenarioFor: () => PAUSED_BUILD_RESUMED_ALONE,
    holds:       (run) => runSummaryOf(run).delivered.join() === HELD_TICKET_ID && run.buildersOnBoard.join() === `main build ${HELD_TICKET_ID}`,
    mutant:      { modulePath: AGENT_PROMPT_UTIL, find: PAUSED_ROW_RESUMPTION_SOURCE_LINE, replace: '' },
  },
  {
    // Within one run the same resume applies: the held takeover's row was paused by a parking agent, and the rebuild after the unhold carries on past it.
    name:        'a builder resumed after an unhold in the same run carries on past its own paused row and the ticket is delivered',
    scenarioFor: () => HELD_AFTER_ITS_BUILDER_STOPPED_SHORT,
    holds:       (run) => ['001', '002'].every((ticketId) => runSummaryOf(run).delivered.includes(ticketId))
      && callsOf(run, 'build', HELD_TICKET_ID).length === 2
      && callsOf(run, 'park', HELD_TICKET_ID).length === 1
      && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: AGENT_PROMPT_UTIL, find: PAUSED_ROW_RESUMPTION_SOURCE_LINE, replace: '' },
  },
  {
    // The step was due when the hold stopped it, so it goes ahead of work queued behind it meanwhile, as a takeover would have.
    name:        'an unheld review goes to the front of the queue, ahead of a review that waited behind it',
    scenarioFor: () => HOLD_LIFTED_WHILE_A_REVIEW_WAITS,
    holds:       (run) => ticketOrderOf(run, 'review').join() === '008,007,009',
    mutant:      {
      modulePath: DISPATCH_RUN,
      find:       'if (work.kind === \'review\') this.reviewQueue.unshift(work);',
      replace:    'if (work.kind === \'review\') this.reviewQueue.push(work);',
    },
  },
  {
    name:        'an unheld rebuild goes to the front of the queue, ahead of a rebuild that waited behind it',
    scenarioFor: () => HOLD_LIFTED_WHILE_A_REBUILD_WAITS,
    holds:       (run) => ticketOrderOf(run, 'build').join() === '009,007,010',
    mutant:      { modulePath: DISPATCH_RUN, find: 'else this.rebuildQueue.unshift(work);', replace: 'else this.rebuildQueue.push(work);' },
  },
  {
    // A held build waits for the unhold, not for the next run's survey, so naming it among the paused builds would send the relaunch to it.
    name:        'a held takeover unheld as the board stops and held again before the run ends is listed as held, not among the paused builds',
    scenarioFor: () => HELD_TAKEOVER_UNHELD_AS_THE_BOARD_STOPS_AND_HELD_AGAIN,
    holds:       (run) => runSummaryOf(run).pausedBuilds === undefined
      && JSON.stringify(runSummaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'build' }]),
    mutant: { modulePath: DISPATCH_RUN, find: 'rebuild.rowIsPaused === true && !this.ticketIsHeld(rebuild.ticketId)', replace: 'rebuild.rowIsPaused === true' },
  },
  {
    // The parking agent released the handed-on bar, so a reviewer counted on it before the rows are listed would free a slot nobody holds.
    name:        'a held review takeover unheld later no longer counts as a bar handed on, so a status block without its in-progress rows does not free its slot',
    scenarioFor: () => HELD_REVIEW_TAKEOVER_UNHELD_WITHOUT_LISTED_ROWS,
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, build 002, park 001, review 002, review 001, build 003, build 004, review 003, review 004',
    mutant:      { modulePath: DISPATCH_RUN, find: '  const { barIsHandedOn, ...waitingReview } = work;\n', replace: '  const waitingReview = work;\n' },
  },
];

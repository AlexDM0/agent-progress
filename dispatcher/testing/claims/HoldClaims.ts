/**
 * The dispatcher's reading of `ticket hold` as claims, shared by the hold suite: each a scenario, what must hold after it, and the mutant that
 * breaks exactly that decision.
 */
import type {
  DispatchRun,
  DispatchScenario,
  FakeBoard,
  RecordedAgentCall
} from '../DispatchScriptHarness';
import { DISPATCHER_MODULE_PATHS, type DispatchClaim } from './DispatchClaim';

const { DISPATCH_RUN, AGENT_PROMPT_UTIL } = DISPATCHER_MODULE_PATHS;

interface HeldEntry {
  id:         string;
  waitingFor: string;
}

interface HoldSummary {
  delivered: string[];
  held?:     HeldEntry[];
}

const HELD_TICKET_ID = '001';

function summaryOf(run: DispatchRun): HoldSummary {
  return run.summary as HoldSummary;
}

function callsOf(run: DispatchRun, kind: string, ticketId: string): RecordedAgentCall[] {
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

const PAUSED_ROW_RESUMPTION_SOURCE_LINE = '    + pausedRowResumptionText(settings, ticketId, previousPass, takeoverText)\n';

function lastBlockBeforeShowsHeld(run: DispatchRun, call: RecordedAgentCall, ticketId: string): boolean {
  return run.heldTicketIdsReturned[call.statusBlocksReturnedBefore - 1]?.includes(ticketId) ?? false;
}

/** The index of the first status block showing the ticket unheld after one showed it held; -1 when none did. */
function firstBlockShowingTheHoldLifted(run: DispatchRun, ticketId: string): number {
  const firstHeld = run.heldTicketIdsReturned.findIndex((heldTicketIds) => heldTicketIds.includes(ticketId));
  if (firstHeld === -1) return -1;
  return run.heldTicketIdsReturned.findIndex((heldTicketIds, index) => index > firstHeld && !heldTicketIds.includes(ticketId));
}

function reviewerWaitedForTheUnhold(run: DispatchRun): boolean {
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
    holds:       (run) => summaryOf(run).delivered.includes(HELD_TICKET_ID) && summaryOf(run).held === undefined,
    mutant:      { modulePath: DISPATCH_RUN, find: '    this.resumeUnheldWork();\n', replace: '' },
  },
  {
    name:        'other tickets keep flowing while one is held, and the agents alive never exceed the limit',
    scenarioFor: () => HELD_WHILE_ITS_BUILDER_RUNS,
    holds:       (run) => ['002', '003'].every((ticketId) => summaryOf(run).delivered.includes(ticketId))
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
      && summaryOf(run).delivered.join() === '002'
      && JSON.stringify(summaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'build' }]),
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
      && JSON.stringify(summaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'review' }]),
    mutant: { modulePath: DISPATCH_RUN, find: 'held:               this.heldEntries(),', replace: 'held:               [],' },
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
      && summaryOf(run).delivered.join() === '002'
      && JSON.stringify(summaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'review' }]),
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
    holds:  (run) => run.calls.length === 0 && JSON.stringify(summaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'build' }]),
    mutant: { modulePath: DISPATCH_RUN, find: 'settings.readyTickets.filter((entry) => entry.held)', replace: 'settings.readyTickets.filter(() => false)' },
  },
  {
    // The fail-review claim: an in-progress ticket is on no ready list, so a run named for it is the only way its paused build is ever finished.
    name:        'a single-ticket run for an in-progress ticket whose build another run left paused takes it over and delivers it, one agent in flight at most',
    scenarioFor: () => PAUSED_BUILD_RESUMED_ALONE,
    holds:       (run) => summaryOf(run).delivered.join() === HELD_TICKET_ID
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
    holds:       (run) => summaryOf(run).delivered.join() === HELD_TICKET_ID && run.buildersOnBoard.join() === `main build ${HELD_TICKET_ID}`,
    mutant:      { modulePath: AGENT_PROMPT_UTIL, find: PAUSED_ROW_RESUMPTION_SOURCE_LINE, replace: '' },
  },
  {
    // Within one run the same resume applies: the held takeover's row was paused by a parking agent, and the rebuild after the unhold carries on past it.
    name:        'a builder resumed after an unhold in the same run carries on past its own paused row and the ticket is delivered',
    scenarioFor: () => HELD_AFTER_ITS_BUILDER_STOPPED_SHORT,
    holds:       (run) => ['001', '002'].every((ticketId) => summaryOf(run).delivered.includes(ticketId))
      && callsOf(run, 'build', HELD_TICKET_ID).length === 2
      && callsOf(run, 'park', HELD_TICKET_ID).length === 1
      && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: AGENT_PROMPT_UTIL, find: PAUSED_ROW_RESUMPTION_SOURCE_LINE, replace: '' },
  },
];

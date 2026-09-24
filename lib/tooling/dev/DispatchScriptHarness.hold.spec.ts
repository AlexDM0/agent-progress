/**
 * The dispatcher's reading of `ticket hold`, pinned like the rest of its decisions: each claim runs against the real script, where it must hold,
 * and against a mutant that breaks exactly that decision, where it must fail. The cases that matter are the ones a paused ticket relies on: no
 * builder or reviewer of a held ticket starts before a returned status block shows the hold lifted, the step starts at the first block that does,
 * a held ticket's row left running is released rather than holding a slot, the other tickets keep flowing within the limit, and a run that ends
 * first says what it left held.
 */
import { describe, expect, test } from 'bun:test';

import {
  readDispatchScript,
  runDispatchScript,
  type DispatchRun,
  type DispatchScenario,
  type FakeBoard,
  type RecordedAgentCall
} from './DispatchScriptHarness';

interface Mutant {
  find:    string;
  replace: string;
}

interface Claim {
  name:     string;
  scenario: DispatchScenario;
  holds:    (run: DispatchRun) => boolean;
  mutant:   Mutant;
}

interface HeldEntry {
  id:         string;
  waitingFor: string;
}

interface HoldSummary {
  delivered: string[];
  held?:     HeldEntry[];
}

const SCRIPT_SOURCE = readDispatchScript();

const HELD_TICKET_ID = '001';

function summaryOf(run: DispatchRun): HoldSummary {
  return run.summary as HoldSummary;
}

function callsOf(run: DispatchRun, kind: string, ticketId: string): RecordedAgentCall[] {
  return run.calls.filter((call) => call.kind === kind && call.ticketId === ticketId);
}

function kindsAndTickets(run: DispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
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

const PAUSED_ROW_RESUMPTION_SOURCE_LINE = '    + pausedRowResumptionText(ticketId, previousPass, takeoverText)\n';

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

const CLAIMS: Claim[] = [
  {
    // The fail-review claim: no reviewer agent() call for a held ticket until a returned status block shows its unhold.
    name:     'a ticket held while its builder runs is not reviewed until unheld, and its reviewer starts at the first board read after the unhold',
    scenario: HELD_WHILE_ITS_BUILDER_RUNS,
    holds:    reviewerWaitedForTheUnhold,
    mutant:   { find: 'if (!ticketIsHeld(takeover.ticketId)) return takeover;', replace: 'return takeover;' },
  },
  {
    name:     'a held ticket\'s step starts once a returned status block shows the hold lifted',
    scenario: HELD_WHILE_ITS_BUILDER_RUNS,
    holds:    (run) => summaryOf(run).delivered.includes(HELD_TICKET_ID) && summaryOf(run).held === undefined,
    mutant:   { find: '  resumeUnheldWork();\n', replace: '' },
  },
  {
    name:     'other tickets keep flowing while one is held, and the agents alive never exceed the limit',
    scenario: HELD_WHILE_ITS_BUILDER_RUNS,
    holds:    (run) => ['002', '003'].every((ticketId) => summaryOf(run).delivered.includes(ticketId))
      && run.mostLiveAgentsAtOnce <= 2
      && run.mostAgentsInFlightAtOnce <= 2,
    // The mutant keeps the held step at the head of the queue, so everything behind it waits with it.
    mutant: { find: '      holdBack(takeover, true);\n', replace: '      takeoversWaiting.set(takeoverKeyOf(takeover), takeover);\n      return null;\n' },
  },
  {
    name:     'a held ready ticket is not built, and the run returns it as held for a build',
    scenario: { limit: 2, readyTicketIds: ['001', '002'], heldTicketIds: [HELD_TICKET_ID] },
    holds:    (run) => callsOf(run, 'build', HELD_TICKET_ID).length === 0
      && summaryOf(run).delivered.join() === '002'
      && JSON.stringify(summaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'build' }]),
    mutant: { find: '.filter((ticketId) => !ticketIsHeld(ticketId) && !ticketIdsTakenThisRun', replace: '.filter((ticketId) => !ticketIdsTakenThisRun' },
  },
  {
    name:     'a run ending with a ticket still held returns it in held, waiting for its review',
    scenario: HELD_AND_NEVER_UNHELD,
    holds:    (run) => callsOf(run, 'review', HELD_TICKET_ID).length === 0
      && JSON.stringify(summaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'review' }]),
    mutant: { find: '    ...(held.length > 0 ? { held } : {}),\n', replace: '' },
  },
  {
    // A queued step, not a takeover: the survey's in-review ticket and a rebuild after a review that did not hold reach the queue this way.
    name:     'a held ticket the survey found waiting for review gets no reviewer, and the run returns it as held for a review',
    scenario: {
      limit:                  2,
      readyTicketIds:         ['002'],
      reviewWaitingTicketIds: [HELD_TICKET_ID],
      heldTicketIds:          [HELD_TICKET_ID],
    },
    holds: (run) => callsOf(run, 'review', HELD_TICKET_ID).length === 0
      && summaryOf(run).delivered.join() === '002'
      && JSON.stringify(summaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'review' }]),
    mutant: { find: '    if (!ticketIsHeld(queued.ticketId)) return queued;\n    holdBack(queued, false);\n', replace: '    return queued;\n' },
  },
  {
    // A bar left running for a held ticket would count against the limit for as long as the hold lasts.
    name:     'the review bar a builder handed on to a held ticket\'s reviewer is released, not left holding a slot',
    scenario: HELD_AND_NEVER_UNHELD,
    holds:    (run) => run.rowsRunningAtEnd.length === 0 && callsOf(run, 'park', HELD_TICKET_ID).length === 1,
    mutant:   { find: '      return { kind: \'park\', ticketId: takeover.ticketId, boardLogLine: `Paused the rows of #${takeover.ticketId}: held` };', replace: '      continue;' },
  },
  {
    // A single-ticket run starts its builder before any status block, so only its arguments can tell it of the hold.
    name:     'a single-ticket run for a held ticket starts no builder, told of the hold by its readyTickets entry',
    scenario: {
      limit:          2,
      readyTicketIds: ['001'],
      ticketIds:      [HELD_TICKET_ID],
      heldTicketIds:  [HELD_TICKET_ID],
    },
    holds:  (run) => run.calls.length === 0 && JSON.stringify(summaryOf(run).held) === JSON.stringify([{ id: HELD_TICKET_ID, waitingFor: 'build' }]),
    mutant: { find: 'let heldTicketIds = new Set(settings.readyTickets', replace: 'let heldTicketIds = new Set([] ?? settings.readyTickets' },
  },
  {
    // The fail-review claim: an in-progress ticket is on no ready list, so a run named for it is the only way its paused build is ever finished.
    name:     'a single-ticket run for an in-progress ticket whose build another run left paused takes it over and delivers it, one agent in flight at most',
    scenario: PAUSED_BUILD_RESUMED_ALONE,
    holds:    (run) => summaryOf(run).delivered.join() === HELD_TICKET_ID
      && callsOf(run, 'build', HELD_TICKET_ID).length === 1
      && run.mostAgentsInFlightAtOnce <= 1
      && run.mostAgentsOnBoardAtOnce <= 1
      && run.rowsPaused.length === 0
      && run.rowsRunningAtEnd.length === 0,
    mutant: { find: '  const takeoverText = pausedBuildTakeoverText(ticketId);\n', replace: '  const takeoverText = \'\';\n' },
  },
  {
    name:     'the same takeover resumes the paused row, so the build holds its slot while it runs',
    scenario: PAUSED_BUILD_RESUMED_ALONE,
    holds:    (run) => summaryOf(run).delivered.join() === HELD_TICKET_ID && run.buildersOnBoard.join() === `main build ${HELD_TICKET_ID}`,
    mutant:   { find: PAUSED_ROW_RESUMPTION_SOURCE_LINE, replace: '' },
  },
  {
    // Within one run the same resume applies: the held takeover's row was paused by a parking agent, and the rebuild after the unhold carries on past it.
    name:     'a builder resumed after an unhold in the same run carries on past its own paused row and the ticket is delivered',
    scenario: HELD_AFTER_ITS_BUILDER_STOPPED_SHORT,
    holds:    (run) => ['001', '002'].every((ticketId) => summaryOf(run).delivered.includes(ticketId))
      && callsOf(run, 'build', HELD_TICKET_ID).length === 2
      && callsOf(run, 'park', HELD_TICKET_ID).length === 1
      && run.rowsRunningAtEnd.length === 0,
    mutant: { find: PAUSED_ROW_RESUMPTION_SOURCE_LINE, replace: '' },
  },
];

function mutated(mutant: Mutant): string {
  return SCRIPT_SOURCE.replace(mutant.find, mutant.replace);
}

describe('the dispatcher script and a held ticket', () => {
  for (const claim of CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenario);
      expect(run.ranAway).toBe(false);
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, held: run.heldTicketIdsReturned })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      expect(SCRIPT_SOURCE.split(claim.mutant.find).length - 1, `the mutant's text is in the script exactly once: ${claim.mutant.find}`).toBe(1);
      const run = await runDispatchScript(claim.scenario, mutated(claim.mutant));
      expect(claim.holds(run)).toBe(false);
    });
  }

  test('every agent is told to return heldTicketIds with the concurrency block, and the schema requires it', () => {
    expect(SCRIPT_SOURCE).toContain('(limit, agentsInFlight, freeSlots, readyTicketIds, dispatcherState, heldTicketIds)');
    expect(SCRIPT_SOURCE).toMatch(/required: \[[^\]]*'heldTicketIds'\]/);
  });
});

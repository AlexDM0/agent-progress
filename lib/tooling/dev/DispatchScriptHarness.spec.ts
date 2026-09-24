/**
 * The dispatcher's decisions, pinned by running `templates/workflows/AgentProgressDispatch.js` against a fake board. Each claim runs twice: against
 * the real script, where it must hold, and against a mutant that breaks exactly the decision it pins, where it must fail — so every claim here was
 * watched failing, and keeps being watched. A mutant whose text has left the script fails loudly rather than passing by mutating nothing.
 */
import { describe, expect, test } from 'bun:test';

import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL } from '../../constants/AgentSettings.ts';
import {
  BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM,
  readDispatchScript,
  REVIEWER_SKIPS_A_REREVIEW_ALREADY_RUN,
  REVIEWER_TAKES_OVER_A_RUNNING_BAR,
  runDispatchScript,
  type DispatchRun,
  type DispatchRunName,
  type DispatchScenario,
  type ReviewFinding
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

const SCRIPT_SOURCE = readDispatchScript();

function ticketIdsFrom(first: number, count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => String(first + i).padStart(3, '0'));
}

function kindsAndTickets(run: DispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
}

interface DispatchSummary {
  delivered:           string[];
  parked:              { id: string; reason: string }[];
  findingsFiled:       string[];
  agentsRun:           number;
  stoppedByBoard?:     boolean;
  lowPriorityWaiting?: string[];
}

function summaryOf(run: DispatchRun): DispatchSummary {
  return run.summary as DispatchSummary;
}

function parkedIds(run: DispatchRun): string[] {
  return summaryOf(run).parked.map((parkedTicket) => parkedTicket.id);
}

function reviewsOf(run: DispatchRun, ticketId: string): number {
  return run.calls.filter((call) => call.kind === 'review' && call.ticketId === ticketId).length;
}

function finding(findingClass: string, file: string): ReviewFinding {
  return { class: findingClass, file, summary: `${findingClass} in ${file}` };
}

/** Round 1 asks for round 2 with four findings; round 2 asks for round 3 with the findings given. */
function roundThreeScenario(roundTwoFindings: ReviewFinding[]): DispatchScenario {
  const roundOneFindings = [finding('naming', 'a.ts'), finding('naming', 'b.ts'), finding('ordering', 'a.ts'), finding('ordering', 'b.ts')];
  return {
    limit:          2,
    readyTicketIds: ['001'],
    reviewerReply:  (_ticketId, round) => {
      if (round === 1) return { verdict: 'round-requested', reworkedLines: 900, findings: roundOneFindings };
      if (round === 2) return { verdict: 'round-requested', reworkedLines: 900, findings: roundTwoFindings };
      return { verdict: 'released' };
    },
  };
}

const GRANT_ROUND_THREE_WITHOUT_CONVERGENCE: Mutant = { find: 'if (requestedRound === 2) return { granted: true };', replace: 'return { granted: true };' };

const CARRY_ON_PAST_NO_CLAIM: Mutant = { find: 'the claim is this run\'s own: an earlier attempt', replace: 'the claim is another agent\'s: an earlier attempt' };

const SKIP_A_CLAIM_REFUSED_BY_THE_RUN_ITSELF: Mutant = {
  find:    'if (result.outcome === \'claim-refused\' && result.claimNote === claimNoteOf(ticketId)) {',
  replace: 'if (result.outcome === \'claim-refused\' && false) {',
};

const ADD_A_SECOND_BAR: Mutant = { find: 'take it as your bar and add none', replace: 'add your own beside it' };

const SUBTRACT_EVERY_OWN_AGENT: Mutant = { find: '.filter((ownAgent) => ownAgentIsOnBoard(ownAgent.work, status)).length', replace: '.length' };

const SETTLE_THEN_ADOPT = 'settle(finished);\n  if (finished.result !== null) adoptBoard(finished.result.status);';

const PARK_WITHOUT_RELEASING_THE_ROWS: Mutant = { find: '  releaseRowsOf(ticketId, `Parked #${ticketId}: ${reason}`);\n', replace: '' };

const LEAVE_TAKEOVERS_UNSTARTED_RUNNING: Mutant = { find: 'const rowsToRelease = [...takeoversWaiting.values()];', replace: 'const rowsToRelease = [];' };

function workersRunOn(run: DispatchRun, model: string, effort: string): boolean {
  const workers = run.calls.filter((call) => call.kind === 'build' || call.kind === 'review');
  return workers.length > 0 && workers.every((call) => call.model === model && call.effort === effort);
}

function releasedEveryRow(run: DispatchRun): boolean {
  return run.rowsRunningAtEnd.length === 0 && !run.logs.some((message) => message.includes('No slot free'));
}

function kindsAndTicketsOf(run: DispatchRun, runName: DispatchRunName): string {
  return run.calls.filter((call) => call.run === runName).map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`)).join(', ');
}

function racingSummaryOf(run: DispatchRun): DispatchSummary | null {
  return run.racingSummary as DispatchSummary | null;
}

function buildersOnBoardOf(run: DispatchRun, ticketId: string): string {
  return run.buildersOnBoard.filter((builder) => builder.endsWith(`build ${ticketId}`)).join(', ');
}

const SINGLE_TICKET_RUN_AMONG_OTHERS: DispatchScenario = { limit: 3, readyTicketIds: ['001', '007', '009'], ticketIds: ['007'] };

/** A whole-board run and a single-ticket run for the high ticket #009, launched while the board has room, as the orchestrator's fast lane does. */
function raceForTheHighTicket(racingRunStartsAfterTurns: number): DispatchScenario {
  return {
    limit:                 2,
    readyTicketIds:        ['009', '001', '002'],
    highPriorityTicketIds: ['009'],
    racingTicketIds:       ['009'],
    racingRunStartsAfterTurns,
  };
}

const ONE_NOTE_FOR_EVERY_RUN: Mutant = {
  find:    'runLabel:           ticketIds === null ? \'whole-board\' : `ticket-${ticketIds.join(\'+\')}`,',
  replace: 'runLabel:           \'whole-board\',',
};

const CLAIMS: Claim[] = [
  {
    name:     'the agents running at once never exceed a board limit of 2',
    scenario: { limit: 2, readyTicketIds: ticketIdsFrom(1, 5) },
    holds:    (run) => run.mostAgentsAtOnce === 2 && summaryOf(run).delivered.length === 5,
    mutant:   { find: 'Math.min(board.limit, CONCURRENCY_CEILING_AGENTS)', replace: 'CONCURRENCY_CEILING_AGENTS' },
  },
  {
    name:     'never more than 10 run at once, even with a board limit of 12 and none in flight elsewhere',
    scenario: { limit: 12, readyTicketIds: ticketIdsFrom(1, 15) },
    holds:    (run) => run.mostAgentsAtOnce === 10 && summaryOf(run).delivered.length === 15,
    mutant:   { find: 'Math.min(board.limit, CONCURRENCY_CEILING_AGENTS)', replace: 'board.limit' },
  },
  {
    name:     'agents in flight elsewhere take their share of the board limit',
    scenario: { limit: 3, otherAgentsInFlight: 1, readyTicketIds: ticketIdsFrom(1, 5) },
    holds:    (run) => run.mostAgentsAtOnce === 2,
    mutant:   { find: 'Math.max(0, status.agentsInFlight - ownAgentsOnBoard)', replace: '0' },
  },
  {
    // An own agent launched a moment before a status block was taken has not claimed yet: subtracting it too would read a real other agent as free.
    name:     'agents in flight elsewhere plus every own agent, on the board yet or not, never exceed the board limit',
    scenario: { limit: 3, otherAgentsInFlight: 1, readyTicketIds: ticketIdsFrom(1, 5) },
    holds:    (run) => run.mostAgentsInFlightAtOnce === 3 && summaryOf(run).delivered.length === 5,
    mutant:   SUBTRACT_EVERY_OWN_AGENT,
  },
  {
    name:     'the limit holds when own agents take several turns to reach the board, with two agents in flight elsewhere',
    scenario: {
      limit:                   4,
      otherAgentsInFlight:     2,
      readyTicketIds:          ticketIdsFrom(1, 6),
      turnsBeforeFirstCommand: 3,
    },
    holds:  (run) => run.mostAgentsInFlightAtOnce === 4 && summaryOf(run).delivered.length === 6,
    mutant: SUBTRACT_EVERY_OWN_AGENT,
  },
  {
    // A reviewer reaches the board through `task add --review-of --start`, which checks no limit, so only the dispatcher's count keeps it inside one.
    name:     'the limit holds when reviewers reach the board late, each confirmed by its reviewOf row and not before',
    scenario: {
      limit:                   4,
      otherAgentsInFlight:     2,
      readyTicketIds:          [],
      reviewWaitingTicketIds:  ticketIdsFrom(1, 6),
      turnsBeforeFirstCommand: 3,
    },
    holds:  (run) => run.mostAgentsInFlightAtOnce === 4 && summaryOf(run).delivered.length === 6,
    mutant: {
      find:    'const confirmingTicketIds = work.kind === \'build\' ? status.runningTicketIds : status.runningReviewOfIds;',
      replace: 'if (work.kind === \'review\') return true; const confirmingTicketIds = status.runningTicketIds;',
    },
  },
  {
    // A status block without the running rows confirms no own agent, so every agent the board counts is taken as another's: the safe side.
    name:     'a status block without the running rows subtracts no own agent, and the limit still holds',
    scenario: {
      limit:                  3,
      otherAgentsInFlight:    1,
      readyTicketIds:         ticketIdsFrom(1, 3),
      reviewWaitingTicketIds: ticketIdsFrom(7, 3),
      statusOmitsRunningRows: true,
    },
    holds:  (run) => run.mostAgentsInFlightAtOnce <= 3 && summaryOf(run).delivered.length === 6,
    mutant: {
      find:    'if (!Array.isArray(confirmingTicketIds)) return work.barIsHandedOn === true;',
      replace: 'if (!Array.isArray(confirmingTicketIds)) return true;',
    },
  },
  {
    name:     'a waiting review starts before a ready ticket',
    scenario: { limit: 1, reviewWaitingTicketIds: ['001'], readyTicketIds: ['002', '003'] },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, review 001, build 002, review 002, build 003, review 003',
    mutant:   {
      find:    'const review = reviewQueue.shift();',
      replace: 'const review = board.readyTicketIds.some((ticketId) => !ticketIdsTakenThisRun.has(ticketId)) ? undefined : reviewQueue.shift();',
    },
  },
  {
    name:     'a ticket filed mid-run, appearing in a returned status block, is dispatched',
    scenario: {
      limit:          1,
      readyTicketIds: ['001'],
      afterAgent:     (call, board) => { if (call.kind === 'build' && call.ticketId === '001') board.readyTicketIds.push('002'); },
    },
    holds:  (run) => kindsAndTickets(run).includes('build 002') && summaryOf(run).delivered.includes('002'),
    mutant: { find: 'if (finished.result !== null) adoptBoard(finished.result.status);', replace: '' },
  },
  {
    name:     'round 2 is granted at 751 reworked lines',
    scenario: {
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 751 } : { verdict: 'released' }),
    },
    holds:  (run) => reviewsOf(run, '001') === 2 && summaryOf(run).delivered.includes('001'),
    mutant: { find: 'current.reworkedLines <= REWORK_ROUND_THRESHOLD_LINES', replace: 'current.reworkedLines <= REWORK_ROUND_THRESHOLD_LINES + 1' },
  },
  {
    name:     'round 2 is refused at 750 reworked lines, and the ticket is parked',
    scenario: {
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 750 } : { verdict: 'released' }),
    },
    holds:  (run) => reviewsOf(run, '001') === 1 && parkedIds(run).includes('001'),
    mutant: { find: 'current.reworkedLines <= REWORK_ROUND_THRESHOLD_LINES', replace: 'current.reworkedLines < REWORK_ROUND_THRESHOLD_LINES' },
  },
  {
    name:     'round 3 is refused when round 2 found more than half of round 1\'s findings',
    scenario: roundThreeScenario([finding('spacing', 'a.ts'), finding('spacing', 'b.ts'), finding('typing', 'a.ts')]),
    holds:    (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:   GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:     'round 3 is refused when round 2 repeats a class an earlier round found',
    scenario: roundThreeScenario([finding('naming', 'a.ts')]),
    holds:    (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:   GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:     'round 3 is refused when round 2 names a file no earlier round named',
    scenario: roundThreeScenario([finding('spacing', 'c.ts')]),
    holds:    (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:   GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:     'round 3 is granted when round 2 converges: at most half the findings, a new class, known files',
    scenario: roundThreeScenario([finding('spacing', 'a.ts'), finding('typing', 'b.ts')]),
    holds:    (run) => reviewsOf(run, '001') === 3 && summaryOf(run).delivered.includes('001'),
    mutant:   { find: '  return { granted: true };\n}\n\nfunction settleReview', replace: '  return { granted: false, reason: \'mutant\' };\n}\n\nfunction settleReview' },
  },
  {
    name:     'a first does-not-hold sends a fresh builder, and a second parks the ticket',
    scenario: { limit: 2, readyTicketIds: ['001'], reviewerReply: () => ({ verdict: 'does-not-hold' }) },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 001, review 001, park 001' && parkedIds(run).includes('001'),
    mutant:   { find: 'record.failedPasses >= FAILED_PASSES_BEFORE_PARKING', replace: 'record.failedPasses > FAILED_PASSES_BEFORE_PARKING' },
  },
  {
    name:     'a builder that returns nothing is a failed pass, and a fresh builder takes the ticket',
    scenario: { limit: 2, readyTicketIds: ['001'], builderReply: (_ticketId, pass) => (pass === 1 ? null : { outcome: 'in-review' }) },
    holds:    (run) => summaryOf(run).delivered.includes('001') && run.logs.some((message) => message.includes('#001: the builder returned no result')),
    mutant:   { find: 'countFailedPass(ticketId, \'the builder returned no result\', rebuild);', replace: 'park(ticketId, \'mutant\');' },
  },
  {
    // A builder that stops short of `ticket review` leaves its claimed row running: read as another agent's, it alone would fill a limit of 1.
    name:     'with a limit of 1, a builder that failed with its row left running is followed by a fresh builder that takes that row over and delivers',
    scenario: { limit: 1, readyTicketIds: ['001'], builderReply: (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }) },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, build 001, review 001'
      && summaryOf(run).delivered.join() === '001'
      && run.mostAgentsInFlightAtOnce === 1,
    mutant: {
      find:    SETTLE_THEN_ADOPT,
      replace: 'if (finished.result !== null) adoptBoard(finished.result.status);\n  settle(finished);',
    },
  },
  {
    // Every builder's claim counts the board's running rows, so a parked ticket's row left running would keep the next ticket out for the whole run.
    name:     'with a limit of 1, a ticket parked after two failed builders has its row paused, and the next ready ticket is delivered',
    scenario: { limit: 1, readyTicketIds: ['001', '002'], builderReply: (ticketId) => (ticketId === '001' ? { outcome: 'failed' } : { outcome: 'in-review' }) },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, build 001, park 001, build 002, review 002'
      && summaryOf(run).delivered.join() === '002'
      && parkedIds(run).join() === '001'
      && run.rowsPaused.join() === 'build 001'
      && run.mostAgentsInFlightAtOnce === 1
      && run.mostLiveAgentsAtOnce === 1
      && releasedEveryRow(run),
    mutant: PARK_WITHOUT_RELEASING_THE_ROWS,
  },
  {
    // The reason reaches the board's log through the parking agent, where `review ()` reads as a detail that was lost.
    name:     'a builder that failed with no detail is parked on a reason without empty brackets',
    scenario: { limit: 1, readyTicketIds: ['001'], builderReply: () => ({ outcome: 'failed' }) },
    holds:    (run) => summaryOf(run).parked[0]?.reason === 'the builder did not reach review, the second failed pass'
      && run.calls.some((call) => call.kind === 'park' && call.prompt.includes('"Parked #001: the builder did not reach review, the second failed pass"')),
    mutant: { find: 'review${parentheticalOf(result.detail)}`', replace: 'review (${result.detail})`' },
  },
  {
    name:     'with a limit of 1, a ticket parked after two dead reviewers has their bar closed, and the next ready ticket is delivered within the limit',
    scenario: { limit: 1, readyTicketIds: ['001', '002'], reviewerReply: (ticketId) => (ticketId === '001' ? null : { verdict: 'released' }) },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, review 001, park 001, build 002, review 002'
      && summaryOf(run).delivered.join() === '002'
      && parkedIds(run).join() === '001'
      && run.mostAgentsInFlightAtOnce === 1
      && run.mostLiveAgentsAtOnce === 1
      && releasedEveryRow(run),
    mutant: PARK_WITHOUT_RELEASING_THE_ROWS,
  },
  {
    // A stop keeps the fresh builder from starting, and nothing after the run would pause the row the failed one left.
    name:     'a board stopped while a failed builder\'s row waits for its takeover ends the run with that row paused, not running',
    scenario: {
      limit:          2,
      readyTicketIds: ['001'],
      builderReply:   (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
      afterAgent:     (call, board) => { if (call.kind === 'build') board.dispatcherState = 'stopped'; },
    },
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, park 001'
      && run.rowsPaused.join() === 'build 001'
      && parkedIds(run).length === 0
      && run.rowsRunningAtEnd.length === 0
      && run.mostLiveAgentsAtOnce === 1
      && run.logs.some((message) => message.includes('Left for the user\'s go: #001')),
    mutant: LEAVE_TAKEOVERS_UNSTARTED_RUNNING,
  },
  {
    // The limit bounds agents alive, and a parking agent is one: with no agent just finished for it to replace, it would be one over the limit.
    name:     'a takeover kept out because agents elsewhere hold the whole limit starts no parking agent over it, and the log hands its row on by name',
    scenario: {
      limit:          1,
      readyTicketIds: ['001'],
      builderReply:   (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
      afterAgent:     (call, board) => { if (call.kind === 'build') board.otherAgentsInFlight = 1; },
    },
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001'
      && run.mostLiveAgentsAtOnce === 1
      && run.rowsRunningAtEnd.join() === 'build 001'
      && run.logs.some((message) => message.includes('No slot free for an agent to pause the row of #001')),
    mutant: { find: 'while (rowsToRelease.length > 0 && inFlight.size < ownSlotLimit())', replace: 'while (rowsToRelease.length > 0)' },
  },
  {
    // A dead reviewer returns no status block, so its bar is seen only in a later agent's: there, with an agent started elsewhere, the bar read as
    // another's fills the limit of 2 and the fresh reviewer would never start.
    name:     'a reviewer that returned nothing leaves its bar running, and a fresh reviewer takes it over although that bar and an agent elsewhere fill the limit',
    scenario: {
      limit:                  2,
      readyTicketIds:         [],
      reviewWaitingTicketIds: ['001', '002', '003'],
      reviewerReply:          (ticketId, round) => (ticketId === '001' && round === 1 ? null : { verdict: 'released' }),
      afterAgent:             (call, board) => { if (call.kind === 'review' && call.ticketId === '002') board.otherAgentsInFlight = 1; },
    },
    holds: (run) => reviewsOf(run, '001') === 2
      && summaryOf(run).delivered.length === 3
      && run.mostAgentsInFlightAtOnce === 2,
    mutant: {
      find:    '() => awaitTakeover(reviewWorkFor(ticketId, true, true))',
      replace: '() => reviewQueue.push(reviewWorkFor(ticketId, true, true))',
    },
  },
  {
    // Counted as another's, the row left running would hold a slot beside the fresh agent that took it over, and the ticket filed meanwhile would wait.
    name:     'a row left running for a fresh builder is the dispatcher\'s own, so a ticket filed meanwhile starts beside that fresh builder',
    scenario: {
      limit:          2,
      readyTicketIds: ['001'],
      builderReply:   (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
      afterAgent:     (call, board) => { if (call.kind === 'build' && call.ordinal === 1 && call.ticketId === '001') board.readyTicketIds.push('002'); },
    },
    holds: (run) => kindsAndTickets(run).slice(0, 4).join(', ') === 'survey, build 001, build 001, build 002'
      && summaryOf(run).delivered.length === 2
      && run.mostAgentsInFlightAtOnce === 2,
    mutant: { find: ' + takeoversOnBoard(status).length', replace: '' },
  },
  {
    // The row left running is subtracted from the others, so work started ahead of its takeover would put the board over the limit.
    name:     'the takeover of a row left running starts before other work, so that row and the agents in flight never exceed the limit',
    scenario: {
      limit:          2,
      readyTicketIds: ticketIdsFrom(1, 3),
      builderReply:   (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
    },
    holds:  (run) => run.mostAgentsInFlightAtOnce === 2 && summaryOf(run).delivered.length === 3,
    mutant: {
      find:    'if (takeover !== undefined) {',
      replace: 'if (takeover !== undefined && reviewQueue.length === 0 && board.readyTicketIds.every((ticketId) => ticketIdsTakenThisRun.has(ticketId))) {',
    },
  },
  {
    name:     'a refused claim skips the ticket for this run, logged, while the rest go ahead',
    scenario: {
      limit:          2,
      readyTicketIds: ['001', '002'],
      builderReply:   (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'claim-refused', detail: 'waits on #009' } : { outcome: 'in-review' }),
    },
    holds: (run) => reviewsOf(run, '001') === 0
      && run.calls.filter((call) => call.ticketId === '001').length === 1
      && summaryOf(run).delivered.join() === '002'
      && run.logs.some((message) => message.includes('#001 skipped for this run')),
    mutant: { find: 'log(`#${ticketId} skipped for this run: the claim was refused (${result.detail}).`);', replace: 'rebuildQueue.push(ticketId);' },
  },
  {
    // A killed run is resumed from its journal, and the builder that was in flight runs again with the same prompt: its first attempt's claim
    // refuses the second, and a builder that stopped there would leave the ticket stalled and its row holding the only slot.
    name:     'a builder resumed after its run was killed finds its ticket claimed and its worktree present, carries on in it, and delivers',
    scenario: { limit: 1, readyTicketIds: ['001', '002'], killedAtFirstCommandOf: 'build 001' },
    holds:    (run) => run.resumed
      && kindsAndTickets(run).join(', ') === 'survey, build 001, build 001, review 001, build 002, review 002'
      && summaryOf(run).delivered.join() === '001,002'
      && run.rowsRunningAtEnd.length === 0
      && run.mostAgentsInFlightAtOnce === 1,
    mutant: CARRY_ON_PAST_NO_CLAIM,
  },
  {
    // Observed: a model call that hangs is interrupted and the agent started again with the same prompt, inside the one `agent()` call.
    name:     'a builder the runtime restarts within one run carries on past its first attempt\'s claim, and the next ticket is delivered within the limit',
    scenario: { limit: 1, readyTicketIds: ['001', '002'], restartedBuilderTicketIds: ['001'] },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 002, review 002'
      && summaryOf(run).delivered.join() === '001,002'
      && run.rowsRunningAtEnd.length === 0
      && run.mostAgentsInFlightAtOnce === 1,
    mutant: CARRY_ON_PAST_NO_CLAIM,
  },
  {
    // A restarted builder that returns `claim-refused` anyway leaves the run's own row running; skipped, that row would read as another agent's.
    name:     'a claim refused while the run\'s own claim holds the ticket is taken over by a fresh builder, never skipped with that row holding a slot',
    scenario: {
      limit:                     1,
      readyTicketIds:            ['001', '002'],
      restartedBuilderTicketIds: ['001'],
      builderReply:              (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'claim-refused', detail: '#001 is in-progress' } : { outcome: 'in-review' }),
    },
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, build 001, review 001, build 002, review 002'
      && summaryOf(run).delivered.join() === '001,002'
      && run.rowsRunningAtEnd.length === 0
      && run.mostAgentsInFlightAtOnce === 1,
    mutant: SKIP_A_CLAIM_REFUSED_BY_THE_RUN_ITSELF,
  },
  {
    name:     'a ticket whose own claim is refused on both passes is parked with its row paused, and the next ready ticket is delivered within the limit',
    scenario: {
      limit:                     1,
      readyTicketIds:            ['001', '002'],
      restartedBuilderTicketIds: ['001'],
      builderReply:              (ticketId) => (ticketId === '001' ? { outcome: 'claim-refused', detail: '#001 is in-progress' } : { outcome: 'in-review' }),
    },
    holds: (run) => parkedIds(run).join() === '001'
      && run.rowsPaused.join() === 'build 001'
      && summaryOf(run).delivered.join() === '002'
      && run.rowsRunningAtEnd.length === 0
      && run.mostLiveAgentsAtOnce === 1,
    mutant: SKIP_A_CLAIM_REFUSED_BY_THE_RUN_ITSELF,
  },
  {
    // The reviewer in flight when the run was killed had added its bar; a second bar would leave the first running for the rest of the run.
    name:     'a reviewer resumed after its run was killed takes its first attempt\'s bar over and adds no second',
    scenario: {
      limit:                  1,
      readyTicketIds:         [],
      reviewWaitingTicketIds: ['001'],
      killedAtFirstCommandOf: 'review 001',
    },
    holds: (run) => run.resumed
      && reviewsOf(run, '001') === 2
      && run.reviewBarsAdded.join() === 'review 001'
      && summaryOf(run).delivered.join() === '001'
      && run.rowsRunningAtEnd.length === 0,
    mutant: ADD_A_SECOND_BAR,
  },
  {
    // A second bar left running is read as another agent's, and at a limit of 1 it keeps the rebuild the review asked for from ever starting.
    name:     'a reviewer the runtime restarts within one run takes its first attempt\'s bar over, so the rebuild it asks for starts within the limit',
    scenario: {
      limit:                      1,
      readyTicketIds:             [],
      reviewWaitingTicketIds:     ['001'],
      restartedReviewerTicketIds: ['001'],
      reviewerReply:              (_ticketId, round) => (round === 1 ? { verdict: 'does-not-hold' } : { verdict: 'released' }),
    },
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, review 001, build 001, review 001'
      && summaryOf(run).delivered.join() === '001'
      && run.reviewBarsAdded.join(', ') === 'review 001, review 001'
      && run.rowsRunningAtEnd.length === 0,
    mutant: ADD_A_SECOND_BAR,
  },
  {
    // `ticket rereview` is not idempotent: run again by the restarted attempt, it leaves the ticket and its row a round ahead of the review done.
    name:     'a round-2 reviewer the runtime restarts within one run finds the bar of its round running and runs ticket rereview once',
    scenario: {
      limit:                      2,
      readyTicketIds:             ['001'],
      restartedReviewerTicketIds: ['001'],
      restartedReviewerRound:     2,
      reviewerReply:              (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 900 } : { verdict: 'released' }),
    },
    holds: (run) => reviewsOf(run, '001') === 2
      && run.rereviewsRun.join(', ') === 'rereview 001 round 2'
      && summaryOf(run).delivered.join() === '001'
      && run.rowsRunningAtEnd.length === 0,
    mutant: { find: 'skip the rereview and take that row as your bar. ', replace: 'run the rereview regardless. ' },
  },
  {
    name:     'a release refused for a reason other than main-moved parks the ticket',
    scenario: { limit: 2, readyTicketIds: ['001'], reviewerReply: () => ({ verdict: 'not-released', releaseReason: 'main-checkout-dirty' }) },
    holds:    (run) => reviewsOf(run, '001') === 1 && summaryOf(run).parked.some((parkedTicket) => parkedTicket.reason.includes('main-checkout-dirty')),
    mutant:   { find: 'result.releaseReason !== \'main-moved\'', replace: 'false' },
  },
  {
    name:     'the run ends when nothing is ready or running, and returns the summary of what it did',
    scenario: {
      limit:          2,
      readyTicketIds: ['001', '002'],
      reviewerReply:  (ticketId) => (ticketId === '001' ? { verdict: 'released', filedTicketIds: ['009'] } : { verdict: 'not-released', releaseReason: 'branch-diverged' }),
    },
    holds: (run) => JSON.stringify(run.summary) === JSON.stringify({
      delivered:     ['001'],
      parked:        [{ id: '002', reason: 'the release was refused: branch-diverged' }],
      findingsFiled: ['009'],
      agentsRun:     6,
    }),
    mutant: { find: '    agentsRun,\n    ...(stoppedByBoard', replace: '    ...(stoppedByBoard' },
  },
  {
    name:     'a board stopped mid-run starts no new agent, while the agents in flight finish and a reviewer among them still releases',
    scenario: {
      limit:                  2,
      reviewWaitingTicketIds: ['001'],
      readyTicketIds:         ['002', '003'],
      afterAgent:             (call, board) => { if (call.kind === 'review' && call.ticketId === '001') board.dispatcherState = 'stopped'; },
    },
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, review 001, build 002, park 002'
      && summaryOf(run).delivered.join() === '001'
      && summaryOf(run).stoppedByBoard === true,
    mutant: { find: 'while (!stoppedByBoard && inFlight.size < slotLimit)', replace: 'while (inFlight.size < slotLimit)' },
  },
  {
    name:     'a board stopped when the run starts dispatches nothing, and the summary says the board stopped it',
    scenario: { limit: 2, readyTicketIds: ['001'], dispatcherState: 'stopped' },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey' && JSON.stringify(run.summary) === JSON.stringify({
      delivered:      [],
      parked:         [],
      findingsFiled:  [],
      agentsRun:      1,
      stoppedByBoard: true,
    }),
    mutant: { find: '...(stoppedByBoard ? { stoppedByBoard } : {}),', replace: '' },
  },
  {
    // Low tickets are the orchestrator's to triage first: abandon the stale, merge the overlapping, then relaunch with the flag.
    name:     'with only low tickets ready and no includeLowPriority, no builder starts and the summary lists them as lowPriorityWaiting',
    scenario: { limit: 2, readyTicketIds: ['004', '005'], lowPriorityTicketIds: ['004', '005'] },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey' && summaryOf(run).lowPriorityWaiting?.join() === '004,005',
    mutant:   { find: '!ticketIdsTakenThisRun.has(ticketId) && readyTicketIsAdmitted(ticketId));\n}', replace: '!ticketIdsTakenThisRun.has(ticketId));\n}' },
  },
  {
    name:     'with includeLowPriority, the low tickets ready are dispatched and delivered',
    scenario: {
      limit:                2,
      readyTicketIds:       ['004', '005'],
      lowPriorityTicketIds: ['004', '005'],
      includeLowPriority:   true,
    },
    holds:  (run) => summaryOf(run).delivered.join() === '004,005' && summaryOf(run).lowPriorityWaiting === undefined,
    mutant: { find: 'includeLowPriority: given.includeLowPriority === true,', replace: 'includeLowPriority: false,' },
  },
  {
    // A reviewer files its findings as low tickets minutes before the normal work runs out; the run must not pick them up untriaged.
    name:     'a low ticket filed mid-run while normal work remains is not started, and is left for triage',
    scenario: {
      limit:          1,
      readyTicketIds: ['001', '002'],
      afterAgent:     (call, board) => {
        if (call.kind !== 'review' || call.ticketId !== '001') return;
        board.readyTicketIds.push('009');
        board.lowPriorityTicketIds.push('009');
      },
    },
    holds: (run) => !kindsAndTickets(run).includes('build 009')
      && summaryOf(run).delivered.join() === '001,002'
      && summaryOf(run).lowPriorityWaiting?.join() === '009',
    mutant: {
      find:    '  lowPriorityReadyTicketIds = lowPriorityReadyTicketIdsOf(status);',
      replace: '  if (agentsRun === 1) lowPriorityReadyTicketIds = lowPriorityReadyTicketIdsOf(status);',
    },
  },
  {
    // Starting untriaged low work cannot be undone and holding back normal work can, so a block that states no priorities errs on the low side.
    name:     'a ready ticket whose priority the status block does not state is not started, and is left for triage',
    scenario: {
      limit:                   2,
      readyTicketIds:          ['004'],
      statusOmitsReadyTickets: true,
    },
    holds:  (run) => kindsAndTickets(run).join(', ') === 'survey' && summaryOf(run).lowPriorityWaiting?.join() === '004',
    mutant: {
      find:    '!PRIORITIES_ADMITTED_WITHOUT_TRIAGE.includes(readyTicketEntryOf(status, ticketId)?.priority)',
      replace: 'readyTicketEntryOf(status, ticketId)?.priority === \'low\'',
    },
  },
  {
    // The Workflow tool gives an agent without an effort the orchestrator's, which is how a fan-out runs at a tier nobody chose.
    name:     'a ticket naming no model or effort runs its builder and its reviewer on opus at medium effort',
    scenario: { limit: 1, readyTicketIds: ['001'] },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001' && workersRunOn(run, 'opus', 'medium'),
    mutant:   { find: 'schema: BUILDER_SCHEMA,\n      model,\n      effort,', replace: 'schema: BUILDER_SCHEMA,\n      model,' },
  },
  {
    // A taken ticket leaves the ready list, so the rebuild and the second review can only run on what was recorded when it was taken.
    name:     'a ticket naming sonnet at high effort runs every builder and reviewer on those, a rebuild after does-not-hold included, each owning its row as sonnet',
    scenario: {
      limit:                   1,
      readyTicketIds:          ['001'],
      agentSettingsByTicketId: { '001': { model: 'sonnet', effort: 'high' } },
      reviewerReply:           (_ticketId, round) => (round === 1 ? { verdict: 'does-not-hold' } : { verdict: 'released' }),
    },
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 001, review 001'
      && workersRunOn(run, 'sonnet', 'high')
      && run.calls.filter((call) => call.kind !== 'survey').every((call) => call.prompt.includes('--owner sonnet')),
    mutant: { find: '  recordOf(readyTicketId).agentSettings = agentSettingsFrom(readyTicketEntryOf(readyTicketsStatement(), readyTicketId));\n', replace: '' },
  },
  {
    name:     'a review waiting when the run starts runs on the model and effort its ticket names',
    scenario: {
      limit:                   1,
      readyTicketIds:          [],
      reviewWaitingTicketIds:  ['001'],
      agentSettingsByTicketId: { '001': { model: 'sonnet', effort: 'high' } },
    },
    holds:  (run) => kindsAndTickets(run).join(', ') === 'survey, review 001' && workersRunOn(run, 'sonnet', 'high'),
    mutant: { find: '  recordOf(reviewWaitingTicket.id).agentSettings = agentSettingsFrom(reviewWaitingTicket);\n', replace: '' },
  },
  {
    // A block that lost `readyTickets` cannot say what the ticket names, and the tool's defaults are the one pair nobody has to have chosen.
    name:     'a status block without readyTickets runs a ticket that names sonnet at high on opus at medium, once admitted as low',
    scenario: {
      limit:                   1,
      readyTicketIds:          ['001'],
      agentSettingsByTicketId: { '001': { model: 'sonnet', effort: 'high' } },
      statusOmitsReadyTickets: true,
      includeLowPriority:      true,
    },
    holds:  (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001' && workersRunOn(run, 'opus', 'medium'),
    mutant: { find: 'stated.effort : DEFAULT_WORKER_EFFORT,', replace: 'stated.effort : undefined,' },
  },
  {
    name:     'a low ticket left for triage is logged as such, never as waiting for a slot other agents hold',
    scenario: { limit: 2, readyTicketIds: ['004'], lowPriorityTicketIds: ['004'] },
    holds:    (run) => run.logs.some((message) => message.includes('triage, low priority: #004')) && !run.logs.some((message) => message.includes('No slot free')),
    mutant:   { find: '  ...untakenTicketIds(),\n];', replace: '  ...board.readyTicketIds.filter((ticketId) => !ticketIdsTakenThisRun.has(ticketId)),\n];' },
  },
  {
    // A plain `ticket review` frees the slot until the reviewer's `task add --start`, which checks no limit: a claim in between puts the board one over.
    name:     'every builder moves its ticket to review with --start-review, so no claim from elsewhere finds its slot free before the reviewer starts',
    scenario: { limit: 2, readyTicketIds: ticketIdsFrom(1, 3), elsewhereClaimsAFreedSlot: true },
    holds:    (run) => run.slotGaps.length === 0
      && run.mostAgentsOnBoardAtOnce === 2
      && summaryOf(run).delivered.length === 3
      && run.reviewBarsAdded.join(', ') === 'review 001, review 002, review 003',
    mutant: {
      find:    '`Close as Ready to merge says, append the \\`## Handoff\\`, then run \\`${startReviewCommandOf(\'review\', ticketId, owner)}\\`. `',
      replace: '`Close as Ready to merge says, append the \\`## Handoff\\`, then run \\`agent-progress ticket review ${ticketId}\\`. `',
    },
  },
  {
    // A reviewer closing its bar on round-requested would free the slot until the next round's `rereview --start-review`, and a claim in between takes it.
    name:     'a reviewer asking for another round leaves its bar running for the next round, so no claim from elsewhere finds the ticket\'s slot free',
    scenario: {
      limit:                     2,
      readyTicketIds:            ticketIdsFrom(1, 2),
      elsewhereClaimsAFreedSlot: true,
      reviewerReply:             (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 900 } : { verdict: 'released' }),
    },
    holds: (run) => run.slotGaps.length === 0
      && run.mostAgentsOnBoardAtOnce <= 2
      && summaryOf(run).delivered.length === 2
      && run.rowsRunningAtEnd.length === 0,
    mutant: { find: 'leave your bar running: ', replace: 'close it and leave nothing running: ' },
  },
  {
    // Read as another agent's, the bar the builder left would fill a limit of 1, and the reviewer it was started for would never run.
    name:     'the reviewer takes over the bar its builder\'s --start-review left running, so at a limit of 1 it starts at once and adds no second bar',
    scenario: { limit: 1, readyTicketIds: ['001', '002'] },
    holds:    (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 002, review 002'
      && run.reviewBarsAdded.join(', ') === 'review 001, review 002'
      && run.mostAgentsOnBoardAtOnce === 1
      && run.rowsRunningAtEnd.length === 0,
    mutant: { find: 'awaitTakeover({ ...reviewWorkFor(ticketId, false, false), barIsHandedOn: true });', replace: 'queueReview(ticketId, false);' },
  },
  {
    // The builder's `in-review` reply is word that its bar runs; without it, a block lacking the rows would leave every built ticket's bar unstarted.
    name:     'a status block without the running rows still counts the bar a builder handed on as the run\'s own, so every ticket is reviewed and delivered',
    scenario: {
      limit:                  3,
      otherAgentsInFlight:    1,
      readyTicketIds:         ticketIdsFrom(1, 3),
      reviewWaitingTicketIds: ticketIdsFrom(7, 3),
      statusOmitsRunningRows: true,
    },
    holds:  (run) => run.mostAgentsOnBoardAtOnce <= 3 && summaryOf(run).delivered.length === 6,
    mutant: { find: 'if (!Array.isArray(confirmingTicketIds)) return work.barIsHandedOn === true;', replace: 'if (!Array.isArray(confirmingTicketIds)) return false;' },
  },
  {
    name:     'with ticketIds, no survey agent runs',
    scenario: SINGLE_TICKET_RUN_AMONG_OTHERS,
    holds:    (run) => run.calls.length > 0 && run.calls.every((call) => call.kind !== 'survey'),
    mutant:   { find: 'if (settings.ticketIds === null) {\n  phase(\'Survey\');', replace: 'if (true) {\n  phase(\'Survey\');' },
  },
  {
    // The single-ticket run is one agent's work: an agent() call for any other ticket would be a second agent the orchestrator never launched.
    name:     'with ticketIds [007] and other tickets ready, only #007 is built, reviewed and released, and no agent() call names another ticket',
    scenario: SINGLE_TICKET_RUN_AMONG_OTHERS,
    holds:    (run) => kindsAndTickets(run).join(', ') === 'build 007, review 007'
      && run.calls.every((call) => call.ticketId === '007')
      && JSON.stringify(run.summary) === JSON.stringify({
        delivered: ['007'], parked: [], findingsFiled: [], agentsRun: 2 
      }),
    mutant: {
      find:    'if (settings.ticketIds !== null) return settings.ticketIds.filter(',
      replace: 'if (settings.ticketIds !== null && board === null) return settings.ticketIds.filter(',
    },
  },
  {
    name:     'with ticketIds, a ticket whose builders fail twice returns as parked, its row paused, and no other ticket is started',
    scenario: {
      limit:          2,
      readyTicketIds: ['001', '007'],
      ticketIds:      ['007'],
      builderReply:   (ticketId) => (ticketId === '007' ? { outcome: 'failed' } : { outcome: 'in-review' }),
    },
    holds: (run) => kindsAndTickets(run).join(', ') === 'build 007, build 007, park 007'
      && parkedIds(run).join() === '007'
      && summaryOf(run).delivered.length === 0
      && run.rowsPaused.join() === 'build 007'
      && run.rowsRunningAtEnd.length === 0,
    mutant: PARK_WITHOUT_RELEASING_THE_ROWS,
  },
  {
    // The atomic claim decides the race; the note tells a run its own claim from the other's, so the loser moves on instead of carrying on beside it.
    name:     'a single-ticket run that claims the high ticket first builds it alone: the whole-board run\'s claim is refused and it moves on, within the limit',
    scenario: raceForTheHighTicket(0),
    holds:    (run) => buildersOnBoardOf(run, '009') === 'racing build 009'
      && racingSummaryOf(run)?.delivered.join() === '009'
      && summaryOf(run).delivered.join() === '001,002'
      && run.logs.some((message) => message.includes('#009 skipped for this run'))
      && run.mostAgentsOnBoardAtOnce <= 2,
    mutant: ONE_NOTE_FOR_EVERY_RUN,
  },
  {
    name:     'a whole-board run that claims the high ticket first builds it alone: the single-ticket run\'s claim is refused and it returns, within the limit',
    scenario: raceForTheHighTicket(2),
    holds:    (run) => buildersOnBoardOf(run, '009') === 'main build 009'
      && kindsAndTicketsOf(run, 'racing') === 'build 009'
      && racingSummaryOf(run)?.delivered.length === 0
      && run.racingLogs.some((message) => message.includes('#009 skipped for this run'))
      && summaryOf(run).delivered.join() === '009,001,002'
      && run.mostAgentsOnBoardAtOnce <= 2,
    mutant: ONE_NOTE_FOR_EVERY_RUN,
  },
];

const EVERY_KIND_OF_AGENT: DispatchScenario = { limit: 2, readyTicketIds: ['001', '002'], reviewerReply: () => ({ verdict: 'does-not-hold' }) };

function modelsAndEffortsAreExplicit(run: DispatchRun): boolean {
  return run.calls.every((call) => {
    const helper = call.kind === 'survey' || call.kind === 'park';
    return call.model === (helper ? 'haiku' : DEFAULT_AGENT_MODEL) && call.effort === (helper ? 'low' : DEFAULT_AGENT_EFFORT);
  });
}

/** Each site that starts an agent, with its model or its effort taken out: four sites, eight forms. */
const AGENT_OPTIONS_LEFT_OUT: [string, string][] = [
  ['    model:  SURVEY_MODEL,\n    effort: SURVEY_EFFORT,', '    effort: SURVEY_EFFORT,'],
  ['    model:  SURVEY_MODEL,\n    effort: SURVEY_EFFORT,', '    model:  SURVEY_MODEL,'],
  ['      model:  PARKING_MODEL,\n      effort: PARKING_EFFORT,', '      effort: PARKING_EFFORT,'],
  ['      model:  PARKING_MODEL,\n      effort: PARKING_EFFORT,', '      model:  PARKING_MODEL,'],
  ['schema: BUILDER_SCHEMA,\n      model,\n      effort,', 'schema: BUILDER_SCHEMA,\n      effort,'],
  ['schema: BUILDER_SCHEMA,\n      model,\n      effort,', 'schema: BUILDER_SCHEMA,\n      model,'],
  ['schema: REVIEWER_SCHEMA,\n    model,\n    effort,', 'schema: REVIEWER_SCHEMA,\n    effort,'],
  ['schema: REVIEWER_SCHEMA,\n    model,\n    effort,', 'schema: REVIEWER_SCHEMA,\n    model,'],
];

function scriptConstantOf(name: string): string | null {
  return new RegExp(`^const ${name} = '(\\w+)';$`, 'm').exec(SCRIPT_SOURCE)?.[1] ?? null;
}

function mutated(mutant: Mutant): string {
  return SCRIPT_SOURCE.replace(mutant.find, mutant.replace);
}

describe('the dispatcher script', () => {
  for (const claim of CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenario);
      expect(run.ranAway).toBe(false);
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, most: run.mostAgentsAtOnce })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      expect(SCRIPT_SOURCE.split(claim.mutant.find).length - 1, `the mutant's text is in the script exactly once: ${claim.mutant.find}`).toBe(1);
      const run = await runDispatchScript(claim.scenario, mutated(claim.mutant));
      expect(claim.holds(run)).toBe(false);
    });
  }

  // With nothing ready the survey is the whole run: a dispatcher that idled here would hold the orchestrator's turn for nothing.
  test('with nothing ready and nothing waiting, the survey is the only agent and the summary is empty', async () => {
    const run = await runDispatchScript({ limit: 2, readyTicketIds: [] });
    expect(kindsAndTickets(run)).toEqual(['survey']);
    expect(run.summary).toEqual({
      delivered:     [],
      parked:        [],
      findingsFiled: [],
      agentsRun:     1,
    });
  });

  // A model or effort left out inherits the orchestrator's, which is how a fan-out once ran at the most expensive tier by accident.
  test('every agent is given its model and effort explicitly: haiku at low for the survey and the parking agents, the defaults for every builder and reviewer', async () => {
    const run = await runDispatchScript(EVERY_KIND_OF_AGENT);
    expect(run.calls.length).toBeGreaterThan(4);
    expect(new Set(run.calls.map((call) => call.kind))).toEqual(new Set(['survey', 'build', 'review', 'park']));
    expect(modelsAndEffortsAreExplicit(run)).toBe(true);
  });

  test.each(AGENT_OPTIONS_LEFT_OUT)('an agent started without its model or effort (%s → %s) fails the check', async (find, replace) => {
    expect(SCRIPT_SOURCE.split(find).length - 1).toBe(1);
    expect(modelsAndEffortsAreExplicit(await runDispatchScript(EVERY_KIND_OF_AGENT, SCRIPT_SOURCE.replace(find, replace)))).toBe(false);
  });

  test('the four sites above are every agent the script starts: one agent() call, reached through runAgent from four places', () => {
    expect(SCRIPT_SOURCE.split(/\bagent\(/).length - 1).toBe(1);
    expect(SCRIPT_SOURCE.split('await agent(prompt, options)').length - 1).toBe(1);
    expect(SCRIPT_SOURCE.split('runAgent(').length - 1).toBe(1 + AGENT_OPTIONS_LEFT_OUT.length / 2);
  });

  // The script is plain JavaScript in another repository and cannot import the tool's defaults, so it states its own and they must not drift.
  test('the script falls back to the same default model and effort as the tool, and runs the survey and parking agents on haiku at low', () => {
    expect(scriptConstantOf('DEFAULT_WORKER_MODEL')).toBe(DEFAULT_AGENT_MODEL);
    expect(scriptConstantOf('DEFAULT_WORKER_EFFORT')).toBe(DEFAULT_AGENT_EFFORT);
    expect([scriptConstantOf('SURVEY_MODEL'), scriptConstantOf('SURVEY_EFFORT')]).toEqual(['haiku', 'low']);
    expect([scriptConstantOf('PARKING_MODEL'), scriptConstantOf('PARKING_EFFORT')]).toEqual(['haiku', 'low']);
  });

  // The script reads a ticket's priority, model and effort only from what the agents copy, so every prompt names the one list to copy.
  test('every agent is told to return the status document\'s readyTickets verbatim', async () => {
    const run = await runDispatchScript(EVERY_KIND_OF_AGENT);
    expect(run.calls.length).toBeGreaterThan(4);
    for (const call of run.calls) expect(call.prompt).toContain('`readyTickets` (the same document\'s top-level `readyTickets` list, verbatim)');
  });

  test('a review waiting when the run starts is started before any ready ticket', async () => {
    const run = await runDispatchScript({ limit: 1, readyTicketIds: ['002'], reviewWaitingTicketIds: ['001'] });
    expect(kindsAndTickets(run)).toEqual(['survey', 'review 001', 'build 002', 'review 002']);
  });

  test('a rebuild reuses the ticket worktree and tells the builder the last review is where it starts', async () => {
    const run = await runDispatchScript({
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'does-not-hold' } : { verdict: 'released' }),
    });
    const builders = run.calls.filter((call) => call.kind === 'build');
    expect(builders).toHaveLength(2);
    for (const builder of builders) expect(builder.prompt).toContain('/scratch/example-repository/.claude/worktrees/ticket-001');
    expect(builders[1]?.prompt).toContain('does not hold');
    expect(builders[0]?.prompt).not.toContain('does not hold');
  });

  // An earlier attempt's claim leaves the ticket in-progress, and the real `ticket claim` refuses that. Any builder may be a restarted or resumed
  // one, so every prompt carries the rule; only one that follows a builder of this run that stopped short is told so.
  test('every builder carries on past a claim refused while its worktree exists, and only a fresh one is told an earlier builder stopped short', async () => {
    const run = await runDispatchScript({ limit: 2, readyTicketIds: ['001'], builderReply: (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }) });
    const builders = run.calls.filter((call) => call.kind === 'build');
    expect(builders).toHaveLength(2);
    for (const builder of builders) {
      const ownClaimClause = '"Built by the whole-board dispatcher run on ticket-001" and /scratch/example-repository/.claude/worktrees/ticket-001 exists';
      expect(builder.prompt).toContain(`${ownClaimClause}, ${BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM}`);
      expect(builder.prompt).toContain('keeping every uncommitted edit it holds');
    }
    expect(builders[1]?.prompt).toContain('An earlier builder of this run stopped before review');
    expect(builders[0]?.prompt).not.toContain('An earlier builder of this run');
    expect(builders[1]?.prompt).not.toContain('does not hold');
  });

  test('every reviewer takes a running bar that reviews its ticket as its own rather than adding a second', async () => {
    const run = await runDispatchScript({ limit: 2, readyTicketIds: ['001'], reviewerReply: (_ticketId, round) => (round === 1 ? null : { verdict: 'released' }) });
    const reviewers = run.calls.filter((call) => call.kind === 'review');
    expect(reviewers).toHaveLength(2);
    for (const reviewer of reviewers) expect(reviewer.prompt).toContain('`reviewOf` is 001, it is this review\'s own');
    for (const reviewer of reviewers) expect(reviewer.prompt).toContain(REVIEWER_TAKES_OVER_A_RUNNING_BAR);
    expect(run.reviewBarsAdded).toEqual(['review 001']);
  });

  test('only a round-2 reviewer runs ticket rereview, and its prompt skips it when the bar named for its round already runs', async () => {
    const run = await runDispatchScript({
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 900 } : { verdict: 'released' }),
    });
    const reviewers = run.calls.filter((call) => call.kind === 'review');
    expect(reviewers).toHaveLength(2);
    expect(reviewers[0]?.prompt).not.toContain('ticket rereview 001');
    expect(reviewers[1]?.prompt).toContain('is named `Review <your round> #001 — …`');
    expect(reviewers[1]?.prompt).toContain(REVIEWER_SKIPS_A_REREVIEW_ALREADY_RUN);
    expect(run.rereviewsRun).toEqual(['rereview 001 round 2']);
  });

  // A reviewer that died left its bar running, and every status block after would count it as an agent in flight elsewhere.
  test('a fresh reviewer after one that returned nothing is told the dead one\'s bar may still be running', async () => {
    const run = await runDispatchScript({ limit: 2, readyTicketIds: ['001'], reviewerReply: (_ticketId, round) => (round === 1 ? null : { verdict: 'released' }) });
    const reviewers = run.calls.filter((call) => call.kind === 'review');
    expect(reviewers).toHaveLength(2);
    expect(reviewers[1]?.prompt).toContain('An earlier reviewer of this run returned nothing');
    expect(reviewers[0]?.prompt).not.toContain('An earlier reviewer of this run returned nothing');
    expect(summaryOf(run).delivered).toEqual(['001']);
  });

  // At a limit of 1 no status block follows a dead reviewer, so its bar is never read as another's: this pins the case, it decides nothing new.
  test('with a limit of 1, a reviewer that returned nothing with its bar left running is followed by a fresh reviewer that releases', async () => {
    const run = await runDispatchScript({ limit: 1, readyTicketIds: ['001'], reviewerReply: (_ticketId, round) => (round === 1 ? null : { verdict: 'released' }) });
    expect(kindsAndTickets(run)).toEqual(['survey', 'build 001', 'review 001', 'review 001']);
    expect(summaryOf(run).delivered).toEqual(['001']);
    expect(run.mostAgentsInFlightAtOnce).toBe(1);
  });
});

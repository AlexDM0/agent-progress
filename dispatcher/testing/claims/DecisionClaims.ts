/**
 * The dispatcher's decisions as claims, shared by the decision suite: each a scenario, what must hold after it, and the mutant that breaks exactly
 * that decision.
 */
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL } from '../../../src/lib/tracker-model/constants/AgentSettings.ts';
import type { DispatchSummary }                      from '../../@types/DispatchOutcome.ts';
import type {
  DispatchRunName,
  DispatchScenario,
  RecordedDispatchRun,
  ReviewFinding
} from '../DispatchScriptHarness.ts';
import type { SourceMutant } from '../SourceMutant.ts';
import {
  DISPATCHER_MODULE_PATHS,
  dispatchSummaryFrom,
  runSummaryOf,
  type DispatchClaim
} from './DispatchClaim.ts';

const {
  DISPATCH_RUN,
  DISPATCHER,
  AGENT_STARTER,
  WORKFLOW_INPUT_UTIL,
  ROUND_VERDICT_UTIL,
  AGENT_PROMPT_UTIL,
  DISPATCH_WORDING_UTIL,
  DISPATCHER_CLAIM_NOTE_UTIL,
} = DISPATCHER_MODULE_PATHS;

function ticketIdsFrom(first: number, count: number): string[] {
  return Array.from({ length: count }, (_unused, i) => String(first + i).padStart(3, '0'));
}

export function kindsAndTickets(run: RecordedDispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
}

function parkedIds(run: RecordedDispatchRun): string[] {
  return runSummaryOf(run).parked.map((parkedTicket) => parkedTicket.id);
}

function reviewsOf(run: RecordedDispatchRun, ticketId: string): number {
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

const GRANT_ROUND_THREE_WITHOUT_CONVERGENCE: SourceMutant = {
  modulePath: ROUND_VERDICT_UTIL,
  find:       'if (requestedRound === DISPATCH_POLICY.ROUND_GRANTED_ON_REWORK_ALONE) return { granted: true };',
  replace:    'return { granted: true };',
};

// The prompt's source escapes the apostrophe, so the mutant's text does too.
const CARRY_ON_PAST_NO_CLAIM: SourceMutant = {
  modulePath: AGENT_PROMPT_UTIL,
  find:       'the claim is this run\\\'s own: an earlier attempt',
  replace:    'the claim is another agent\\\'s: an earlier attempt',
};

const SKIP_A_CLAIM_REFUSED_BY_THE_RUN_ITSELF: SourceMutant = {
  modulePath: DISPATCH_RUN,
  find:       'if (reading.outcome === \'claim-refused\' && reading.claimNote === DispatcherClaimNoteUtil.claimNoteFor(this.settings.runLabel, ticketId)) {',
  replace:    'if (reading.outcome === \'claim-refused\' && false) {',
};

const ADD_A_SECOND_BAR: SourceMutant = { modulePath: AGENT_PROMPT_UTIL, find: 'take it as your bar and add none', replace: 'add your own beside it' };

const SUBTRACT_EVERY_OWN_AGENT: SourceMutant = {
  modulePath: DISPATCH_RUN,
  find:       '.filter((ownAgent) => this.ownAgentIsConfirmedByStatus(ownAgent.work, status)).length',
  replace:    '.length',
};

const SETTLE_THEN_ADOPT = '    if (finished.reading === null && this.runWasStoppedByFailures) this.settleDeadAgentOfAStoppedRun(finished.work);\n'
  + '    else this.settle(finished);\n'
  + '    if (finished.reading !== null) this.adoptStatusReading(finished.reading.status);\n';

const ADOPT_THEN_SETTLE = '    if (finished.reading !== null) this.adoptStatusReading(finished.reading.status);\n'
  + '    if (finished.reading === null && this.runWasStoppedByFailures) this.settleDeadAgentOfAStoppedRun(finished.work);\n'
  + '    else this.settle(finished);\n';

const PARK_WITHOUT_RELEASING_THE_ROWS: SourceMutant = {
  modulePath: DISPATCH_RUN,
  find:       '    this.releaseRowsOf(ticketId, { cause: \'parked\', parkReason: reason });\n',
  replace:    '',
};

const LEAVE_TAKEOVERS_UNSTARTED_RUNNING: SourceMutant = {
  modulePath: DISPATCH_RUN,
  find:       'this.rowsToRelease = [...this.takeoversWaiting.values()];',
  replace:    'this.rowsToRelease = [];',
};

const NEVER_STOP_ON_DEAD_AGENTS: SourceMutant = {
  modulePath: DISPATCH_RUN,
  find:       '    if (this.consecutiveDeadAgents < DISPATCH_POLICY.CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING || this.runWasStoppedByFailures) return;',
  replace:    '    return;',
};

const STATUS_WITHOUT_ROWS_CONFIRMS = 'if (confirmingTicketIds === \'unlisted\') return work.kind === \'review\' && work.barIsHandedOn === true;';

function workersRunOn(run: RecordedDispatchRun, model: string, effort: string): boolean {
  const workers = run.calls.filter((call) => call.kind === 'build' || call.kind === 'review');
  return workers.length > 0 && workers.every((call) => call.model === model && call.effort === effort);
}

function releasedEveryRow(run: RecordedDispatchRun): boolean {
  return run.rowsRunningAtEnd.length === 0 && !run.logs.some((message) => message.includes('No slot free'));
}

function kindsAndTicketsOf(run: RecordedDispatchRun, runName: DispatchRunName): string {
  return run.calls.filter((call) => call.run === runName).map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`)).join(', ');
}

function racingSummaryOf(run: RecordedDispatchRun): DispatchSummary | null {
  return dispatchSummaryFrom(run.racingSummary);
}

function buildersOnBoardOf(run: RecordedDispatchRun, ticketId: string): string {
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

const ONE_NOTE_FOR_EVERY_RUN: SourceMutant = {
  modulePath: DISPATCHER_CLAIM_NOTE_UTIL,
  find:       'ticketIds === null ? WHOLE_BOARD_RUN_LABEL :',
  replace:    'true ? WHOLE_BOARD_RUN_LABEL :',
};

export const DECISION_CLAIMS: readonly DispatchClaim[] = [
  {
    name:        'the agents running at once never exceed a board limit of 2',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ticketIdsFrom(1, 5) }),
    holds:       (run) => run.mostAgentsAtOnce === 2 && runSummaryOf(run).delivered.length === 5,
    mutant:      { modulePath: DISPATCH_RUN, find: 'Math.min(statedLimit, LIMITS.CONCURRENCY_LIMIT_CEILING_AGENTS)', replace: 'LIMITS.CONCURRENCY_LIMIT_CEILING_AGENTS' },
  },
  {
    name:        'never more than 10 run at once, even with a board limit of 12 and none in flight elsewhere',
    scenarioFor: () => ({ limit: 12, readyTicketIds: ticketIdsFrom(1, 15) }),
    holds:       (run) => run.mostAgentsAtOnce === 10 && runSummaryOf(run).delivered.length === 15,
    mutant:      { modulePath: DISPATCH_RUN, find: 'Math.min(statedLimit, LIMITS.CONCURRENCY_LIMIT_CEILING_AGENTS)', replace: 'statedLimit' },
  },
  {
    name:        'agents in flight elsewhere take their share of the board limit',
    scenarioFor: () => ({ limit: 3, otherAgentsInFlight: 1, readyTicketIds: ticketIdsFrom(1, 5) }),
    holds:       (run) => run.mostAgentsAtOnce === 2,
    mutant:      { modulePath: DISPATCH_RUN, find: 'Math.max(0, status.agentsInFlight - ownAgentsConfirmedByStatus)', replace: '0' },
  },
  {
    // An own agent launched a moment before a status block was taken has not claimed yet: subtracting it too would read a real other agent as free.
    name:        'agents in flight elsewhere plus every own agent, on the board yet or not, never exceed the board limit',
    scenarioFor: () => ({ limit: 3, otherAgentsInFlight: 1, readyTicketIds: ticketIdsFrom(1, 5) }),
    holds:       (run) => run.mostAgentsInFlightAtOnce === 3 && runSummaryOf(run).delivered.length === 5,
    mutant:      SUBTRACT_EVERY_OWN_AGENT,
  },
  {
    name:        'the limit holds when own agents take several turns to reach the board, with two agents in flight elsewhere',
    scenarioFor: () => ({
      limit:                   4,
      otherAgentsInFlight:     2,
      readyTicketIds:          ticketIdsFrom(1, 6),
      turnsBeforeFirstCommand: 3,
    }),
    holds:  (run) => run.mostAgentsInFlightAtOnce === 4 && runSummaryOf(run).delivered.length === 6,
    mutant: SUBTRACT_EVERY_OWN_AGENT,
  },
  {
    // A reviewer reaches the board through `task add --review-of --start`, which checks no limit, so only the dispatcher's count keeps it inside one.
    name:        'the limit holds when reviewers reach the board late, each confirmed by its reviewOf row and not before',
    scenarioFor: () => ({
      limit:                   4,
      otherAgentsInFlight:     2,
      readyTicketIds:          [],
      reviewWaitingTicketIds:  ticketIdsFrom(1, 6),
      turnsBeforeFirstCommand: 3,
    }),
    holds:  (run) => run.mostAgentsInFlightAtOnce === 4 && runSummaryOf(run).delivered.length === 6,
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'const confirmingTicketIds = work.kind === \'build\' ? status.inProgressTicketIds : status.inProgressReviewOfIds;',
      replace:    'if (work.kind === \'review\') return true; const confirmingTicketIds = status.inProgressTicketIds;',
    },
  },
  {
    // A status block without the running rows confirms no own agent, so every agent the board counts is taken as another's: the safe side.
    name:        'a status block without the running rows subtracts no own agent, and the limit still holds',
    scenarioFor: () => ({
      limit:                     3,
      otherAgentsInFlight:       1,
      readyTicketIds:            ticketIdsFrom(1, 3),
      reviewWaitingTicketIds:    ticketIdsFrom(7, 3),
      statusOmitsInProgressRows: true,
    }),
    holds:  (run) => run.mostAgentsInFlightAtOnce <= 3 && runSummaryOf(run).delivered.length === 6,
    mutant: { modulePath: DISPATCH_RUN, find: STATUS_WITHOUT_ROWS_CONFIRMS, replace: 'if (confirmingTicketIds === \'unlisted\') return true;' },
  },
  {
    name:        'a waiting review starts before a ready ticket',
    scenarioFor: () => ({ limit: 1, reviewWaitingTicketIds: ['001'], readyTicketIds: ['002', '003'] }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey, review 001, build 002, review 002, build 003, review 003',
    mutant:      {
      modulePath: DISPATCH_RUN,
      find:       'const review = this.reviewQueue.shift();',
      replace:    'const review = (this.latestStatusReading?.readyTicketIds ?? []).some((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId))'
        + ' ? undefined : this.reviewQueue.shift();',
    },
  },
  {
    name:        'a ticket filed mid-run, appearing in a returned status block, is dispatched',
    scenarioFor: () => ({
      limit:          1,
      readyTicketIds: ['001'],
      afterAgent:     (call, board) => { if (call.kind === 'build' && call.ticketId === '001') board.readyTicketIds.push('002'); },
    }),
    holds:  (run) => kindsAndTickets(run).includes('build 002') && runSummaryOf(run).delivered.includes('002'),
    mutant: { modulePath: DISPATCH_RUN, find: 'if (finished.reading !== null) this.adoptStatusReading(finished.reading.status);', replace: '' },
  },
  {
    name:        'round 2 is granted at 751 reworked lines',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 751 } : { verdict: 'released' }),
    }),
    holds:  (run) => reviewsOf(run, '001') === 2 && runSummaryOf(run).delivered.includes('001'),
    mutant: {
      modulePath: ROUND_VERDICT_UTIL,
      find:       'current.reworkedLines <= DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES',
      replace:    'current.reworkedLines <= DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES + 1',
    },
  },
  {
    name:        'round 2 is refused at 750 reworked lines, and the ticket is parked',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 750 } : { verdict: 'released' }),
    }),
    holds:  (run) => reviewsOf(run, '001') === 1 && parkedIds(run).includes('001'),
    mutant: {
      modulePath: ROUND_VERDICT_UTIL,
      find:       'current.reworkedLines <= DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES',
      replace:    'current.reworkedLines < DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES',
    },
  },
  {
    name:        'round 3 is refused when round 2 found more than half of round 1\'s findings',
    scenarioFor: () => roundThreeScenario([finding('spacing', 'a.ts'), finding('spacing', 'b.ts'), finding('typing', 'a.ts')]),
    holds:       (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:      GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:        'round 3 is refused when round 2 repeats a class an earlier round found',
    scenarioFor: () => roundThreeScenario([finding('naming', 'a.ts')]),
    holds:       (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:      GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:        'round 3 is refused when round 2 names a file no earlier round named',
    scenarioFor: () => roundThreeScenario([finding('spacing', 'c.ts')]),
    holds:       (run) => reviewsOf(run, '001') === 2 && parkedIds(run).includes('001'),
    mutant:      GRANT_ROUND_THREE_WITHOUT_CONVERGENCE,
  },
  {
    name:        'round 3 is granted when round 2 converges: at most half the findings, a new class, known files',
    scenarioFor: () => roundThreeScenario([finding('spacing', 'a.ts'), finding('typing', 'b.ts')]),
    holds:       (run) => reviewsOf(run, '001') === 3 && runSummaryOf(run).delivered.includes('001'),
    mutant:      {
      modulePath: ROUND_VERDICT_UTIL,
      find:       '  return { granted: true };\n}\n\nexport const',
      replace:    '  return refused({ reason: \'previous-round-not-reviewed-in-this-run\', requestedRound });\n}\n\nexport const',
    },
  },
  {
    name:        'a reviewer\'s stated round overrides the round the dispatcher counted',
    scenarioFor: () => ({
      limit:             2,
      readyTicketIds:    ['001'],
      reviewerReply:     (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 900, findings: [finding('naming', 'a.ts')] } : { verdict: 'released' }),
      agentMisbehaviour: (call) => (call.kind === 'review' && call.ordinal === 1 ? { replacesFields: { round: 3 } } : undefined),
    }),
    holds:  (run) => reviewsOf(run, '001') === 1 && parkedIds(run).includes('001'),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'const round = reading.round === \'unstated\' ? work.round : reading.round;',
      replace:    'const round = work.round;',
    },
  },
  {
    name:        'a first does-not-hold sends a fresh builder, and a second parks the ticket',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['001'], reviewerReply: () => ({ verdict: 'does-not-hold' }) }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 001, review 001, park 001' && parkedIds(run).includes('001'),
    mutant:      {
      modulePath: DISPATCH_RUN,
      find:       'record.failedPasses >= DISPATCH_POLICY.FAILED_PASSES_BEFORE_PARKING',
      replace:    'record.failedPasses > DISPATCH_POLICY.FAILED_PASSES_BEFORE_PARKING',
    },
  },
  {
    name:        'a builder that returns nothing is a failed pass, and a fresh builder takes the ticket',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['001'], builderReply: (_ticketId, pass) => (pass === 1 ? null : { outcome: 'in-review' }) }),
    holds:       (run) => runSummaryOf(run).delivered.includes('001') && run.logs.some((message) => message.includes('#001: the builder returned no result')),
    mutant:      {
      modulePath: DISPATCH_RUN,
      find:       'this.countFailedPass(ticketId, { cause: \'builder-returned-nothing\' }, rebuild, work);',
      replace:    'this.park(ticketId, { cause: \'release-refused\', statedReason: \'mutant\' });',
    },
  },
  {
    // A builder that stops short of `ticket finish` leaves its claimed row running: read as another agent's, it alone would fill a limit of 1.
    name:        'with a limit of 1, a builder that failed with its row left running is followed by a fresh builder that takes that row over and delivers',
    scenarioFor: () => ({ limit: 1, readyTicketIds: ['001'], builderReply: (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }) }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, build 001, review 001'
      && runSummaryOf(run).delivered.join() === '001'
      && run.mostAgentsInFlightAtOnce === 1,
    mutant: { modulePath: DISPATCH_RUN, find: SETTLE_THEN_ADOPT, replace: ADOPT_THEN_SETTLE },
  },
  {
    // Every builder's claim counts the board's running rows, so a parked ticket's row left running would keep the next ticket out for the whole run.
    name:        'with a limit of 1, a ticket parked after two failed builders has its row paused, and the next ready ticket is delivered',
    scenarioFor: () => ({ limit: 1, readyTicketIds: ['001', '002'], builderReply: (ticketId) => (ticketId === '001' ? { outcome: 'failed' } : { outcome: 'in-review' }) }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, build 001, park 001, build 002, review 002'
      && runSummaryOf(run).delivered.join() === '002'
      && parkedIds(run).join() === '001'
      && run.rowsPaused.join() === 'build 001'
      && run.mostAgentsInFlightAtOnce === 1
      && run.mostLiveAgentsAtOnce === 1
      && releasedEveryRow(run),
    mutant: PARK_WITHOUT_RELEASING_THE_ROWS,
  },
  {
    // The reason reaches the board's log through the parking agent, where `review ()` reads as a detail that was lost.
    name:        'a builder that failed with no detail is parked on a reason without empty brackets',
    scenarioFor: () => ({ limit: 1, readyTicketIds: ['001'], builderReply: () => ({ outcome: 'failed' }) }),
    holds:       (run) => runSummaryOf(run).parked[0]?.reason === 'the builder did not reach review, the second failed pass'
      && run.calls.some((call) => call.kind === 'park' && call.prompt.includes('"Parked #001: the builder did not reach review, the second failed pass"')),
    mutant: { modulePath: DISPATCH_WORDING_UTIL, find: 'review${parentheticalOf(failure.detail)}`', replace: 'review (${failure.detail})`' },
  },
  {
    // Two dead reviewers back to back would read as an outage and stop the run, so a does-not-hold and a rebuild come between the failed passes.
    name:        'with a limit of 1, a ticket parked on a dead reviewer has its bar closed, and the next ready ticket is delivered within the limit',
    scenarioFor: () => ({
      limit:          1,
      readyTicketIds: ['001', '002'],
      reviewerReply:  (ticketId, round) => {
        if (ticketId !== '001') return { verdict: 'released' };
        return round === 1 ? { verdict: 'does-not-hold' } : null;
      },
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 001, review 001, park 001, build 002, review 002'
      && runSummaryOf(run).delivered.join() === '002'
      && parkedIds(run).join() === '001'
      && run.mostAgentsInFlightAtOnce === 1
      && run.mostLiveAgentsAtOnce === 1
      && releasedEveryRow(run),
    mutant: PARK_WITHOUT_RELEASING_THE_ROWS,
  },
  {
    // A stop keeps the fresh builder from starting, and nothing after the run would pause the row the failed one left.
    name:        'a board stopped while a failed builder\'s row waits for its takeover ends the run with that row paused, not running',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001'],
      builderReply:   (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
      afterAgent:     (call, board) => { if (call.kind === 'build') board.dispatcherState = 'stopped'; },
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, park 001'
      && run.rowsPaused.join() === 'build 001'
      && parkedIds(run).length === 0
      && run.rowsRunningAtEnd.length === 0
      && run.mostLiveAgentsAtOnce === 1
      && run.logs.some((message) => message.includes('Left for the user\'s go: #001')),
    mutant: LEAVE_TAKEOVERS_UNSTARTED_RUNNING,
  },
  {
    // A rebuild queued by does-not-hold has no paused row, so a stop that keeps it from starting leaves it waiting, not among the paused builds to resume.
    name:        'a board stopped after a does-not-hold leaves the queued rebuild for the user\'s go and out of the paused builds',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001'],
      reviewerReply:  () => ({ verdict: 'does-not-hold' }),
      afterAgent:     (call, board) => { if (call.kind === 'review') board.dispatcherState = 'stopped'; },
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001'
      && runSummaryOf(run).pausedBuilds === undefined
      && parkedIds(run).length === 0
      && run.logs.some((message) => message.includes('Left for the user\'s go: #001')),
    mutant: { modulePath: DISPATCH_RUN, find: 'rebuild.rowIsPaused === true && ', replace: '' },
  },
  {
    // The limit bounds agents alive, and a parking agent is one: with no agent just finished for it to replace, it would be one over the limit.
    name:        'a takeover kept out because agents elsewhere hold the whole limit starts no parking agent over it, and the log hands its row on by name',
    scenarioFor: () => ({
      limit:          1,
      readyTicketIds: ['001'],
      builderReply:   (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
      afterAgent:     (call, board) => { if (call.kind === 'build') board.otherAgentsInFlight = 1; },
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001'
      && run.mostLiveAgentsAtOnce === 1
      && run.rowsRunningAtEnd.join() === 'build 001'
      && run.logs.some((message) => message.includes('No slot free for an agent to pause the row of #001')),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'while (this.rowsToRelease.length > 0 && this.inFlight.size < this.ownSlotLimit())',
      replace:    'while (this.rowsToRelease.length > 0)',
    },
  },
  {
    // A dead reviewer returns no status block, so its bar is seen only in a later agent's: there, with an agent started elsewhere, the bar read as
    // another's fills the limit of 2 and the fresh reviewer would never start.
    name:        'a reviewer that returned nothing leaves its bar running, and a fresh reviewer takes it over although that bar and an agent elsewhere fill the limit',
    scenarioFor: () => ({
      limit:                  2,
      readyTicketIds:         [],
      reviewWaitingTicketIds: ['001', '002', '003'],
      reviewerReply:          (ticketId, round) => (ticketId === '001' && round === 1 ? null : { verdict: 'released' }),
      afterAgent:             (call, board) => { if (call.kind === 'review' && call.ticketId === '002') board.otherAgentsInFlight = 1; },
    }),
    holds: (run) => reviewsOf(run, '001') === 2
      && runSummaryOf(run).delivered.length === 3
      && run.mostAgentsInFlightAtOnce === 2,
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '() => { this.awaitTakeover(this.reviewWorkFor(ticketId, true, true)); }',
      replace:    '() => { this.reviewQueue.push(this.reviewWorkFor(ticketId, true, true)); }',
    },
  },
  {
    // Counted as another's, the row left running would hold a slot beside the fresh agent that took it over, and the ticket filed meanwhile would wait.
    name:        'a row left running for a fresh builder is the dispatcher\'s own, so a ticket filed meanwhile starts beside that fresh builder',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001'],
      builderReply:   (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
      afterAgent:     (call, board) => { if (call.kind === 'build' && call.ordinal === 1 && call.ticketId === '001') board.readyTicketIds.push('002'); },
    }),
    holds: (run) => kindsAndTickets(run).slice(0, 4).join(', ') === 'survey, build 001, build 001, build 002'
      && runSummaryOf(run).delivered.length === 2
      && run.mostAgentsInFlightAtOnce === 2,
    mutant: { modulePath: DISPATCH_RUN, find: '\n      + this.takeoversConfirmedByStatus(status).length', replace: '' },
  },
  {
    // The row left running is subtracted from the others, so work started ahead of its takeover would put the board over the limit.
    name:        'the takeover of a row left running starts before other work, so that row and the agents in flight never exceed the limit',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ticketIdsFrom(1, 3),
      builderReply:   (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
    }),
    holds:  (run) => run.mostAgentsInFlightAtOnce === 2 && runSummaryOf(run).delivered.length === 3,
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'if (takeover !== undefined) {',
      replace:    'if (takeover !== undefined && this.reviewQueue.length === 0'
        + ' && (this.latestStatusReading?.readyTicketIds ?? []).every((ticketId) => this.ticketIdsTakenThisRun.has(ticketId))) {',
    },
  },
  {
    name:        'a refused claim skips the ticket for this run, logged, while the rest go ahead',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001', '002'],
      builderReply:   (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'claim-refused', detail: 'waits on #009' } : { outcome: 'in-review' }),
    }),
    holds: (run) => reviewsOf(run, '001') === 0
      && run.calls.filter((call) => call.ticketId === '001').length === 1
      && runSummaryOf(run).delivered.join() === '002'
      && run.logs.some((message) => message.includes('#001 skipped for this run')),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'this.ports.logger.ticketSkipped(ticketId, reading.detail);',
      replace:    'this.rebuildQueue.push({ kind: \'build\', ticketId, previousPass: \'builder\' });',
    },
  },
  {
    // A killed run is resumed from its journal, and the builder that was in flight runs again with the same prompt: its first attempt's claim
    // refuses the second, and a builder that stopped there would leave the ticket stalled and its row holding the only slot.
    name:        'a builder resumed after its run was killed finds its ticket claimed and its worktree present, carries on in it, and delivers',
    scenarioFor: () => ({ limit: 1, readyTicketIds: ['001', '002'], killedAtFirstCommandOf: 'build 001' }),
    holds:       (run) => run.resumed
      && kindsAndTickets(run).join(', ') === 'survey, build 001, build 001, review 001, build 002, review 002'
      && runSummaryOf(run).delivered.join() === '001,002'
      && run.rowsRunningAtEnd.length === 0
      && run.mostAgentsInFlightAtOnce === 1,
    mutant: CARRY_ON_PAST_NO_CLAIM,
  },
  {
    // Observed: a model call that hangs is interrupted and the agent started again with the same prompt, inside the one `agent()` call.
    name:        'a builder the runtime restarts within one run carries on past its first attempt\'s claim, and the next ticket is delivered within the limit',
    scenarioFor: () => ({ limit: 1, readyTicketIds: ['001', '002'], restartedBuilderTicketIds: ['001'] }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 002, review 002'
      && runSummaryOf(run).delivered.join() === '001,002'
      && run.rowsRunningAtEnd.length === 0
      && run.mostAgentsInFlightAtOnce === 1,
    mutant: CARRY_ON_PAST_NO_CLAIM,
  },
  {
    // A restarted builder that returns `claim-refused` anyway leaves the run's own row running; skipped, that row would read as another agent's.
    name:        'a claim refused while the run\'s own claim holds the ticket is taken over by a fresh builder, never skipped with that row holding a slot',
    scenarioFor: () => ({
      limit:                     1,
      readyTicketIds:            ['001', '002'],
      restartedBuilderTicketIds: ['001'],
      builderReply:              (ticketId, pass) => (ticketId === '001' && pass === 1 ? { outcome: 'claim-refused', detail: '#001 is in-progress' } : { outcome: 'in-review' }),
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, build 001, review 001, build 002, review 002'
      && runSummaryOf(run).delivered.join() === '001,002'
      && run.rowsRunningAtEnd.length === 0
      && run.mostAgentsInFlightAtOnce === 1,
    mutant: SKIP_A_CLAIM_REFUSED_BY_THE_RUN_ITSELF,
  },
  {
    name:        'a ticket whose own claim is refused on both passes is parked with its row paused, and the next ready ticket is delivered within the limit',
    scenarioFor: () => ({
      limit:                     1,
      readyTicketIds:            ['001', '002'],
      restartedBuilderTicketIds: ['001'],
      builderReply:              (ticketId) => (ticketId === '001' ? { outcome: 'claim-refused', detail: '#001 is in-progress' } : { outcome: 'in-review' }),
    }),
    holds: (run) => parkedIds(run).join() === '001'
      && run.rowsPaused.join() === 'build 001'
      && runSummaryOf(run).delivered.join() === '002'
      && run.rowsRunningAtEnd.length === 0
      && run.mostLiveAgentsAtOnce === 1,
    mutant: SKIP_A_CLAIM_REFUSED_BY_THE_RUN_ITSELF,
  },
  {
    // The reviewer in flight when the run was killed had added its bar; a second bar would leave the first running for the rest of the run.
    name:        'a reviewer resumed after its run was killed takes its first attempt\'s bar over and adds no second',
    scenarioFor: () => ({
      limit:                  1,
      readyTicketIds:         [],
      reviewWaitingTicketIds: ['001'],
      killedAtFirstCommandOf: 'review 001',
    }),
    holds: (run) => run.resumed
      && reviewsOf(run, '001') === 2
      && run.reviewBarsAdded.join() === 'review 001'
      && runSummaryOf(run).delivered.join() === '001'
      && run.rowsRunningAtEnd.length === 0,
    mutant: ADD_A_SECOND_BAR,
  },
  {
    // A second bar left running is read as another agent's, and at a limit of 1 it keeps the rebuild the review asked for from ever starting.
    name:        'a reviewer the runtime restarts within one run takes its first attempt\'s bar over, so the rebuild it asks for starts within the limit',
    scenarioFor: () => ({
      limit:                      1,
      readyTicketIds:             [],
      reviewWaitingTicketIds:     ['001'],
      restartedReviewerTicketIds: ['001'],
      reviewerReply:              (_ticketId, round) => (round === 1 ? { verdict: 'does-not-hold' } : { verdict: 'released' }),
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, review 001, build 001, review 001'
      && runSummaryOf(run).delivered.join() === '001'
      && run.reviewBarsAdded.join(', ') === 'review 001, review 001'
      && run.rowsRunningAtEnd.length === 0,
    mutant: ADD_A_SECOND_BAR,
  },
  {
    // `ticket rereview` is not idempotent: run again by the restarted attempt, it leaves the ticket and its row a round ahead of the review done.
    name:        'a round-2 reviewer the runtime restarts within one run finds the bar of its round running and runs ticket rereview once',
    scenarioFor: () => ({
      limit:                      2,
      readyTicketIds:             ['001'],
      restartedReviewerTicketIds: ['001'],
      restartedReviewerRound:     2,
      reviewerReply:              (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 900 } : { verdict: 'released' }),
    }),
    holds: (run) => reviewsOf(run, '001') === 2
      && run.rereviewsRun.join(', ') === 'rereview 001 round 2'
      && runSummaryOf(run).delivered.join() === '001'
      && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: AGENT_PROMPT_UTIL, find: 'skip the rereview and take that row as your bar. ', replace: 'run the rereview regardless. ' },
  },
  {
    name:        'a release refused for a reason other than main-moved parks the ticket',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['001'], reviewerReply: () => ({ verdict: 'not-released', releaseReason: 'main-checkout-dirty' }) }),
    holds:       (run) => reviewsOf(run, '001') === 1 && runSummaryOf(run).parked.some((parkedTicket) => parkedTicket.reason.includes('main-checkout-dirty')),
    mutant:      { modulePath: DISPATCH_RUN, find: 'reading.releaseRefusal !== \'main-moved\'', replace: 'false' },
  },
  {
    name:        'the run ends when nothing is ready or running, and returns the summary of what it did',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001', '002'],
      reviewerReply:  (ticketId) => (ticketId === '001' ? { verdict: 'released', filedTicketIds: ['009'] } : { verdict: 'not-released', releaseReason: 'branch-diverged' }),
    }),
    holds: (run) => JSON.stringify(run.summary) === JSON.stringify({
      delivered:     ['001'],
      parked:        [{ id: '002', reason: 'the release was refused: branch-diverged' }],
      findingsFiled: ['009'],
      agentsRun:     6,
    }),
    mutant: { modulePath: DISPATCH_WORDING_UTIL, find: '    agentsRun:     outcome.agentsRun,\n', replace: '' },
  },
  {
    name:        'a board stopped mid-run starts no new agent, while the agents in flight finish and a reviewer among them still releases',
    scenarioFor: () => ({
      limit:                  2,
      reviewWaitingTicketIds: ['001'],
      readyTicketIds:         ['002', '003'],
      afterAgent:             (call, board) => { if (call.kind === 'review' && call.ticketId === '001') board.dispatcherState = 'stopped'; },
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, review 001, build 002, park 002'
      && runSummaryOf(run).delivered.join() === '001'
      && runSummaryOf(run).stoppedByBoard === true,
    mutant: { modulePath: DISPATCH_RUN, find: 'return this.runWasStoppedByBoard || this.runWasStoppedByFailures;', replace: 'return this.runWasStoppedByFailures;' },
  },
  {
    name:        'a board stopped when the run starts dispatches nothing, and the summary says the board stopped it',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['001'], dispatcherState: 'stopped' }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey' && JSON.stringify(run.summary) === JSON.stringify({
      delivered:      [],
      parked:         [],
      findingsFiled:  [],
      agentsRun:      1,
      stoppedByBoard: true,
    }),
    mutant: { modulePath: DISPATCH_WORDING_UTIL, find: '  if (outcome.runWasStoppedByBoard) summary.stoppedByBoard = true;\n', replace: '' },
  },
  {
    // Low tickets are the orchestrator's to triage first: abandon the stale, merge the overlapping, then relaunch with the flag.
    name:        'with only low tickets ready and no includeLowPriority, no builder starts and the summary lists them as lowPriorityWaiting',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['004', '005'], lowPriorityTicketIds: ['004', '005'] }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey' && runSummaryOf(run).lowPriorityWaiting?.join() === '004,005',
    mutant:      { modulePath: DISPATCH_RUN, find: ' && this.readyTicketIsAdmitted(ticketId));', replace: ');' },
  },
  {
    name:        'with includeLowPriority, the low tickets ready are dispatched and delivered',
    scenarioFor: () => ({
      limit:                2,
      readyTicketIds:       ['004', '005'],
      lowPriorityTicketIds: ['004', '005'],
      includeLowPriority:   true,
    }),
    holds:  (run) => runSummaryOf(run).delivered.join() === '004,005' && runSummaryOf(run).lowPriorityWaiting === undefined,
    mutant: { modulePath: WORKFLOW_INPUT_UTIL, find: 'lowPriorityIsIncluded: given[\'includeLowPriority\'] === true,', replace: 'lowPriorityIsIncluded: false,' },
  },
  {
    // A reviewer files its findings as low tickets minutes before the normal work runs out; the run must not pick them up untriaged.
    name:        'a low ticket filed mid-run while normal work remains is not started, and is left for triage',
    scenarioFor: () => ({
      limit:          1,
      readyTicketIds: ['001', '002'],
      afterAgent:     (call, board) => {
        if (call.kind !== 'review' || call.ticketId !== '001') return;
        board.readyTicketIds.push('009');
        board.lowPriorityTicketIds.push('009');
      },
    }),
    holds: (run) => !kindsAndTickets(run).includes('build 009')
      && runSummaryOf(run).delivered.join() === '001,002'
      && runSummaryOf(run).lowPriorityWaiting?.join() === '009',
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'this.lowPriorityReadyTicketIds = lowPriorityReadyTicketIdsOf(status);',
      replace:    'if (this.agentsRun === 1) this.lowPriorityReadyTicketIds = lowPriorityReadyTicketIdsOf(status);',
    },
  },
  {
    // Starting untriaged low work cannot be undone and holding back normal work can, so a block that states no priorities errs on the low side.
    name:        'a ready ticket whose priority the status block does not state is not started, and is left for triage',
    scenarioFor: () => ({
      limit:                   2,
      readyTicketIds:          ['004'],
      statusOmitsReadyTickets: true,
    }),
    holds:  (run) => kindsAndTickets(run).join(', ') === 'survey' && runSummaryOf(run).lowPriorityWaiting?.join() === '004',
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '!priorityIsAdmittedWithoutTriage(readyTicketEntryOf(status.readyTickets, ticketId)?.priority)',
      replace:    'readyTicketEntryOf(status.readyTickets, ticketId)?.priority === \'low\'',
    },
  },
  {
    // The Workflow tool gives an agent without an effort the orchestrator's, which is how a fan-out runs at a tier nobody chose.
    name:        'a ticket naming no model or effort runs its builder and its reviewer on opus at medium effort',
    scenarioFor: () => ({ limit: 1, readyTicketIds: ['001'] }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001' && workersRunOn(run, 'opus', 'medium'),
    mutant:      {
      modulePath: AGENT_STARTER,
      find:       'schema: AGENT_REPLY_SCHEMAS.BUILDER,\n        model,\n        effort,',
      replace:    'schema: AGENT_REPLY_SCHEMAS.BUILDER,\n        model,',
    },
  },
  {
    // A taken ticket leaves the ready list, so the rebuild and the second review can only run on what was recorded when it was taken.
    name:        'a ticket naming sonnet at high effort runs every builder and reviewer on those, a rebuild after does-not-hold included, each owning its row as sonnet',
    scenarioFor: () => ({
      limit:                   1,
      readyTicketIds:          ['001'],
      agentSettingsByTicketId: { '001': { model: 'sonnet', effort: 'high' } },
      reviewerReply:           (_ticketId, round) => (round === 1 ? { verdict: 'does-not-hold' } : { verdict: 'released' }),
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 001, review 001'
      && workersRunOn(run, 'sonnet', 'high')
      && run.calls.filter((call) => call.kind !== 'survey').every((call) => call.prompt.includes('--owner sonnet')),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '    this.ticketRecordFor(readyTicketId).agentModelAndEffort = readyTicketEntryOf(this.readyTicketsStatement(), readyTicketId)?.agentModelAndEffort'
        + ' ?? defaultAgentModelAndEffort();\n',
      replace: '',
    },
  },
  {
    name:        'a review waiting when the run starts runs on the model and effort its ticket names',
    scenarioFor: () => ({
      limit:                   1,
      readyTicketIds:          [],
      reviewWaitingTicketIds:  ['001'],
      agentSettingsByTicketId: { '001': { model: 'sonnet', effort: 'high' } },
    }),
    holds:  (run) => kindsAndTickets(run).join(', ') === 'survey, review 001' && workersRunOn(run, 'sonnet', 'high'),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '      this.ticketRecordFor(reviewWaitingTicket.id).agentModelAndEffort = reviewWaitingTicket.agentModelAndEffort;\n',
      replace:    '',
    },
  },
  {
    // A block that lost `readyTickets` cannot say what the ticket names, and the tool's defaults are the one pair nobody has to have chosen.
    name:        'a status block without readyTickets runs a ticket that names sonnet at high on opus at medium, once admitted as low',
    scenarioFor: () => ({
      limit:                   1,
      readyTicketIds:          ['001'],
      agentSettingsByTicketId: { '001': { model: 'sonnet', effort: 'high' } },
      statusOmitsReadyTickets: true,
      includeLowPriority:      true,
    }),
    holds:  (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001' && workersRunOn(run, 'opus', 'medium'),
    // A ready ticket without an entry is not read at the input edge at all: the run falls back to the defaults when it takes the ticket.
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'return { model: DEFAULT_AGENT_MODEL, effort: DEFAULT_AGENT_EFFORT };',
      replace:    'return { model: DEFAULT_AGENT_MODEL, effort: undefined };',
    },
  },
  {
    name:        'a low ticket left for triage is logged as such, never as waiting for a slot other agents hold',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['004'], lowPriorityTicketIds: ['004'] }),
    holds:       (run) => run.logs.some((message) => message.includes('triage, low priority: #004')) && !run.logs.some((message) => message.includes('No slot free')),
    mutant:      {
      modulePath: DISPATCH_RUN,
      find:       '...this.untakenTicketIds(),',
      replace:    '...(this.latestStatusReading?.readyTicketIds ?? []).filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId)),',
    },
  },
  {
    // A plain `ticket finish` frees the slot until the reviewer's `task add --start`, which checks no limit: a claim in between puts the board one over.
    name:        'every builder moves its ticket to review with --start-review, so no claim from elsewhere finds its slot free before the reviewer starts',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ticketIdsFrom(1, 3), elsewhereClaimsAFreedSlot: true }),
    holds:       (run) => run.slotGaps.length === 0
      && run.mostAgentsOnBoardAtOnce === 2
      && runSummaryOf(run).delivered.length === 3
      && run.reviewBarsAdded.join(', ') === 'review 001, review 002, review 003',
    mutant: {
      modulePath: AGENT_PROMPT_UTIL,
      find:       '${startReviewCommandOf(settings, \'finish\', ticketId, owner)}',
      replace:    'agent-progress ticket finish ${ticketId}',
    },
  },
  {
    // A reviewer closing its bar on round-requested would free the slot until the next round's `rereview --start-review`, and a claim in between takes it.
    name:        'a reviewer asking for another round leaves its bar running for the next round, so no claim from elsewhere finds the ticket\'s slot free',
    scenarioFor: () => ({
      limit:                     2,
      readyTicketIds:            ticketIdsFrom(1, 2),
      elsewhereClaimsAFreedSlot: true,
      reviewerReply:             (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 900 } : { verdict: 'released' }),
    }),
    holds: (run) => run.slotGaps.length === 0
      && run.mostAgentsOnBoardAtOnce <= 2
      && runSummaryOf(run).delivered.length === 2
      && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: AGENT_PROMPT_UTIL, find: 'leave your bar running: ', replace: 'close it and leave nothing running: ' },
  },
  {
    // Read as another agent's, the bar the builder left would fill a limit of 1, and the reviewer it was started for would never run.
    name:        'the reviewer takes over the bar its builder\'s --start-review left running, so at a limit of 1 it starts at once and adds no second bar',
    scenarioFor: () => ({ limit: 1, readyTicketIds: ['001', '002'] }),
    holds:       (run) => kindsAndTickets(run).join(', ') === 'survey, build 001, review 001, build 002, review 002'
      && run.reviewBarsAdded.join(', ') === 'review 001, review 002'
      && run.mostAgentsOnBoardAtOnce === 1
      && run.rowsRunningAtEnd.length === 0,
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'this.awaitTakeover({ ...this.reviewWorkFor(ticketId, false, false), barIsHandedOn: true });',
      replace:    'this.queueReview(ticketId, false);',
    },
  },
  {
    // The builder's `in-review` reply is word that its bar runs; without it, a block lacking the rows would leave every built ticket's bar unstarted.
    name:        'a status block without the running rows still counts the bar a builder handed on as the run\'s own, so every ticket is reviewed and delivered',
    scenarioFor: () => ({
      limit:                     3,
      otherAgentsInFlight:       1,
      readyTicketIds:            ticketIdsFrom(1, 3),
      reviewWaitingTicketIds:    ticketIdsFrom(7, 3),
      statusOmitsInProgressRows: true,
    }),
    holds:  (run) => run.mostAgentsOnBoardAtOnce <= 3 && runSummaryOf(run).delivered.length === 6,
    mutant: { modulePath: DISPATCH_RUN, find: STATUS_WITHOUT_ROWS_CONFIRMS, replace: 'if (confirmingTicketIds === \'unlisted\') return false;' },
  },
  {
    name:        'with ticketIds, no survey agent runs',
    scenarioFor: () => SINGLE_TICKET_RUN_AMONG_OTHERS,
    holds:       (run) => run.calls.length > 0 && run.calls.every((call) => call.kind !== 'survey'),
    mutant:      { modulePath: DISPATCHER, find: 'if (settings.ticketIds === null) {\n    runtime.phase(\'Survey\');', replace: 'if (true) {\n    runtime.phase(\'Survey\');' },
  },
  {
    // The single-ticket run is one agent's work: an agent() call for any other ticket would be a second agent the orchestrator never launched.
    name:        'with ticketIds [007] and other tickets ready, only #007 is built, reviewed and released, and no agent() call names another ticket',
    scenarioFor: () => SINGLE_TICKET_RUN_AMONG_OTHERS,
    holds:       (run) => kindsAndTickets(run).join(', ') === 'build 007, review 007'
      && run.calls.every((call) => call.ticketId === '007')
      && JSON.stringify(run.summary) === JSON.stringify({
        delivered: ['007'], parked: [], findingsFiled: [], agentsRun: 2 
      }),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'if (this.settings.ticketIds !== null) return this.settings.ticketIds.filter(',
      replace:    'if (this.settings.ticketIds !== null && this.latestStatusReading === null) return this.settings.ticketIds.filter(',
    },
  },
  {
    name:        'with ticketIds, a ticket whose builders fail twice returns as parked, its row paused, and no other ticket is started',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001', '007'],
      ticketIds:      ['007'],
      builderReply:   (ticketId) => (ticketId === '007' ? { outcome: 'failed' } : { outcome: 'in-review' }),
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'build 007, build 007, park 007'
      && parkedIds(run).join() === '007'
      && runSummaryOf(run).delivered.length === 0
      && run.rowsPaused.join() === 'build 007'
      && run.rowsRunningAtEnd.length === 0,
    mutant: PARK_WITHOUT_RELEASING_THE_ROWS,
  },
  {
    // The atomic claim decides the race; the note tells a run its own claim from the other's, so the loser moves on instead of carrying on beside it.
    name:        'a single-ticket run that claims the high ticket first builds it alone: the whole-board run\'s claim is refused and it moves on, within the limit',
    scenarioFor: () => raceForTheHighTicket(0),
    holds:       (run) => buildersOnBoardOf(run, '009') === 'racing build 009'
      && racingSummaryOf(run)?.delivered.join() === '009'
      && runSummaryOf(run).delivered.join() === '001,002'
      && run.logs.some((message) => message.includes('#009 skipped for this run'))
      && run.mostAgentsOnBoardAtOnce <= 2,
    mutant: ONE_NOTE_FOR_EVERY_RUN,
  },
  {
    name:        'a whole-board run that claims the high ticket first builds it alone: the single-ticket run\'s claim is refused and it returns, within the limit',
    scenarioFor: () => raceForTheHighTicket(2),
    holds:       (run) => buildersOnBoardOf(run, '009') === 'main build 009'
      && kindsAndTicketsOf(run, 'racing') === 'build 009'
      && racingSummaryOf(run)?.delivered.length === 0
      && run.racingLogs.some((message) => message.includes('#009 skipped for this run'))
      && runSummaryOf(run).delivered.join() === '009,001,002'
      && run.mostAgentsOnBoardAtOnce <= 2,
    mutant: ONE_NOTE_FOR_EVERY_RUN,
  },
  {
    // At a session limit every agent dies on its first call: read as failed passes, two minutes of it parked eight tickets and filled every slot.
    name:        'every builder returning nothing stops the run after two in a row across two tickets, with stoppedByFailures, nothing parked and no row left running',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['001', '002', '003'], builderReply: () => null }),
    holds:       (run) => runSummaryOf(run).stoppedByFailures === true
      && runSummaryOf(run).parked.length === 0
      && !kindsAndTickets(run).includes('build 003')
      && run.rowsRunningAtEnd.length === 0,
    mutant: NEVER_STOP_ON_DEAD_AGENTS,
  },
  {
    name:        'every reviewer returning nothing stops the run the same way, and parks nothing',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['001', '002'], reviewerReply: () => null }),
    holds:       (run) => runSummaryOf(run).stoppedByFailures === true && runSummaryOf(run).parked.length === 0 && run.rowsRunningAtEnd.length === 0,
    mutant:      NEVER_STOP_ON_DEAD_AGENTS,
  },
  {
    // #001's first death was counted as a failed pass before the second death showed an outage; its fresh builder, in flight, then fails for real.
    name:        'a failed pass counted for a death that turned out to be the first of an outage is taken back, so a later real failure does not park the ticket',
    scenarioFor: () => ({ limit: 2, readyTicketIds: ['001', '002'], builderReply: (ticketId, pass) => (ticketId === '001' && pass === 2 ? { outcome: 'failed' } : null) }),
    holds:       (run) => runSummaryOf(run).stoppedByFailures === true
      && runSummaryOf(run).parked.length === 0
      && kindsAndTickets(run).filter((call) => call === 'build 001').length === 2,
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '    for (const ticketId of this.failedPassesOfConsecutiveDeaths) this.ticketRecordFor(ticketId).failedPasses--;\n',
      replace:    '',
    },
  },
  {
    // #001's second pass is the outage's first death, so it would be the second failed pass: the park waits for #002's reviewer, a death too.
    name:        'builder 001 failing and every agent after #002\'s build returning nothing parks nothing: the second pass\'s death is the first of an outage',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001', '002'],
      builderReply:   (ticketId, pass) => {
        if (ticketId !== '001') return { outcome: 'in-review' };
        return pass === 1 ? { outcome: 'failed' } : null;
      },
      reviewerReply: () => null,
    }),
    holds: (run) => runSummaryOf(run).stoppedByFailures === true
      && runSummaryOf(run).parked.length === 0
      && run.rowsRunningAtEnd.length === 0,
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '      else this.parksAwaitingTheNextAgent.push({ work: deadAgentWork, reason });\n',
      replace:    '      else this.park(ticketId, reason);\n',
    },
  },
  {
    // A lone death after a real failure is still the second failed pass: an agent returning something shows it was no outage.
    name:        'a second pass whose death is followed by an agent returning something parks the ticket then, and the held slot goes on to the next ticket',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: ['001', '002', '003'],
      builderReply:   (ticketId, pass) => {
        if (ticketId !== '001') return { outcome: 'in-review' };
        return pass === 1 ? { outcome: 'failed' } : null;
      },
    }),
    holds: (run) => runSummaryOf(run).stoppedByFailures === undefined
      && parkedIds(run).join() === '001'
      && runSummaryOf(run).delivered.join() === '002,003'
      && run.rowsRunningAtEnd.length === 0
      && run.mostAgentsInFlightAtOnce <= 2,
    mutant: { modulePath: DISPATCH_RUN, find: '      this.carryOutParksAwaitingTheNextAgent();\n      return;', replace: '      return;' },
  },
  {
    name:        'an agent that returns something resets the count, so two deaths with a success between them stop nothing',
    scenarioFor: () => ({ limit: 1, readyTicketIds: ['001', '002'], builderReply: (_ticketId, pass) => (pass === 1 ? null : { outcome: 'in-review' }) }),
    holds:       (run) => runSummaryOf(run).stoppedByFailures === undefined && runSummaryOf(run).delivered.join() === '001,002' && runSummaryOf(run).parked.length === 0,
    mutant:      {
      modulePath: DISPATCH_RUN,
      find:       '      this.consecutiveDeadAgents           = 0;\n      this.failedPassesOfConsecutiveDeaths = [];\n',
      replace:    '',
    },
  },
  {
    // A paused build resumed after an unhold is in progress, so it has no readyTickets entry for the orchestrator to copy.
    name:        'a single-ticket run with no readyTickets entry for its ticket looks up the ticket\'s stored model and effort, and runs its builder and reviewer on them',
    scenarioFor: () => ({
      limit:                      2,
      readyTicketIds:             [],
      ticketIds:                  ['001'],
      pausedBuildNotesByTicketId: { '001': 'Built by the whole-board dispatcher run on ticket-001' },
      agentSettingsByTicketId:    { '001': { model: 'sonnet', effort: 'high' } },
    }),
    holds: (run) => kindsAndTickets(run).join(', ') === 'settings 001, build 001, review 001'
      && run.calls[0]?.model === 'haiku'
      && workersRunOn(run, 'sonnet', 'high')
      && run.calls.filter((call) => call.kind === 'build').every((call) => call.prompt.includes('--owner sonnet')),
    mutant: { modulePath: WORKFLOW_INPUT_UTIL, find: '!Array.isArray(lookup[\'tickets\'])', replace: 'true' },
  },
];

const EVERY_KIND_OF_AGENT: DispatchScenario = { limit: 2, readyTicketIds: ['001', '002'], reviewerReply: () => ({ verdict: 'does-not-hold' }) };

export function modelsAndEffortsAreExplicit(run: RecordedDispatchRun): boolean {
  return run.calls.every((call) => {
    const helper = call.kind === 'survey' || call.kind === 'settings' || call.kind === 'park';
    return call.model === (helper ? 'haiku' : DEFAULT_AGENT_MODEL) && call.effort === (helper ? 'low' : DEFAULT_AGENT_EFFORT);
  });
}

/** The scenarios the plain tests run, each a factory so every run gets fresh closure state. */
export const DECISION_SCENARIOS = {
  'nothing is ready and nothing waits':                     () => ({ limit: 2, readyTicketIds: [] }),
  'every kind of agent runs':                               () => EVERY_KIND_OF_AGENT,
  'a review waits beside one ready ticket at a limit of 1': () => ({ limit: 1, readyTicketIds: ['002'], reviewWaitingTicketIds: ['001'] }),
  'a review that does not hold sends a rebuild':            () => ({
    limit:          2,
    readyTicketIds: ['001'],
    reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'does-not-hold' } : { verdict: 'released' }),
  }),
  'a builder stops short and a fresh builder carries on': () => ({
    limit:          2,
    readyTicketIds: ['001'],
    builderReply:   (_ticketId, pass) => (pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
  }),
  'a reviewer returns nothing on round 1 at a limit of 2': () => ({
    limit:          2,
    readyTicketIds: ['001'],
    reviewerReply:  (_ticketId, round) => (round === 1 ? null : { verdict: 'released' }),
  }),
  'a reviewer asks for round 2': () => ({
    limit:          2,
    readyTicketIds: ['001'],
    reviewerReply:  (_ticketId, round) => (round === 1 ? { verdict: 'round-requested', reworkedLines: 900 } : { verdict: 'released' }),
  }),
  'a reviewer returns nothing on round 1 at a limit of 1': () => ({
    limit:          1,
    readyTicketIds: ['001'],
    reviewerReply:  (_ticketId, round) => (round === 1 ? null : { verdict: 'released' }),
  }),
  'one ticket is ready at a limit of 1': () => ({ limit: 1, readyTicketIds: ['001'] }),
} as const satisfies Readonly<Record<string, () => DispatchScenario>>;

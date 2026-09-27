/**
 * The dispatcher's resumption of a build an earlier run left paused, as claims shared by the resumption suite: each a scenario, what must hold
 * after it, and the mutant that breaks exactly that decision.
 */
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL }   from '../../../src/lib/tracker-model/constants/AgentSettings.ts';
import type { DispatchSummary }                        from '../../@types/DispatchOutcome.ts';
import type { DispatchScenario }                       from '../@types/DispatchScenario.ts';
import type { RecordedAgentCall, RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';
import { DISPATCHER_MODULE_PATHS }                     from '../constants/DispatcherModulePaths.ts';
import { RecordedDispatchRunUtil }                     from '../utils/RecordedDispatchRunUtil.ts';
import type { DispatchClaim }                          from './DispatchClaim.ts';

const {
  DISPATCH_RUN,
  WORKFLOW_INPUT_UTIL,
  AGENT_PROMPT_UTIL,
  DISPATCH_WORDING_UTIL,
  DISPATCHER_CLAIM_NOTE_UTIL,
} = DISPATCHER_MODULE_PATHS;

const PAUSED_TICKET_ID = '001';

const REVIEW_WAITING_TICKET_ID = '007';

const PAUSED_BUILD_BESIDE_READY_TICKET_ID = '004';

const PAUSED_BUILD_BESIDE_READY_TICKET_CLAIM_NOTE = `Built by the whole-board dispatcher run on ticket-${PAUSED_BUILD_BESIDE_READY_TICKET_ID}`;

const WHOLE_BOARD_CLAIM_NOTE = `Built by the whole-board dispatcher run on ticket-${PAUSED_TICKET_ID}`;

function callsOf(run: RecordedDispatchRun, runName: string, kind: string, ticketId: string): RecordedAgentCall[] {
  return run.calls.filter((call) => call.run === runName && call.kind === kind && call.ticketId === ticketId);
}

function workersOnTicketRunOn(run: RecordedDispatchRun, ticketId: string, model: string, effort: string): boolean {
  const workers = run.calls.filter((call) => call.ticketId === ticketId && (call.kind === 'build' || call.kind === 'review'));
  return workers.length > 0 && workers.every((call) => call.model === model && call.effort === effort);
}

/** #001's first builder stops short and the user stops the board as it returns; after the run ends the user's go relaunches the whole board. */
function stoppedMidBuildThenRelaunched(): DispatchScenario {
  let firstBuilderHasReturned = false;
  return {
    limit:          1,
    readyTicketIds: [PAUSED_TICKET_ID, '002'],
    builderReply:   (ticketId) => {
      if (ticketId !== PAUSED_TICKET_ID || firstBuilderHasReturned) return { outcome: 'in-review' };
      firstBuilderHasReturned = true;
      return { outcome: 'failed', detail: 'stopped short' };
    },
    afterAgent: (call, board) => {
      if (call.run === 'main' && call.kind === 'build' && call.ticketId === PAUSED_TICKET_ID) board.dispatcherState = 'stopped';
    },
    relaunchedAfterTheRun: true,
  };
}

function pausedBuildBeside(note: string, heldTicketIds: string[] = []): () => DispatchScenario {
  return () => ({
    limit:                      2,
    readyTicketIds:             ['002'],
    heldTicketIds,
    pausedBuildNotesByTicketId: { [PAUSED_TICKET_ID]: note },
  });
}

function takingOverBuilderDiesOnce(ticketId: string, pass: number): null | { outcome: 'in-review' } {
  return ticketId === PAUSED_TICKET_ID && pass === 1 ? null : { outcome: 'in-review' };
}

/** The limit is 1 and the paused build is low priority beside a ready high ticket. */
function lowPausedBuildBesideHighReadyTicket(includeLowPriority: boolean): () => DispatchScenario {
  return () => ({
    limit:                      1,
    readyTicketIds:             ['002'],
    lowPriorityTicketIds:       [PAUSED_TICKET_ID],
    highPriorityTicketIds:      ['002'],
    includeLowPriority,
    pausedBuildNotesByTicketId: { [PAUSED_TICKET_ID]: WHOLE_BOARD_CLAIM_NOTE },
  });
}

const REVIEW_ROUND_REQUESTED_LINES = 800;

export const RESUMPTION_CLAIMS: readonly DispatchClaim[] = [
  {
    // The fail-review claim: an in-progress ticket is on no ready list, so without the survey's paused builds a stop strands it for good.
    name:        'a whole-board relaunch after a stop resumes the paused build with one builder in the same worktree, ahead of the new ticket, and delivers it',
    scenarioFor: stoppedMidBuildThenRelaunched,
    holds:       (run) => {
      const [firstRelaunchBuilder] = run.calls.filter((call) => call.run === 'relaunch' && call.kind === 'build');
      return (RecordedDispatchRunUtil.summaryFrom(run.relaunchSummary) as DispatchSummary).delivered.join() === `${PAUSED_TICKET_ID},002`
        && firstRelaunchBuilder?.ticketId === PAUSED_TICKET_ID
        && callsOf(run, 'relaunch', 'build', PAUSED_TICKET_ID).length === 1
        && run.buildersOnBoard.filter((builder) => builder === `relaunch build ${PAUSED_TICKET_ID}`).length === 1
        && firstRelaunchBuilder.prompt.includes('/scratch/example-repository/.claude/worktrees/ticket-001')
        && run.rowsPaused.length === 0
        && run.rowsRunningAtEnd.length === 0;
    },
    mutant: { modulePath: DISPATCH_RUN, find: '      this.resumablePausedBuildIds.push(pausedBuild.id);\n', replace: '' },
  },
  {
    name:        'the stopped run names the build it left paused in its summary',
    scenarioFor: stoppedMidBuildThenRelaunched,
    holds:       (run) => JSON.stringify(RecordedDispatchRunUtil.mainSummaryOf(run).pausedBuilds) === JSON.stringify([PAUSED_TICKET_ID])
      && (RecordedDispatchRunUtil.summaryFrom(run.relaunchSummary) as DispatchSummary).pausedBuilds === undefined,
    mutant: { modulePath: DISPATCH_RUN, find: 'pausedBuilds:            this.pausedBuildsLeft,', replace: 'pausedBuilds:            [],' },
  },
  {
    // Another run's label, a single-ticket run's here, is a claim the builder's own note does not match, so only the takeover sentence carries it on.
    name:        'a whole-board run takes over a build another dispatcher run left paused and delivers it with one builder',
    scenarioFor: pausedBuildBeside(`Built by the ticket-${PAUSED_TICKET_ID} dispatcher run on ticket-${PAUSED_TICKET_ID}`),
    holds:       (run) => RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === `${PAUSED_TICKET_ID},002`
      && callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 1
      && run.rowsPaused.length === 0,
    mutant: {
      modulePath: AGENT_PROMPT_UTIL,
      find:       'if (settings.ticketIds === null && !pausedBuildWasFoundBySurvey) return \'\';',
      replace:    'if (settings.ticketIds === null) return \'\';',
    },
  },
  {
    // A paused build is on no ready list, so the survey's entry is the only place its stated model and effort reach the run.
    name:        'a whole-board run resumes a surveyed paused build on the model and effort its ticket states, and the ready ticket beside it on the default pair',
    scenarioFor: () => ({ ...pausedBuildBeside(WHOLE_BOARD_CLAIM_NOTE)(), agentSettingsByTicketId: { [PAUSED_TICKET_ID]: { model: 'sonnet', effort: 'high' } } }),
    holds:       (run) => RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === `${PAUSED_TICKET_ID},002`
      && workersOnTicketRunOn(run, PAUSED_TICKET_ID, 'sonnet', 'high')
      && workersOnTicketRunOn(run, '002', DEFAULT_AGENT_MODEL, DEFAULT_AGENT_EFFORT)
      && callsOf(run, 'main', 'build', PAUSED_TICKET_ID).every((call) => call.prompt.includes('--owner sonnet')),
    mutant: { modulePath: DISPATCH_RUN, find: '      this.ticketRecordFor(pausedBuild.id).agentModelAndEffort = pausedBuild.agentModelAndEffort;\n', replace: '' },
  },
  {
    name:        'a held ticket\'s paused build is not taken over, stays paused and is returned as held for a build',
    scenarioFor: pausedBuildBeside(WHOLE_BOARD_CLAIM_NOTE, [PAUSED_TICKET_ID]),
    holds:       (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === '002'
      && JSON.stringify(RecordedDispatchRunUtil.mainSummaryOf(run).held) === JSON.stringify([{ id: PAUSED_TICKET_ID, waitingFor: 'build' }]),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'resumablePausedBuildIds.filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId) && !this.ticketIsHeld(ticketId));',
      replace:    'resumablePausedBuildIds.filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId));',
    },
  },
  {
    // A person paused that row for a reason of their own, and a builder taking it over would override them.
    name:        'a paused row whose note is not a dispatcher claim is left alone',
    scenarioFor: pausedBuildBeside('Paused by Alex Example for a design question'),
    holds:       (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === '002',
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '      if (!DispatcherClaimNoteUtil.noteIsADispatcherClaimOn(pausedBuild.note, pausedBuild.id)) continue;\n',
      replace:    '',
    },
  },
  {
    // A reviewer's note ends like a claim on the same ticket, so only the claim's opening tells the dispatcher's pause from a person's.
    name:        'a paused row whose note only ends like a claim is left alone',
    scenarioFor: pausedBuildBeside(`Reviewed by the whole-board dispatcher run on ticket-${PAUSED_TICKET_ID}`),
    holds:       (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === '002',
    mutant: {
      modulePath: DISPATCHER_CLAIM_NOTE_UTIL,
      find:       'return note.startsWith(opening) && note.endsWith(ending);',
      replace:    'return note.endsWith(ending);',
    },
  },
  {
    name:        'resumed builders count against the limit like any other: three paused builds and a ready ticket never run past a limit of 2',
    scenarioFor: () => ({
      limit:                      2,
      readyTicketIds:             ['004'],
      pausedBuildNotesByTicketId: Object.fromEntries(['001', '002', '003'].map((ticketId) => [ticketId, `Built by the whole-board dispatcher run on ticket-${ticketId}`])),
    }),
    holds: (run) => ['001', '002', '003', '004'].every((ticketId) => RecordedDispatchRunUtil.mainSummaryOf(run).delivered.includes(ticketId))
      && run.mostLiveAgentsAtOnce <= 2
      && run.mostAgentsInFlightAtOnce <= 2
      && run.mostAgentsOnBoardAtOnce <= 2,
    mutant: { modulePath: DISPATCH_RUN, find: 'Math.min(statedLimit, CONCURRENCY_LIMIT_CEILING_AGENTS)', replace: 'CONCURRENCY_LIMIT_CEILING_AGENTS' },
  },
  {
    // The fail-review claim: `task start` keeps the other run's note unless given one, and the rebuild's claim check then reads the running row as
    // that run's, skips the ticket and leaves the row holding a slot for good.
    name:        'a taken-over build whose builder dies once is carried on by the next builder of the run and delivered, no row left running',
    scenarioFor: () => ({
      ...pausedBuildBeside(`Built by the ticket-${PAUSED_TICKET_ID} dispatcher run on ticket-${PAUSED_TICKET_ID}`)(),
      builderReply: takingOverBuilderDiesOnce,
    }),
    holds: (run) => RecordedDispatchRunUtil.mainSummaryOf(run).delivered.includes(PAUSED_TICKET_ID)
      && callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 2
      && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: AGENT_PROMPT_UTIL, find: '<that row> --note "${claimNote}"', replace: '<that row>' },
  },
  {
    name:        'the single-ticket fast lane resuming a whole-board pause does the same when its builder dies once',
    scenarioFor: () => ({
      limit:                      1,
      readyTicketIds:             [],
      ticketIds:                  [PAUSED_TICKET_ID],
      pausedBuildNotesByTicketId: { [PAUSED_TICKET_ID]: WHOLE_BOARD_CLAIM_NOTE },
      builderReply:               takingOverBuilderDiesOnce,
    }),
    holds:  (run) => RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === PAUSED_TICKET_ID && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: AGENT_PROMPT_UTIL, find: '<that row> --note "${claimNote}"', replace: '<that row>' },
  },
  {
    name:        'at a limit of 1 a ready high ticket is built before a paused low build',
    scenarioFor: lowPausedBuildBesideHighReadyTicket(true),
    holds:       (run) => run.calls.filter((call) => call.kind === 'build').map((call) => call.ticketId).join() === `002,${PAUSED_TICKET_ID}`
      && RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === `002,${PAUSED_TICKET_ID}`,
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'this.priorityRankOf(this.pausedBuildPriorities.get(pausedBuildId)) <= this.priorityRankOf(readyTicketPriority)',
      replace:    'true',
    },
  },
  {
    // The survey lists paused builds in its own order; a high build listed second must still take the one slot first.
    name:        'a high paused build resumes before a normal one the survey listed first',
    scenarioFor: () => ({
      limit:                      1,
      readyTicketIds:             ['001'],
      highPriorityTicketIds:      ['005'],
      pausedBuildNotesByTicketId: {
        '004': 'Built by the whole-board dispatcher run on ticket-004',
        '005': 'Built by the whole-board dispatcher run on ticket-005',
      },
    }),
    holds: (run) => run.calls.filter((call) => call.kind === 'build').map((call) => call.ticketId).join() === '005,004,001'
      && RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === '005,004,001',
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '\n      .sort((a, b) => this.priorityRankOf(this.pausedBuildPriorities.get(a)) - this.priorityRankOf(this.pausedBuildPriorities.get(b)));',
      replace:    ';',
    },
  },
  {
    // A ready ticket the block states no priority for ranks as low, so a paused normal build keeps the one slot first.
    name:        'a paused normal build resumes before a ready ticket whose priority the status block does not state',
    scenarioFor: () => ({
      limit:                      1,
      readyTicketIds:             ['001'],
      includeLowPriority:         true,
      statusOmitsReadyTickets:    true,
      pausedBuildNotesByTicketId: { [PAUSED_BUILD_BESIDE_READY_TICKET_ID]: PAUSED_BUILD_BESIDE_READY_TICKET_CLAIM_NOTE },
    }),
    holds: (run) => run.calls.filter((call) => call.kind === 'build').map((call) => call.ticketId).join() === '004,001'
      && RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === '004,001',
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'return rank === -1 ? DISPATCH_POLICY.PRIORITIES_IN_ORDER.length - 1 : rank;',
      replace:    'return rank === -1 ? 0 : rank;',
    },
  },
  {
    // A low paused build and a low ready ticket both wait for triage; the summary lists the paused builds first, as the frozen trace table pins.
    name:        'a low-priority paused build is listed as lowPriorityWaiting before a low-priority ready ticket',
    scenarioFor: () => ({
      limit:                      1,
      readyTicketIds:             ['001'],
      lowPriorityTicketIds:       ['001', PAUSED_BUILD_BESIDE_READY_TICKET_ID],
      pausedBuildNotesByTicketId: { [PAUSED_BUILD_BESIDE_READY_TICKET_ID]: PAUSED_BUILD_BESIDE_READY_TICKET_CLAIM_NOTE },
    }),
    holds:  (run) => RecordedDispatchRunUtil.mainSummaryOf(run).lowPriorityWaiting?.join() === '004,001',
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '      ...this.untakenPausedBuildIds().filter((ticketId) => !this.pausedBuildIsAdmitted(ticketId)),\n'
        + '      ...this.latestStatusReading.readyTicketIds.filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId) && !this.readyTicketIsAdmitted(ticketId)),\n',
      replace: '      ...this.latestStatusReading.readyTicketIds.filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId) && !this.readyTicketIsAdmitted(ticketId)),\n'
        + '      ...this.untakenPausedBuildIds().filter((ticketId) => !this.pausedBuildIsAdmitted(ticketId)),\n',
    },
  },
  {
    // Low work waits for the orchestrator's triage whether it is new or paused; the summary is what tells it the relaunch needs includeLowPriority.
    name:        'a paused low build is not resumed without includeLowPriority, stays paused and is reported',
    scenarioFor: lowPausedBuildBesideHighReadyTicket(false),
    holds:       (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === '002'
      && JSON.stringify(RecordedDispatchRunUtil.mainSummaryOf(run).pausedBuilds) === JSON.stringify([PAUSED_TICKET_ID])
      && JSON.stringify(RecordedDispatchRunUtil.mainSummaryOf(run).lowPriorityWaiting) === JSON.stringify([PAUSED_TICKET_ID]),
    mutant: { modulePath: DISPATCH_RUN, find: '      .filter((ticketId) => this.pausedBuildIsAdmitted(ticketId))\n', replace: '' },
  },
  {
    // The hold paused the takeover's row, and the board read that lifted it also showed the stop, so the build is paused but neither held nor started.
    name:        'a build held and then unheld in the read that showed the stop is named in pausedBuilds',
    scenarioFor: () => ({
      limit:          2,
      readyTicketIds: [PAUSED_TICKET_ID, '002'],
      builderReply:   (ticketId, pass) => (ticketId === PAUSED_TICKET_ID && pass === 1 ? { outcome: 'failed', detail: 'stopped short' } : { outcome: 'in-review' }),
      afterAgent:     (call, board) => {
        if (call.kind === 'build' && call.ticketId === PAUSED_TICKET_ID) board.heldTicketIds.push(PAUSED_TICKET_ID);
        if (call.kind === 'park' && call.ticketId === PAUSED_TICKET_ID) {
          board.heldTicketIds = board.heldTicketIds.filter((heldTicketId) => heldTicketId !== PAUSED_TICKET_ID);
          board.dispatcherState = 'stopped';
        }
      },
    }),
    holds: (run) => JSON.stringify(RecordedDispatchRunUtil.mainSummaryOf(run).pausedBuilds) === JSON.stringify([PAUSED_TICKET_ID])
      && RecordedDispatchRunUtil.mainSummaryOf(run).held === undefined
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`,
    mutant: { modulePath: DISPATCH_RUN, find: '[...unheldBuildsWithPausedRows, ...this.untakenPausedBuildIds()]', replace: '[...this.untakenPausedBuildIds()]' },
  },
  {
    // One review's bar was released for the next round's reviewer the stop kept out, the other review never started: both wait for the next survey.
    name:        'a stop during a review names the reviews left waiting in reviewsLeft',
    scenarioFor: () => ({
      limit:                  1,
      readyTicketIds:         [],
      reviewWaitingTicketIds: [PAUSED_TICKET_ID, '002'],
      reviewerReply:          (ticketId) => (ticketId === PAUSED_TICKET_ID ? { verdict: 'round-requested', reworkedLines: REVIEW_ROUND_REQUESTED_LINES } : { verdict: 'released' }),
      afterAgent:             (call, board) => {
        if (call.kind === 'review' && call.ticketId === PAUSED_TICKET_ID) board.dispatcherState = 'stopped';
      },
    }),
    holds: (run) => JSON.stringify(RecordedDispatchRunUtil.mainSummaryOf(run).reviewsLeft) === JSON.stringify([PAUSED_TICKET_ID, '002'])
      && callsOf(run, 'main', 'review', '002').length === 0
      && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: DISPATCH_WORDING_UTIL, find: '  if (outcome.reviewsLeft.length > 0) summary.reviewsLeft = outcome.reviewsLeft;\n', replace: '' },
  },
  {
    // A survey reply is agent output and may name a review twice; the summary names each review left once, or the relaunch would count it twice.
    name:        'a survey that lists the same review twice leaves it named once in reviewsLeft',
    scenarioFor: () => ({
      limit:                  2,
      readyTicketIds:         [],
      reviewWaitingTicketIds: [REVIEW_WAITING_TICKET_ID, REVIEW_WAITING_TICKET_ID],
      dispatcherState:        'stopped',
    }),
    holds:  (run) => JSON.stringify(RecordedDispatchRunUtil.mainSummaryOf(run).reviewsLeft) === JSON.stringify([REVIEW_WAITING_TICKET_ID]),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'return [...new Set(reviewsLeft.map((review) => review.ticketId))];',
      replace:    'return reviewsLeft.map((review) => review.ticketId);',
    },
  },
  {
    // A worktree gone means the build's commits and edits are gone with it, and a builder "carrying on" would start from nothing under an old claim.
    name:        'a paused build whose worktree is missing is not resumed',
    scenarioFor: () => ({ ...pausedBuildBeside(WHOLE_BOARD_CLAIM_NOTE)(), pausedBuildIdsWithoutWorktree: [PAUSED_TICKET_ID] }),
    holds:       (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && RecordedDispatchRunUtil.mainSummaryOf(run).delivered.join() === '002',
    mutant: { modulePath: WORKFLOW_INPUT_UTIL, find: ' || pausedBuild[\'worktreeExists\'] !== true', replace: '' },
  },
  {
    // A restart or a resume of a first pass finds its own claim running, never a paused row, so the resumption clause only lengthens its prompt.
    name:        'a first-pass builder of a whole-board run carries no paused-row resumption, and its rebuild does',
    scenarioFor: () => ({
      limit:          1,
      readyTicketIds: [PAUSED_TICKET_ID],
      builderReply:   (ticketId, pass) => (ticketId === PAUSED_TICKET_ID && pass === 1 ? { outcome: 'failed', detail: 'stopped short' } : { outcome: 'in-review' }),
    }),
    holds: (run) => {
      const [firstPass, rebuild] = callsOf(run, 'main', 'build', PAUSED_TICKET_ID);
      return firstPass !== undefined && !firstPass.prompt.includes('task start <that row>')
        && rebuild !== undefined && rebuild.prompt.includes('task start <that row>');
    },
    mutant: { modulePath: AGENT_PROMPT_UTIL, find: '  if (previousPass === null && takeoverText === \'\') return \'\';\n', replace: '' },
  },
  {
    // #001's rebuild is held after its builder stops short, and unheld as the board stops; #004 is a low paused build this run never took.
    name:        'pausedBuilds names an unheld rebuild whose row the hold paused before a paused build the run never took',
    scenarioFor: () => ({
      limit:                      1,
      readyTicketIds:             [PAUSED_TICKET_ID],
      lowPriorityTicketIds:       [PAUSED_BUILD_BESIDE_READY_TICKET_ID],
      pausedBuildNotesByTicketId: { [PAUSED_BUILD_BESIDE_READY_TICKET_ID]: PAUSED_BUILD_BESIDE_READY_TICKET_CLAIM_NOTE },
      builderReply:               (ticketId, pass) => (ticketId === PAUSED_TICKET_ID && pass === 1 ? { outcome: 'failed' } : { outcome: 'in-review' }),
      afterAgent:                 (call, board) => {
        if (call.kind === 'build' && call.ticketId === PAUSED_TICKET_ID) board.heldTicketIds.push(PAUSED_TICKET_ID);
        if (call.kind === 'park' && call.ticketId === PAUSED_TICKET_ID) {
          board.heldTicketIds = board.heldTicketIds.filter((heldTicketId) => heldTicketId !== PAUSED_TICKET_ID);
          board.dispatcherState = 'stopped';
        }
      },
    }),
    holds:  (run) => JSON.stringify(RecordedDispatchRunUtil.mainSummaryOf(run).pausedBuilds) === JSON.stringify([PAUSED_TICKET_ID, PAUSED_BUILD_BESIDE_READY_TICKET_ID]),
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '[...unheldBuildsWithPausedRows, ...this.untakenPausedBuildIds()]',
      replace:    '[...this.untakenPausedBuildIds(), ...unheldBuildsWithPausedRows]',
    },
  },
];

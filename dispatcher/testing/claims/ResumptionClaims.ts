/**
 * The dispatcher's resumption of a build an earlier run left paused, as claims shared by the resumption suite: each a scenario, what must hold
 * after it, and the mutant that breaks exactly that decision.
 */
import type { DispatchScenario, RecordedAgentCall, RecordedDispatchRun } from '../DispatchScriptHarness';
import { DISPATCHER_MODULE_PATHS, type DispatchClaim }                   from './DispatchClaim';

const {
  DISPATCH_RUN,
  WORKFLOW_INPUT_UTIL,
  AGENT_PROMPT_UTIL,
  DISPATCH_WORDING_UTIL,
} = DISPATCHER_MODULE_PATHS;

interface ResumeSummary {
  delivered:           string[];
  held?:               { id: string; waitingFor: string }[];
  pausedBuilds?:       string[];
  reviewsLeft?:        string[];
  lowPriorityWaiting?: string[];
}

const PAUSED_TICKET_ID = '001';

const WHOLE_BOARD_CLAIM_NOTE = `Built by the whole-board dispatcher run on ticket-${PAUSED_TICKET_ID}`;

function summaryOf(summary: unknown): ResumeSummary {
  return summary as ResumeSummary;
}

function callsOf(run: RecordedDispatchRun, runName: string, kind: string, ticketId: string): RecordedAgentCall[] {
  return run.calls.filter((call) => call.run === runName && call.kind === kind && call.ticketId === ticketId);
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
      return summaryOf(run.relaunchSummary).delivered.join() === `${PAUSED_TICKET_ID},002`
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
    holds:       (run) => JSON.stringify(summaryOf(run.summary).pausedBuilds) === JSON.stringify([PAUSED_TICKET_ID])
      && summaryOf(run.relaunchSummary).pausedBuilds === undefined,
    mutant: { modulePath: DISPATCH_RUN, find: 'pausedBuilds:       this.pausedBuildsLeft,', replace: 'pausedBuilds:       [],' },
  },
  {
    // Another run's label, a single-ticket run's here, is a claim the builder's own note does not match, so only the takeover sentence carries it on.
    name:        'a whole-board run takes over a build another dispatcher run left paused and delivers it with one builder',
    scenarioFor: pausedBuildBeside(`Built by the ticket-${PAUSED_TICKET_ID} dispatcher run on ticket-${PAUSED_TICKET_ID}`),
    holds:       (run) => summaryOf(run.summary).delivered.join() === `${PAUSED_TICKET_ID},002`
      && callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 1
      && run.rowsPaused.length === 0,
    mutant: {
      modulePath: AGENT_PROMPT_UTIL,
      find:       'if (settings.ticketIds === null && !pausedBuildWasFoundBySurvey) return \'\';',
      replace:    'if (settings.ticketIds === null) return \'\';',
    },
  },
  {
    name:        'a held ticket\'s paused build is not taken over, stays paused and is returned as held for a build',
    scenarioFor: pausedBuildBeside(WHOLE_BOARD_CLAIM_NOTE, [PAUSED_TICKET_ID]),
    holds:       (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && summaryOf(run.summary).delivered.join() === '002'
      && JSON.stringify(summaryOf(run.summary).held) === JSON.stringify([{ id: PAUSED_TICKET_ID, waitingFor: 'build' }]),
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
      && summaryOf(run.summary).delivered.join() === '002',
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       '      if (!DispatcherClaimNoteUtil.noteIsADispatcherClaimOn(pausedBuild.note, pausedBuild.id)) continue;\n',
      replace:    '',
    },
  },
  {
    name:        'resumed builders count against the limit like any other: three paused builds and a ready ticket never run past a limit of 2',
    scenarioFor: () => ({
      limit:                      2,
      readyTicketIds:             ['004'],
      pausedBuildNotesByTicketId: Object.fromEntries(['001', '002', '003'].map((ticketId) => [ticketId, `Built by the whole-board dispatcher run on ticket-${ticketId}`])),
    }),
    holds: (run) => ['001', '002', '003', '004'].every((ticketId) => summaryOf(run.summary).delivered.includes(ticketId))
      && run.mostLiveAgentsAtOnce <= 2
      && run.mostAgentsInFlightAtOnce <= 2
      && run.mostAgentsOnBoardAtOnce <= 2,
    mutant: { modulePath: DISPATCH_RUN, find: 'Math.min(statedLimit, LIMITS.CONCURRENCY_LIMIT_CEILING_AGENTS)', replace: 'LIMITS.CONCURRENCY_LIMIT_CEILING_AGENTS' },
  },
  {
    // The fail-review claim: `task start` keeps the other run's note unless given one, and the rebuild's claim check then reads the running row as
    // that run's, skips the ticket and leaves the row holding a slot for good.
    name:        'a taken-over build whose builder dies once is carried on by the next builder of the run and delivered, no row left running',
    scenarioFor: () => ({
      ...pausedBuildBeside(`Built by the ticket-${PAUSED_TICKET_ID} dispatcher run on ticket-${PAUSED_TICKET_ID}`)(),
      builderReply: takingOverBuilderDiesOnce,
    }),
    holds: (run) => summaryOf(run.summary).delivered.includes(PAUSED_TICKET_ID)
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
    holds:  (run) => summaryOf(run.summary).delivered.join() === PAUSED_TICKET_ID && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: AGENT_PROMPT_UTIL, find: '<that row> --note "${claimNote}"', replace: '<that row>' },
  },
  {
    name:        'at a limit of 1 a ready high ticket is built before a paused low build',
    scenarioFor: lowPausedBuildBesideHighReadyTicket(true),
    holds:       (run) => run.calls.filter((call) => call.kind === 'build').map((call) => call.ticketId).join() === `002,${PAUSED_TICKET_ID}`
      && summaryOf(run.summary).delivered.join() === `002,${PAUSED_TICKET_ID}`,
    mutant: {
      modulePath: DISPATCH_RUN,
      find:       'this.priorityRankOf(this.pausedBuildPriorities.get(pausedBuildId)) <= this.priorityRankOf(readyTicketPriority)',
      replace:    'true',
    },
  },
  {
    // Low work waits for the orchestrator's triage whether it is new or paused; the summary is what tells it the relaunch needs includeLowPriority.
    name:        'a paused low build is not resumed without includeLowPriority, stays paused and is reported',
    scenarioFor: lowPausedBuildBesideHighReadyTicket(false),
    holds:       (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && summaryOf(run.summary).delivered.join() === '002'
      && JSON.stringify(summaryOf(run.summary).pausedBuilds) === JSON.stringify([PAUSED_TICKET_ID])
      && JSON.stringify(summaryOf(run.summary).lowPriorityWaiting) === JSON.stringify([PAUSED_TICKET_ID]),
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
    holds: (run) => JSON.stringify(summaryOf(run.summary).pausedBuilds) === JSON.stringify([PAUSED_TICKET_ID])
      && summaryOf(run.summary).held === undefined
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
    holds: (run) => JSON.stringify(summaryOf(run.summary).reviewsLeft) === JSON.stringify([PAUSED_TICKET_ID, '002'])
      && callsOf(run, 'main', 'review', '002').length === 0
      && run.rowsRunningAtEnd.length === 0,
    mutant: { modulePath: DISPATCH_WORDING_UTIL, find: '  if (outcome.reviewsLeft.length > 0) summary.reviewsLeft = outcome.reviewsLeft;\n', replace: '' },
  },
  {
    // A worktree gone means the build's commits and edits are gone with it, and a builder "carrying on" would start from nothing under an old claim.
    name:        'a paused build whose worktree is missing is not resumed',
    scenarioFor: () => ({ ...pausedBuildBeside(WHOLE_BOARD_CLAIM_NOTE)(), pausedBuildIdsWithoutWorktree: [PAUSED_TICKET_ID] }),
    holds:       (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && summaryOf(run.summary).delivered.join() === '002',
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
];

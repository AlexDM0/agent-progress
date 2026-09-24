/**
 * The dispatcher's resumption of a build an earlier run left paused, pinned like the rest of its decisions: each claim runs against the real
 * script, where it must hold, and against a mutant that breaks exactly that decision, where it must fail. The cases that matter are the ones a
 * stopped board relies on: a whole-board relaunch finds the paused build and delivers it with one builder that carries on past the old claim,
 * never a held ticket's nor a person's pause, all within the limit, and the stopped run names what it left paused.
 */
import { describe, expect, test } from 'bun:test';

import {
  readDispatchScript,
  runDispatchScript,
  type DispatchRun,
  type DispatchScenario,
  type RecordedAgentCall
} from './DispatchScriptHarness';

interface Mutant {
  find:    string;
  replace: string;
}

interface Claim {
  name:     string;
  scenario: () => DispatchScenario;
  holds:    (run: DispatchRun) => boolean;
  mutant:   Mutant;
}

interface ResumeSummary {
  delivered:     string[];
  held?:         { id: string; waitingFor: string }[];
  pausedBuilds?: string[];
}

const SCRIPT_SOURCE = readDispatchScript();

const PAUSED_TICKET_ID = '001';

const WHOLE_BOARD_CLAIM_NOTE = `Built by the whole-board dispatcher run on ticket-${PAUSED_TICKET_ID}`;

function summaryOf(summary: unknown): ResumeSummary {
  return summary as ResumeSummary;
}

function callsOf(run: DispatchRun, runName: string, kind: string, ticketId: string): RecordedAgentCall[] {
  return run.calls.filter((call) => call.run === runName && call.kind === kind && call.ticketId === ticketId);
}

function kindsAndTickets(run: DispatchRun): string[] {
  return run.calls.map((call) => `${call.run} ${call.kind}${call.ticketId === null ? '' : ` ${call.ticketId}`}`);
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

const CLAIMS: Claim[] = [
  {
    // The fail-review claim: an in-progress ticket is on no ready list, so without the survey's paused builds a stop strands it for good.
    name:     'a whole-board relaunch after a stop resumes the paused build with one builder in the same worktree, ahead of the new ticket, and delivers it',
    scenario: stoppedMidBuildThenRelaunched,
    holds:    (run) => {
      const [firstRelaunchBuilder] = run.calls.filter((call) => call.run === 'relaunch' && call.kind === 'build');
      return summaryOf(run.relaunchSummary).delivered.join() === `${PAUSED_TICKET_ID},002`
        && firstRelaunchBuilder?.ticketId === PAUSED_TICKET_ID
        && callsOf(run, 'relaunch', 'build', PAUSED_TICKET_ID).length === 1
        && run.buildersOnBoard.filter((builder) => builder === `relaunch build ${PAUSED_TICKET_ID}`).length === 1
        && firstRelaunchBuilder.prompt.includes('/scratch/example-repository/.claude/worktrees/ticket-001')
        && run.rowsPaused.length === 0
        && run.rowsRunningAtEnd.length === 0;
    },
    mutant: { find: '    resumablePausedBuildIds.push(pausedBuild.id);\n', replace: '' },
  },
  {
    name:     'the stopped run names the build it left paused in its summary',
    scenario: stoppedMidBuildThenRelaunched,
    holds:    (run) => JSON.stringify(summaryOf(run.summary).pausedBuilds) === JSON.stringify([PAUSED_TICKET_ID])
      && summaryOf(run.relaunchSummary).pausedBuilds === undefined,
    mutant: { find: '    ...(pausedBuildsLeft.length > 0 ? { pausedBuilds: pausedBuildsLeft } : {}),\n', replace: '' },
  },
  {
    // Another run's label, a single-ticket run's here, is a claim the builder's own note does not match, so only the takeover sentence carries it on.
    name:     'a whole-board run takes over a build another dispatcher run left paused and delivers it with one builder',
    scenario: pausedBuildBeside(`Built by the ticket-${PAUSED_TICKET_ID} dispatcher run on ticket-${PAUSED_TICKET_ID}`),
    holds:    (run) => summaryOf(run.summary).delivered.join() === `${PAUSED_TICKET_ID},002`
      && callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 1
      && run.rowsPaused.length === 0,
    mutant: {
      find:    'if (settings.ticketIds === null && !pausedBuildTicketIds.has(ticketId)) return \'\';',
      replace: 'if (settings.ticketIds === null) return \'\';',
    },
  },
  {
    name:     'a held ticket\'s paused build is not taken over, stays paused and is returned as held for a build',
    scenario: pausedBuildBeside(WHOLE_BOARD_CLAIM_NOTE, [PAUSED_TICKET_ID]),
    holds:    (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && summaryOf(run.summary).delivered.join() === '002'
      && JSON.stringify(summaryOf(run.summary).held) === JSON.stringify([{ id: PAUSED_TICKET_ID, waitingFor: 'build' }]),
    mutant: {
      find:    'resumablePausedBuildIds.filter((ticketId) => !ticketIdsTakenThisRun.has(ticketId) && !ticketIsHeld(ticketId));',
      replace: 'resumablePausedBuildIds.filter((ticketId) => !ticketIdsTakenThisRun.has(ticketId));',
    },
  },
  {
    // A person paused that row for a reason of their own, and a builder taking it over would override them.
    name:     'a paused row whose note is not a dispatcher claim is left alone',
    scenario: pausedBuildBeside('Paused by Alex Example for a design question'),
    holds:    (run) => callsOf(run, 'main', 'build', PAUSED_TICKET_ID).length === 0
      && run.rowsPaused.join() === `build ${PAUSED_TICKET_ID}`
      && summaryOf(run.summary).delivered.join() === '002',
    mutant: { find: '    if (!noteIsADispatcherClaimOn(pausedBuild.note, pausedBuild.id)) continue;\n', replace: '' },
  },
  {
    name:     'resumed builders count against the limit like any other: three paused builds and a ready ticket never run past a limit of 2',
    scenario: () => ({
      limit:                      2,
      readyTicketIds:             ['004'],
      pausedBuildNotesByTicketId: Object.fromEntries(['001', '002', '003'].map((ticketId) => [ticketId, `Built by the whole-board dispatcher run on ticket-${ticketId}`])),
    }),
    holds: (run) => ['001', '002', '003', '004'].every((ticketId) => summaryOf(run.summary).delivered.includes(ticketId))
      && run.mostLiveAgentsAtOnce <= 2
      && run.mostAgentsInFlightAtOnce <= 2
      && run.mostAgentsOnBoardAtOnce <= 2,
    mutant: { find: 'Math.min(board.limit, CONCURRENCY_CEILING_AGENTS)', replace: 'CONCURRENCY_CEILING_AGENTS' },
  },
];

function mutated(mutant: Mutant): string {
  return SCRIPT_SOURCE.replace(mutant.find, mutant.replace);
}

describe('the dispatcher script and a build an earlier run left paused', () => {
  for (const claim of CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenario());
      expect(run.ranAway).toBe(false);
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, relaunch: run.relaunchSummary })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      expect(SCRIPT_SOURCE.split(claim.mutant.find).length - 1, `the mutant's text is in the script exactly once: ${claim.mutant.find}`).toBe(1);
      const run = await runDispatchScript(claim.scenario(), mutated(claim.mutant));
      expect(claim.holds(run)).toBe(false);
    });
  }
});

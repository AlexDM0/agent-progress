/** The group run's decisions, each with the scenario that shows it and the mutant of the module holding it that must break it. */
import type { DispatchScenario, GroupScenario }                 from '../@types/DispatchScenario.ts';
import type { AgentKind, DispatchRunName, RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';
import { AGENT_PROMPT_SENTENCES }                               from '../constants/AgentPromptSentences.ts';
import { DISPATCHER_MODULE_PATHS }                              from '../constants/DispatcherModulePaths.ts';
import type { DispatchClaim }                                   from './DispatchClaim.ts';

const EXAMPLE_GROUP: GroupScenario = { name: 'example-group', ticketIds: ['101', '102', '103'] };

const GROUP_LIMIT = 4;

const RELEASE_TICKET_ID = '103';

function groupScenarioWith(overrides: Partial<DispatchScenario>): DispatchScenario {
  return {
    limit:          GROUP_LIMIT,
    readyTicketIds: [],
    group:          EXAMPLE_GROUP,
    ...overrides,
  };
}

function summaryField(summary: unknown, field: string): unknown {
  return typeof summary === 'object' && summary !== null ? (summary as Record<string, unknown>)[field] : undefined;
}

function eventIndexOf(run: RecordedDispatchRun, event: string): number {
  return run.agentEvents.indexOf(event);
}

function mostInFlightOf(run: RecordedDispatchRun, runName: DispatchRunName, kind: AgentKind): number {
  let inFlight = 0;
  let most = 0;
  for (const event of run.agentEvents) {
    if (event.startsWith(`${runName} start ${kind} `)) most = Math.max(most, ++inFlight);
    if (event.startsWith(`${runName} end ${kind} `)) inFlight--;
  }
  return most;
}

// Fails review if false in any scenario: the main line never moves and no group reviewer is told to release.
function mainLineStaysPut(run: RecordedDispatchRun): boolean {
  return run.mainLineMoves.length === 0
    && run.calls.every((call) => call.kind !== 'review' || !call.prompt.includes(AGENT_PROMPT_SENTENCES.RELEASE_COMMAND));
}

function oneBuilderAndOneReviewerAtOnce(run: RecordedDispatchRun): boolean {
  return (['main', 'relaunch'] as const).every((runName) => mostInFlightOf(run, runName, 'build') <= 1 && mostInFlightOf(run, runName, 'review') <= 1);
}

// Each ticket's builder starts only once the one before it has an `in-review` return in the same run, or was built by an earlier one.
function eachBuildFollowsItsPredecessorsBuild(run: RecordedDispatchRun, runName: DispatchRunName): boolean {
  return EXAMPLE_GROUP.ticketIds.slice(1).every((ticketId, position) => {
    const startIndex = eventIndexOf(run, `${runName} start build ${ticketId}`);
    const predecessorBuiltIndex = eventIndexOf(run, `${runName} end build ${EXAMPLE_GROUP.ticketIds[position] ?? ''} in-review`);
    return startIndex === -1 || (predecessorBuiltIndex !== -1 && predecessorBuiltIndex < startIndex);
  });
}

// Each ticket's first reviewer starts only after the one before it returned `integrated`.
function eachReviewFollowsItsPredecessorsIntegration(run: RecordedDispatchRun, runName: DispatchRunName): boolean {
  return EXAMPLE_GROUP.ticketIds.slice(1).every((ticketId, position) => {
    const startIndex = eventIndexOf(run, `${runName} start review ${ticketId}`);
    const predecessorIntegratedIndex = eventIndexOf(run, `${runName} end review ${EXAMPLE_GROUP.ticketIds[position] ?? ''} integrated`);
    return startIndex === -1 || (predecessorIntegratedIndex !== -1 && predecessorIntegratedIndex < startIndex);
  });
}

function bundleIsIntegratedUpToTheRelease(run: RecordedDispatchRun, summary: unknown): boolean {
  return run.groupBranchMoves.join(',') === '101,102' && summaryField(summary, 'releaseReviewNext') === RELEASE_TICKET_ID;
}

function stoppedAfterTheFirstBuild(): DispatchScenario {
  return groupScenarioWith({
    relaunchedAfterTheRun: true,
    afterAgent:            (call, board) => {
      if (call.run === 'main' && call.kind === 'build' && call.ticketId === '101') board.dispatcherState = 'stopped';
    },
  });
}

export const GROUP_CLAIMS: readonly DispatchClaim[] = [
  {
    name:        'a group run integrates its bundle in order and stops at the release ticket\'s review, never moving the main line',
    scenarioFor: () => groupScenarioWith({}),
    holds:       (run) => mainLineStaysPut(run)
      && bundleIsIntegratedUpToTheRelease(run, run.summary)
      && run.calls.every((call) => !(call.kind === 'review' && call.ticketId === RELEASE_TICKET_ID))
      && eachBuildFollowsItsPredecessorsBuild(run, 'main')
      && eachReviewFollowsItsPredecessorsIntegration(run, 'main'),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_AGENT_PROMPT_UTIL,
      find:       '`You integrate this ticket onto ',
      replace:    '`Then run agent-progress release for the group. You integrate this ticket onto ',
    },
  },
  {
    name:        'a group run never sets the board\'s dispatcher state or run id',
    scenarioFor: () => groupScenarioWith({}),
    holds:       (run) => run.calls.length > 0 && run.calls.every((call) => !/agent-progress dispatcher (running|finished|stopped)|--run /.test(call.prompt)),
    mutant:      {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_AGENT_PROMPT_UTIL,
      find:       'Make no other call. Judge nothing; return:',
      replace:    'Then run `agent-progress dispatcher running`. Judge nothing; return:',
    },
  },
  {
    name:        'with a failed review of N while N+1 is built, the group run holds one builder and one reviewer at a time',
    scenarioFor: () => groupScenarioWith({
      slowAgentNames: ['build 102'],
      reviewerReply:  (ticketId, round) => ({ verdict: ticketId === '101' && round === 1 ? 'does-not-hold' : 'integrated' }),
    }),
    holds:  (run) => mainLineStaysPut(run) && oneBuilderAndOneReviewerAtOnce(run) && bundleIsIntegratedUpToTheRelease(run, run.summary),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'if (this.agentsInFlightOf(\'build\') >= DISPATCH_POLICY.GROUP_BUILDERS_AT_ONCE) return null;',
      replace:    '',
    },
  },
  {
    name:        'with a failed review of N, N+1 is reviewed only once N is rebuilt and integrated',
    scenarioFor: () => groupScenarioWith({
      slowAgentNames: ['build 102'],
      reviewerReply:  (ticketId, round) => ({ verdict: ticketId === '101' && round === 1 ? 'does-not-hold' : 'integrated' }),
    }),
    holds:  (run) => mainLineStaysPut(run) && eachReviewFollowsItsPredecessorsIntegration(run, 'main') && bundleIsIntegratedUpToTheRelease(run, run.summary),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'if (ticketId === undefined || !this.predecessorIsIntegrated(ticketId)) return null;',
      replace:    'if (ticketId === undefined) return null;',
    },
  },
  {
    name:        'N+1 is built only after N\'s builder returned in-review: a parked N leaves every later ticket unbuilt',
    scenarioFor: () => groupScenarioWith({ builderReply: (ticketId) => (ticketId === '101' ? { outcome: 'failed', detail: 'example failure' } : { outcome: 'in-review' }) }),
    holds:       (run) => mainLineStaysPut(run)
      && eachBuildFollowsItsPredecessorsBuild(run, 'main')
      && run.calls.every((call) => call.kind !== 'build' || call.ticketId === '101')
      && JSON.stringify(summaryField(run.summary, 'parked')).includes('"101"'),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'if (ticketId === undefined || !this.predecessorIsBuilt(ticketId)) return null;',
      replace:    'if (ticketId === undefined) return null;',
    },
  },
  {
    name:        'a board stop mid-group ends the group run: nothing starts after it, and the built ticket\'s bar is released',
    scenarioFor: stoppedAfterTheFirstBuild,
    holds:       (run) => mainLineStaysPut(run)
      && summaryField(run.summary, 'stoppedByBoard') === true
      && run.calls.filter((call) => call.run === 'main').every((call) => call.kind !== 'review' && (call.kind !== 'build' || call.ticketId === '101'))
      && !run.rowsRunningAtEnd.includes('review 101'),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       '    if (this.runWasStoppedByBoard) return;\n',
      replace:    '',
    },
  },
  {
    name:        'a relaunch mid-group recovers from the board alone: the built ticket is reviewed, not rebuilt, and the bundle carries on',
    scenarioFor: stoppedAfterTheFirstBuild,
    holds:       (run) => mainLineStaysPut(run)
      && eventIndexOf(run, 'relaunch start build 101') === -1
      && eventIndexOf(run, 'relaunch start review 101') !== -1
      && bundleIsIntegratedUpToTheRelease(run, run.relaunchSummary)
      && eachReviewFollowsItsPredecessorsIntegration(run, 'relaunch'),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'else if (ticket.status === \'in-review\') stage = \'built\';',
      replace:    'else if (ticket.status === \'in-review\') stage = \'to-build\';',
    },
  },
  {
    name:        'a single-ticket run naming a ticket of a group\'s bundle is refused, building nothing',
    scenarioFor: () => groupScenarioWith({ ticketIds: ['101'] }),
    holds:       (run) => run.calls.every((call) => call.kind !== 'build') && run.logs.some((line) => line.includes('#101 belongs to the group example-group')),
    mutant:      {
      modulePath: DISPATCHER_MODULE_PATHS.DISPATCH_RUN,
      find:       'if (entry.groupName === null || !ticketIds.includes(entry.id)) continue;',
      replace:    'continue;',
    },
  },
];

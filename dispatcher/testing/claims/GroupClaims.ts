/** The group run's decisions, each with the scenario that shows it and the mutant of the module holding it that must break it. */
import type { DispatchScenario, GroupScenario }                 from '../@types/DispatchScenario.ts';
import type { AgentKind, DispatchRunName, RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';
import { AGENT_PROMPT_SENTENCES }                               from '../constants/AgentPromptSentences.ts';
import { DISPATCHER_MODULE_PATHS }                              from '../constants/DispatcherModulePaths.ts';
import type { DispatchClaim }                                   from './DispatchClaim.ts';

const EXAMPLE_GROUP: GroupScenario = { name: 'example-group', ticketIds: ['101', '102', '103'] };

const TICKET_OUTSIDE_THE_BUNDLE_ID = '104';

const GROUP_WITH_A_TICKET_OUTSIDE_THE_BUNDLE: GroupScenario = { ...EXAMPLE_GROUP, ticketIdsOutsideTheBundle: [TICKET_OUTSIDE_THE_BUNDLE_ID] };

const GROUP_LIMIT = 4;

const RELEASE_TICKET_ID = '103';

const TICKETS_BEFORE_THE_RELEASE = ['101', '102'];

const WHOLE_BOARD_TICKET_IDS = ['201', '202'];

const TWO_RUN_LIMIT = 8;

const GROUP_TICKET_ID_PATTERN = /\b10[123]\b/;

const WHOLE_BOARD_TICKET_ID_PATTERN = /\b20[12]\b/;

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

function eventCountOf(run: RecordedDispatchRun, event: string): number {
  return run.agentEvents.filter((recordedEvent) => recordedEvent === event).length;
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

function groupMainLineMovesOf(run: RecordedDispatchRun): string[] {
  return run.mainLineMoves.filter((move) => EXAMPLE_GROUP.ticketIds.some((ticketId) => move === `review ${ticketId}`));
}

// Fails review if false in any scenario: the main line moves at most once, at the release reviewer's `released` after every other ticket of the
// bundle was integrated, and no other group reviewer is told to release.
function mainLineMovesOnlyAtTheRelease(run: RecordedDispatchRun): boolean {
  const onlyTheReleaseReviewerIsToldToRelease = run.calls.every((call) => call.kind !== 'review'
    || call.ticketId === RELEASE_TICKET_ID
    || !call.prompt.includes(AGENT_PROMPT_SENTENCES.RELEASE_COMMAND));
  const moves = groupMainLineMovesOf(run);
  if (!onlyTheReleaseReviewerIsToldToRelease || moves.length > 1) return false;
  if (moves.length === 0) return true;
  const releaseIndex = run.agentEvents.findIndex((event) => event.endsWith(`end review ${RELEASE_TICKET_ID} released`));
  return moves[0] === `review ${RELEASE_TICKET_ID}` && releaseIndex !== -1 && TICKETS_BEFORE_THE_RELEASE.every((ticketId) => {
    const integratedIndex = run.agentEvents.findIndex((event) => event.endsWith(`end review ${ticketId} integrated`));
    return integratedIndex !== -1 && integratedIndex < releaseIndex;
  });
}

function bundleIsReleasedOnce(run: RecordedDispatchRun, summary: unknown): boolean {
  return mainLineMovesOnlyAtTheRelease(run)
    && groupMainLineMovesOf(run).length === 1
    && run.groupBranchMoves.join(',') === TICKETS_BEFORE_THE_RELEASE.join(',')
    && JSON.stringify(summaryField(summary, 'delivered')) === JSON.stringify(EXAMPLE_GROUP.ticketIds);
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

function stoppedAfterTheFirstBuild(): DispatchScenario {
  return groupScenarioWith({
    relaunchedAfterTheRun: true,
    afterAgent:            (call, board) => {
      if (call.run === 'main' && call.kind === 'build' && call.ticketId === '101') board.dispatcherState = 'stopped';
    },
  });
}

function releaseTicketMeetsAMovedMainLine(movedReleases: number): DispatchScenario {
  return groupScenarioWith({
    reviewerReply: (ticketId, round) => {
      if (ticketId !== RELEASE_TICKET_ID) return { verdict: 'integrated' };
      return round <= movedReleases ? { verdict: 'not-released', releaseReason: 'main-moved' } : { verdict: 'released' };
    },
  });
}

function callsNaming(run: RecordedDispatchRun, runName: DispatchRunName, ticketIdPattern: RegExp): number {
  return run.calls.filter((call) => call.run === runName && ticketIdPattern.test(call.prompt)).length;
}

function ticketOutsideTheBundleIsBuiltAndReleased(run: RecordedDispatchRun): boolean {
  return run.calls.some((call) => call.run === 'main' && call.kind === 'build' && call.ticketId === TICKET_OUTSIDE_THE_BUNDLE_ID)
    && run.mainLineMoves.includes(`review ${TICKET_OUTSIDE_THE_BUNDLE_ID}`);
}

// Fails review if false: counted over every agent call, neither run names a ticket or row of the other, and each scan found its own run's tickets.
function neitherRunNamesTheOthersTickets(run: RecordedDispatchRun): boolean {
  return callsNaming(run, 'main', WHOLE_BOARD_TICKET_ID_PATTERN) > 0
    && callsNaming(run, 'racing', GROUP_TICKET_ID_PATTERN) > 0
    && callsNaming(run, 'main', GROUP_TICKET_ID_PATTERN) === 0
    && callsNaming(run, 'racing', WHOLE_BOARD_TICKET_ID_PATTERN) === 0;
}

export const GROUP_CLAIMS: readonly DispatchClaim[] = [
  {
    name:        'a group run integrates its bundle in order, and only the release ticket\'s reviewer moves the main line, once, at the end',
    scenarioFor: () => groupScenarioWith({}),
    holds:       (run) => bundleIsReleasedOnce(run, run.summary)
      && eachBuildFollowsItsPredecessorsBuild(run, 'main')
      && eachReviewFollowsItsPredecessorsIntegration(run, 'main'),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_AGENT_PROMPT_UTIL,
      find:       '`You integrate this ticket onto ',
      replace:    '`Then run agent-progress release for the group. You integrate this ticket onto ',
    },
  },
  {
    name:        'the release ticket, last in the pipe, is reviewed after every other ticket is integrated, and its reviewer releases the whole bundle',
    scenarioFor: () => groupScenarioWith({}),
    holds:       (run) => bundleIsReleasedOnce(run, run.summary)
      && eventIndexOf(run, `main start review ${RELEASE_TICKET_ID}`) > eventIndexOf(run, 'main end review 102 integrated')
      && run.logs.some((line) => line.includes(`#${RELEASE_TICKET_ID}'s reviewer released group-example-group`)),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_AGENT_PROMPT_UTIL,
      find:       '  if (reviewsTheRelease(placement, request.ticketId)) return releaseReviewerPrompt(settings, placement, request);\n',
      replace:    '',
    },
  },
  {
    name:        '`main-moved` at the release takes one more round on the bar left running, and the second pass releases the bundle',
    scenarioFor: () => releaseTicketMeetsAMovedMainLine(1),
    holds:       (run) => bundleIsReleasedOnce(run, run.summary)
      && eventCountOf(run, `main start review ${RELEASE_TICKET_ID}`) === 2
      && run.rereviewsRun.includes(`rereview ${RELEASE_TICKET_ID} round 2`)
      && run.reviewBarsAdded.filter((bar) => bar === `review ${RELEASE_TICKET_ID}`).length === 1,
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'reading.releaseRefusal === \'main-moved\' && ticketId === this.releaseTicketId) {',
      replace:    'reading.releaseRefusal === \'main-moved\' && ticketId === \'\') {',
    },
  },
  {
    name:        'a second `main-moved` at the release parks the release ticket, closing its bar, and the main line never moves',
    scenarioFor: () => releaseTicketMeetsAMovedMainLine(Number.POSITIVE_INFINITY),
    holds:       (run) => mainLineMovesOnlyAtTheRelease(run)
      && groupMainLineMovesOf(run).length === 0
      && eventCountOf(run, `main start review ${RELEASE_TICKET_ID}`) === 2
      && JSON.stringify(summaryField(run.summary, 'parked')).includes('the main line moved under 2 releases')
      && !run.rowsRunningAtEnd.includes(`review ${RELEASE_TICKET_ID}`),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'if (record.mainMovedReleases >= DISPATCH_POLICY.MAIN_MOVED_RELEASES_BEFORE_PARKING) {',
      replace:    'if (record.mainMovedReleases < 0) {',
    },
  },
  {
    name:        'a release reported by a bundle ticket\'s reviewer is a breach: it parks that ticket, delivers nothing and starts no further review',
    scenarioFor: () => groupScenarioWith({ reviewerReply: (ticketId) => ({ verdict: ticketId === '101' ? 'released' : 'integrated' }) }),
    holds:       (run) => JSON.stringify(summaryField(run.summary, 'delivered')) === '[]'
      && JSON.stringify(summaryField(run.summary, 'parked')).includes('only the reviewer of #103 does')
      && run.agentEvents.slice(eventIndexOf(run, 'main end review 101 released')).every((event) => !event.startsWith('main start review')),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       '    if (ticketId !== this.releaseTicketId) {\n      this.releasedOutOfTurn = true;',
      replace:    '    if (ticketId === \'\') {\n      this.releasedOutOfTurn = true;',
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
      reviewerReply:  (ticketId, round) => {
        if (ticketId === RELEASE_TICKET_ID) return { verdict: 'released' };
        return { verdict: ticketId === '101' && round === 1 ? 'does-not-hold' : 'integrated' };
      },
    }),
    holds:  (run) => oneBuilderAndOneReviewerAtOnce(run) && bundleIsReleasedOnce(run, run.summary),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'if (this.agentsInFlightOf(\'build\') >= DISPATCH_POLICY.GROUP_BUILDERS_AT_ONCE) return null;',
      replace:    '',
    },
  },
  {
    name:        'with a failed review of N, N+1 is reviewed only once N is rebuilt and integrated, and the release only after both',
    scenarioFor: () => groupScenarioWith({
      slowAgentNames: ['build 102'],
      reviewerReply:  (ticketId, round) => {
        if (ticketId === RELEASE_TICKET_ID) return { verdict: 'released' };
        return { verdict: ticketId === '101' && round === 1 ? 'does-not-hold' : 'integrated' };
      },
    }),
    holds:  (run) => eachReviewFollowsItsPredecessorsIntegration(run, 'main') && bundleIsReleasedOnce(run, run.summary),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'if (ticketId === undefined || !this.predecessorIsIntegrated(ticketId)) return null;',
      replace:    'if (ticketId === undefined) return null;',
    },
  },
  {
    name:        'N+1 is built only after N\'s builder returned in-review: a parked N leaves every later ticket unbuilt and the main line put',
    scenarioFor: () => groupScenarioWith({ builderReply: (ticketId) => (ticketId === '101' ? { outcome: 'failed', detail: 'example failure' } : { outcome: 'in-review' }) }),
    holds:       (run) => mainLineMovesOnlyAtTheRelease(run)
      && groupMainLineMovesOf(run).length === 0
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
    holds:       (run) => mainLineMovesOnlyAtTheRelease(run)
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
    name:        'a relaunch mid-group recovers from the board alone: the built ticket is reviewed, not rebuilt, and the bundle carries on to its release',
    scenarioFor: stoppedAfterTheFirstBuild,
    holds:       (run) => eventIndexOf(run, 'relaunch start build 101') === -1
      && eventIndexOf(run, 'relaunch start review 101') !== -1
      && bundleIsReleasedOnce(run, run.relaunchSummary)
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
  {
    name:        'a single-ticket run naming a grouped ticket outside the release bundle builds it and releases it like any other',
    scenarioFor: () => groupScenarioWith({ ticketIds: [TICKET_OUTSIDE_THE_BUNDLE_ID], group: GROUP_WITH_A_TICKET_OUTSIDE_THE_BUNDLE }),
    holds:       (run) => ticketOutsideTheBundleIsBuiltAndReleased(run) && !run.logs.some((line) => line.includes('belongs to the group')),
    mutant:      {
      modulePath: DISPATCHER_MODULE_PATHS.DISPATCH_RUN,
      find:       'if (!ticketIsInItsGroupsReleaseBundle(entry.id, entry.groupName, lookup.groupTickets)) continue;',
      replace:    '',
    },
  },
  {
    name:        'a whole-board run takes a grouped ticket outside the release bundle from the ready list, and no ticket of the bundle',
    scenarioFor: () => groupScenarioWith({
      readyTicketIds:    [TICKET_OUTSIDE_THE_BUNDLE_ID],
      group:             GROUP_WITH_A_TICKET_OUTSIDE_THE_BUNDLE,
      argumentOverrides: { group: undefined },
    }),
    holds:  (run) => ticketOutsideTheBundleIsBuiltAndReleased(run) && callsNaming(run, 'main', GROUP_TICKET_ID_PATTERN) === 0,
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.DISPATCH_RUN,
      find:       'return readyTicketIds.filter((ticketId) => !this.ticketIsHeld(ticketId)',
      replace:    'return readyTicketIds.filter((ticketId) => readyTicketEntryOf(this.latestStatusReading?.readyTickets ?? [], ticketId)?.groupName === null '
        + '&& !this.ticketIsHeld(ticketId)',
    },
  },
  {
    name:        'a whole-board run and a group run on one board each keep to their own tickets and rows, and each delivers its own',
    scenarioFor: () => groupScenarioWith({
      limit:          TWO_RUN_LIMIT,
      readyTicketIds: WHOLE_BOARD_TICKET_IDS,
      groupRunRaces:  true,
      group:          { ...EXAMPLE_GROUP, firstTicketDependsOn: ['201'] },
    }),
    holds: (run) => neitherRunNamesTheOthersTickets(run)
      && bundleIsReleasedOnce(run, run.racingSummary)
      && JSON.stringify(summaryField(run.summary, 'delivered')) === JSON.stringify(WHOLE_BOARD_TICKET_IDS),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_AGENT_PROMPT_UTIL,
      find:       'list whose \\`group\\` is \\`${groupName}\\`, each with',
      replace:    'list, each with',
    },
  },
];

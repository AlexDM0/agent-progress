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

const SHARED_LIMIT = 3;

const STRAIGHT_CHAIN_EVENTS_WITH_A_SLOW_FIRST_REVIEW = [
  'main start build 101',
  'main end build 101 in-review',
  'main start review 101',
  'main start build 102',
  'main end build 102 in-review',
  'main start build 103',
  'main end build 103 in-review',
  'main end review 101 integrated',
  'main start review 102',
  'main end review 102 integrated',
  'main start review 103',
  'main end review 103 released',
];

const TURNS_UNTIL_THE_WHOLE_BOARD_BUILDERS_CLAIM = 4;

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

// 101 and 102 depend on nothing, and the release ticket 103 on both.
const GROUP_OF_TWO_INDEPENDENT_TICKETS: GroupScenario = { ...EXAMPLE_GROUP, dependsOnByTicketId: { '102': [], [RELEASE_TICKET_ID]: TICKETS_BEFORE_THE_RELEASE } };

const ONE_BUILD_AT_A_TIME = {
  find:    'this.recordOf(ticketId).stage === \'to-build\' && this.buildStartOf(ticketId).startable',
  replace: 'this.recordOf(ticketId).stage === \'to-build\' && this.buildStartOf(ticketId).startable && ![...this.records.values()].some((record) => record.stage === \'building\')',
};

const REVIEWABLE_TICKET_TEST = 'stage === \'built\' && this.unintegratedDependencyIdsOf(ticketId).length === 0)';

function firstIntegrationIndexOf(run: RecordedDispatchRun, ticketIds: readonly string[]): number {
  return Math.min(...ticketIds.map((ticketId) => eventIndexOf(run, `main end review ${ticketId} integrated`)).filter((index) => index !== -1));
}

// Both independent tickets built before the release ticket starts, which waits for one of them to be integrated, is never refused its claim, and
// the one release delivers all three.
function releaseTicketWaitsForAllButOneDependencyIntegrated(run: RecordedDispatchRun): boolean {
  const releaseBuildIndex = eventIndexOf(run, `main start build ${RELEASE_TICKET_ID}`);
  return releaseBuildIndex !== -1
    && releaseBuildIndex > firstIntegrationIndexOf(run, TICKETS_BEFORE_THE_RELEASE)
    && run.agentEvents.every((event) => !event.endsWith('claim-refused'))
    && [...run.groupBranchMoves].sort().join(',') === TICKETS_BEFORE_THE_RELEASE.join(',')
    && mainLineMovesOnlyAtTheRelease(run)
    && JSON.stringify(summaryField(run.summary, 'delivered')) === JSON.stringify(EXAMPLE_GROUP.ticketIds);
}

function buildPromptOf(run: RecordedDispatchRun, ticketId: string): string {
  return run.calls.find((call) => call.kind === 'build' && call.ticketId === ticketId)?.prompt ?? '';
}

const GROUP_BRANCH_MERGE_COMMAND = 'merge --no-edit group-example-group`, never a rebase';

// The diamond: 102's review outlasts 101's, so 101 integrates after 102's build forked, and the release ticket 103 is pipelined behind 102 alone.
function pipelinedBuilderMergesTheGroupBranch(run: RecordedDispatchRun): boolean {
  const releaseBuildPrompt = buildPromptOf(run, RELEASE_TICKET_ID);
  return eventIndexOf(run, 'main start build 102') !== -1
    && eventIndexOf(run, 'main start build 102') < eventIndexOf(run, 'main end review 101 integrated')
    && eventIndexOf(run, 'main end review 101 integrated') < eventIndexOf(run, `main start build ${RELEASE_TICKET_ID}`)
    && eventIndexOf(run, `main start build ${RELEASE_TICKET_ID}`) < eventIndexOf(run, 'main end review 102 integrated')
    && releaseBuildPrompt.includes('--after 102`')
    && releaseBuildPrompt.includes(GROUP_BRANCH_MERGE_COMMAND)
    && TICKETS_BEFORE_THE_RELEASE.every((ticketId) => !buildPromptOf(run, ticketId).includes(GROUP_BRANCH_MERGE_COMMAND))
    && releaseTicketWaitsForAllButOneDependencyIntegrated(run);
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

const VERSION_BUMP_IS_DROPPED_BEFORE_THE_NEXT_RELEASE = 'When R3 made a commit, drop it the way the root `CLAUDE.md` says.';

function releaseReviewPromptsOf(run: RecordedDispatchRun): string[] {
  return run.calls.filter((call) => call.kind === 'review' && call.ticketId === RELEASE_TICKET_ID).map((call) => call.prompt);
}

// The release review is this run's own: its one reviewer is told to release every ticket of the bundle from the group branch in one call.
function releaseReviewReleasesTheWholeBundle(run: RecordedDispatchRun): boolean {
  const bundleReleaseCommand = `agent-progress release ${EXAMPLE_GROUP.ticketIds.join(' ')} --branch group-${EXAMPLE_GROUP.name}`;
  const prompts = releaseReviewPromptsOf(run);
  return prompts.length === 1 && prompts.every((prompt) => prompt.includes(bundleReleaseCommand));
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
    name:        'a group survey over a group whose tickets are all pending reads the whole bundle and starts its first ticket',
    scenarioFor: () => groupScenarioWith({}),
    holds:       (run) => run.calls.find((call) => call.kind === 'build')?.ticketId === EXAMPLE_GROUP.ticketIds[0]
      && summaryField(run.summary, 'bundleUnread') === undefined,
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.WORKFLOW_INPUT_UTIL,
      find:       'if (entry[\'group\'] !== groupName) continue;',
      replace:    'if (entry[\'group\'] !== groupName || !WORKTREE_HOLDING_STATUSES.includes(textOrEmpty(entry[\'status\']))) continue;',
    },
  },
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
    name:        'once every other ticket is integrated the run starts the release review itself, whose one release delivers every ticket of the bundle',
    scenarioFor: () => groupScenarioWith({}),
    holds:       (run) => bundleIsReleasedOnce(run, run.summary)
      && releaseReviewReleasesTheWholeBundle(run)
      && !run.rowsRunningAtEnd.includes(`review ${RELEASE_TICKET_ID}`),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       REVIEWABLE_TICKET_TEST,
      replace:    REVIEWABLE_TICKET_TEST.replace(/\)$/, ' && ticketId !== this.releaseTicketId)'),
    },
  },
  {
    name:        '`main-moved` at the release has its reviewer drop the version bump before rebasing again, so the one release carries one version',
    scenarioFor: () => releaseTicketMeetsAMovedMainLine(1),
    holds:       (run) => bundleIsReleasedOnce(run, run.summary)
      && releaseReviewPromptsOf(run).length === 2
      && releaseReviewPromptsOf(run).every((prompt) => prompt.includes(VERSION_BUMP_IS_DROPPED_BEFORE_THE_NEXT_RELEASE)),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_AGENT_PROMPT_UTIL,
      find:       'When R3 made a commit, drop it the way the root \\`CLAUDE.md\\` says. ',
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
      find:       'and make no other call. Judge nothing and leave out no entry; return:',
      replace:    'then `agent-progress dispatcher running`. Judge nothing and leave out no entry; return:',
    },
  },
  {
    name:        'with a failed review of N while N+1 builds, N\'s rebuild starts beside that build, and no ticket builds before its dependency is built',
    scenarioFor: () => groupScenarioWith({
      slowAgentNames: ['build 102'],
      reviewerReply:  (ticketId, round) => {
        if (ticketId === RELEASE_TICKET_ID) return { verdict: 'released' };
        return { verdict: ticketId === '101' && round === 1 ? 'does-not-hold' : 'integrated' };
      },
    }),
    holds: (run) => mostInFlightOf(run, 'main', 'build') === 2
      && eventCountOf(run, 'main start build 101') === 2
      && eachBuildFollowsItsPredecessorsBuild(run, 'main')
      && bundleIsReleasedOnce(run, run.summary),
    mutant: { modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN, ...ONE_BUILD_AT_A_TIME },
  },
  {
    // N's rebuild runs beside N+1's build and outlasts it, so N+1 is built while N is not integrated yet.
    name:        'with a failed review of N, N+1 is reviewed only once N is rebuilt and integrated, and the release only after both',
    scenarioFor: () => groupScenarioWith({
      slowAgentNames: ['build 101', 'build 102'],
      reviewerReply:  (ticketId, round) => {
        if (ticketId === RELEASE_TICKET_ID) return { verdict: 'released' };
        return { verdict: ticketId === '101' && round === 1 ? 'does-not-hold' : 'integrated' };
      },
    }),
    holds:  (run) => eachReviewFollowsItsPredecessorsIntegration(run, 'main') && bundleIsReleasedOnce(run, run.summary),
    mutant: { modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN, find: REVIEWABLE_TICKET_TEST, replace: 'stage === \'built\')' },
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
      find:       'const STAGES_IN_REVIEW: readonly GroupTicketStage[] = [\'built\', \'reviewing\'];',
      replace:    'const STAGES_IN_REVIEW: readonly GroupTicketStage[] = [\'building\', \'built\', \'reviewing\'];',
    },
  },
  {
    // Fails review if false. Taken from the one-builder, one-reviewer pipeline this run replaced: rerun this scenario on it to retake the table.
    name:        'a straight chain starts and integrates in the same sequence as the one-at-a-time pipeline did',
    scenarioFor: () => groupScenarioWith({ slowAgentNames: ['review 101'] }),
    holds:       (run) => run.agentEvents.join(',') === STRAIGHT_CHAIN_EVENTS_WITH_A_SLOW_FIRST_REVIEW.join(',') && run.groupBranchMoves.join(',') === '101,102',
    mutant:      { modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN, find: REVIEWABLE_TICKET_TEST, replace: 'stage === \'built\')' },
  },
  {
    name:        'two tickets with no dependency between them build at once, and the ticket depending on both starts once one of them is integrated',
    scenarioFor: () => groupScenarioWith({ group: GROUP_OF_TWO_INDEPENDENT_TICKETS }),
    holds:       (run) => mostInFlightOf(run, 'main', 'build') === 2 && releaseTicketWaitsForAllButOneDependencyIntegrated(run),
    mutant:      { modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN, ...ONE_BUILD_AT_A_TIME },
  },
  {
    name:        'a ticket with two dependencies in review waits, rather than claiming after one of them and being refused',
    scenarioFor: () => groupScenarioWith({ group: GROUP_OF_TWO_INDEPENDENT_TICKETS }),
    holds:       releaseTicketWaitsForAllButOneDependencyIntegrated,
    mutant:      {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'if (unintegratedDependencyIds.length === 1 && onlyDependencyId !== undefined',
      replace:    'if (onlyDependencyId !== undefined',
    },
  },
  {
    name:        'a builder forks off the group branch, and only a ticket waiting on one dependency in review claims after it and forks off its branch',
    scenarioFor: () => groupScenarioWith({ group: GROUP_OF_TWO_INDEPENDENT_TICKETS }),
    holds:       (run) => TICKETS_BEFORE_THE_RELEASE.every((ticketId) => buildPromptOf(run, ticketId).includes('<base> is group-example-group.'))
      && /--after 10[12]`/.test(buildPromptOf(run, RELEASE_TICKET_ID))
      && releaseTicketWaitsForAllButOneDependencyIntegrated(run),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'record.pipelinedBehindId = buildStart.startable ? buildStart.pipelinedBehindId : null;',
      replace:    'record.pipelinedBehindId = null;',
    },
  },
  {
    // Fails review if false: a non-pipelined builder's prompt gains no merge step.
    name:        'a builder pipelined behind one dependency in review merges the group branch after it forks, so a dependency integrated since is in it',
    scenarioFor: () => groupScenarioWith({ group: GROUP_OF_TWO_INDEPENDENT_TICKETS, slowAgentNames: ['review 102'] }),
    holds:       pipelinedBuilderMergesTheGroupBranch,
    mutant:      {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_AGENT_PROMPT_UTIL,
      find:       '  if (placement.pipelinedBehindId !== null) lines.push(integratedDependenciesMergeText(worktree, groupBranch, placement.pipelinedBehindId));\n',
      replace:    '',
    },
  },
  {
    name:        'every built ticket whose dependencies are integrated is reviewed at once, not only the first of the order',
    scenarioFor: () => groupScenarioWith({ group: GROUP_OF_TWO_INDEPENDENT_TICKETS }),
    holds:       (run) => mostInFlightOf(run, 'main', 'review') === 2 && releaseTicketWaitsForAllButOneDependencyIntegrated(run),
    mutant:      {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       REVIEWABLE_TICKET_TEST,
      replace:    REVIEWABLE_TICKET_TEST.replace(/\)$/, ' && ![...this.records.values()].some((record) => record.stage === \'reviewing\'))'),
    },
  },
  {
    name:        'startable tickets start by priority, then lowest id first',
    scenarioFor: () => groupScenarioWith({ limit: 1, highPriorityTicketIds: ['102'], group: GROUP_OF_TWO_INDEPENDENT_TICKETS }),
    holds:       (run) => run.calls.find((call) => call.kind === 'build')?.ticketId === '102',
    mutant:      { modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN, find: 'priorityRankOf(a.priority) - priorityRankOf(b.priority) || ', replace: '' },
  },
  {
    // Fails review if false: the group run counts the whole-board run's agents against the one limit.
    name:        'a group run beside a whole-board run starts only within the slots the other leaves, so together they never exceed the limit',
    scenarioFor: () => groupScenarioWith({
      limit:                     SHARED_LIMIT,
      readyTicketIds:            WHOLE_BOARD_TICKET_IDS,
      groupRunRaces:             true,
      racingRunStartsAfterTurns: TURNS_UNTIL_THE_WHOLE_BOARD_BUILDERS_CLAIM,
      group:                     GROUP_OF_TWO_INDEPENDENT_TICKETS,
    }),
    holds: (run) => run.mostAgentsInFlightAtOnce <= SHARED_LIMIT
      && callsNaming(run, 'racing', GROUP_TICKET_ID_PATTERN) > 0
      && JSON.stringify(summaryField(run.summary, 'delivered')) === JSON.stringify(WHOLE_BOARD_TICKET_IDS),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN,
      find:       'SlotCountUtil.ownSlotLimitOf(this.latestStatedLimit, this.othersInFlight)',
      replace:    'SlotCountUtil.ownSlotLimitOf(this.latestStatedLimit, 0)',
    },
  },
  {
    name:        'with every slot held elsewhere, a group run holding nothing still starts a builder, which waits for a slot itself',
    scenarioFor: () => groupScenarioWith({ limit: 1, otherAgentsInFlight: 1 }),
    holds:       (run) => run.calls.some((call) => call.kind === 'build' && call.ticketId === '101'),
    mutant:      { modulePath: DISPATCHER_MODULE_PATHS.GROUP_DISPATCH_RUN, find: 'Math.max(this.ownSlotsHeld() === 0 ? 1 : 0, ', replace: 'Math.max(0, ' },
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
    name:        'a single-ticket run whose lookup lists no ticket of the looked-up ticket\'s group refuses it, building nothing',
    scenarioFor: () => groupScenarioWith({
      ticketIds: [TICKET_OUTSIDE_THE_BUNDLE_ID],
      group:     { ...GROUP_WITH_A_TICKET_OUTSIDE_THE_BUNDLE, settingsLookupListsNoGroupTickets: true },
    }),
    holds: (run) => run.calls.every((call) => call.kind !== 'build')
      && run.logs.some((line) => line.includes(`#${TICKET_OUTSIDE_THE_BUNDLE_ID} belongs to the group example-group`)),
    mutant: {
      modulePath: DISPATCHER_MODULE_PATHS.DISPATCH_RUN,
      find:       'if (!ticketsOfTheGroup.some((groupTicket) => groupTicket.id === ticketId)) return true;',
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
      modulePath: DISPATCHER_MODULE_PATHS.WORKFLOW_INPUT_UTIL,
      find:       'if (entry[\'group\'] !== groupName) continue;',
      replace:    '',
    },
  },
];

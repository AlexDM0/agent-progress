/**
 * One group run's state and its decisions: the release bundle read from the board and put in dependency order, then a pipeline of at most one
 * builder and one reviewer, builder N+1 on N's built tip while reviewer N integrates N onto the group branch. It does no I/O. The release ticket,
 * last in the order, is reviewed once every ticket before it is integrated, and its reviewer alone takes the group branch to the main line.
 */
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL } from '../../src/lib/tracker-model/constants/AgentSettings.ts';
import { DispatcherClaimNoteUtil }                   from '../../src/shared/utils/DispatcherClaimNoteUtil.ts';
import type {
  AgentReading,
  GroupSurveyReading,
  GroupTicketReading,
  StatusReading
} from '../@types/AgentReadings.ts';
import type {
  DispatchOutcome,
  ParkReason,
  ParkedTicket,
  PassFailure,
  ReviewedRound
} from '../@types/DispatchOutcome.ts';
import type { AgentModelAndEffort, DispatchSettings } from '../@types/DispatchSettings.ts';
import type {
  AgentWork,
  DispatchWork,
  FinishedAgent,
  GroupPlacement,
  PreviousPass
} from '../@types/DispatchWork.ts';
import { DISPATCH_POLICY }               from '../constants/DispatchPolicy.ts';
import type { DispatchRunCollaborators } from './DispatchRun.ts';
import { RoundVerdictUtil }              from './utils/RoundVerdictUtil.ts';

type GroupTicketStage = 'to-build' | 'building' | 'built' | 'reviewing' | 'integrated' | 'released' | 'parked';

interface GroupTicketRecord {
  stage:               GroupTicketStage;
  previousPass:        PreviousPass;
  failedPasses:        number;
  mainMovedReleases:   number;
  nextRound:           number;
  rounds:              ReviewedRound[];
  rereviewRunsFirst:   boolean;
  earlierReviewerDied: boolean;
  barIsHandedOn:       boolean;
  agentModelAndEffort: AgentModelAndEffort;
}

interface OwnAgent {
  work:      DispatchWork;
  finishing: Promise<FinishedAgent>;
}

type BuildReading = Extract<AgentReading, { kind: 'build' }>;

type ReviewReading = Extract<AgentReading, { kind: 'review' }>;

const SETTLED_TICKET_STATUSES = ['reviewed', 'delivered', 'abandoned'];

function releaseTicketOf(tickets: readonly GroupTicketReading[]): GroupTicketReading | undefined {
  return tickets.find((ticket) => ticket.releasesGroup && ticket.status !== 'delivered' && ticket.status !== 'abandoned');
}

// The release ticket and every ticket of the group it depends on, directly or not; a dependency outside the group is not followed.
function bundleOf(tickets: readonly GroupTicketReading[], releaseTicket: GroupTicketReading): GroupTicketReading[] {
  const bundle = new Map<string, GroupTicketReading>();
  const pending = [releaseTicket.id];
  while (pending.length > 0) {
    const ticketId = pending.pop() ?? '';
    const ticket = tickets.find((groupTicket) => groupTicket.id === ticketId);
    if (ticket === undefined || bundle.has(ticketId)) continue;
    bundle.set(ticketId, ticket);
    pending.push(...ticket.dependsOn);
  }
  return [...bundle.values()];
}

// Dependency order, the lowest id first among the tickets whose dependencies inside the bundle are placed; a circle falls back to id order.
function pipelineOrderOf(bundle: readonly GroupTicketReading[]): string[] {
  const bundleIds = new Set(bundle.map((ticket) => ticket.id));
  const remaining = [...bundle].sort((a, b) => Number(a.id) - Number(b.id));
  const ordered: string[] = [];
  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((ticket) => ticket.dependsOn.every((dependencyId) => !bundleIds.has(dependencyId) || ordered.includes(dependencyId)));
    const [next] = remaining.splice(nextIndex === -1 ? 0 : nextIndex, 1);
    if (next !== undefined) ordered.push(next.id);
  }
  return ordered;
}

export class GroupDispatchRun {
  private readonly settings:      DispatchSettings;
  private readonly groupName:     string;
  private readonly collaborators: DispatchRunCollaborators;
  private readonly records:       Map<string, GroupTicketRecord> = new Map();
  private readonly inFlight:      Map<number, OwnAgent> = new Map();
  private readonly integrated:    string[] = [];
  private readonly delivered:     string[] = [];
  private readonly parked:        ParkedTicket[] = [];
  private readonly findingsFiled: string[] = [];
  private readonly settledBefore: Set<string> = new Set();
  private orderedTicketIds:       string[] = [];
  private releaseTicketId:        string = '';
  private bundleIsUnread:         boolean = false;
  private runWasStoppedByBoard:   boolean = false;
  private releasedOutOfTurn:      boolean = false;
  private agentsRun:              number = 0;
  private launchCount:            number = 0;

  constructor(settings: DispatchSettings, groupName: string, collaborators: DispatchRunCollaborators) {
    this.settings      = settings;
    this.groupName     = groupName;
    this.collaborators = collaborators;
  }

  recordSurveyAgentStarted(): void {
    this.agentsRun++;
  }

  // Recovery reads the board alone: a settled ticket is integrated, a built one waits for its reviewer, and an in-progress one under this group's
  // claim is carried on by a builder of this run.
  adoptGroupSurvey(survey: GroupSurveyReading | null): 'ready-to-dispatch' | 'nothing-dispatched' {
    if (survey === null) {
      this.collaborators.logger.surveyReturnedNothing();
      return 'nothing-dispatched';
    }
    if (survey.status === 'unreadable') {
      this.collaborators.logger.surveyStatusUnreadable();
      return 'nothing-dispatched';
    }
    this.adoptStatusReading(survey.status);
    const releaseTicket = survey.tickets === 'unlisted' ? undefined : releaseTicketOf(survey.tickets);
    if (survey.tickets === 'unlisted' || releaseTicket === undefined) {
      this.bundleIsUnread = true;
      this.collaborators.logger.groupBundleUnread(this.groupName);
      return 'nothing-dispatched';
    }
    const bundle = bundleOf(survey.tickets, releaseTicket);
    this.releaseTicketId  = releaseTicket.id;
    this.orderedTicketIds = pipelineOrderOf(bundle);
    for (const ticket of bundle) this.records.set(ticket.id, this.recordAdoptedFrom(ticket));
    return 'ready-to-dispatch';
  }

  startWorkWithinThePipeline(): void {
    if (this.runWasStoppedByBoard) return;
    if (this.releasedOutOfTurn) return;
    const review = this.nextReview();
    if (review !== null) this.launch(review);
    const build = this.nextBuild();
    if (build !== null) this.launch(build);
  }

  finishingOfAgentsInFlight(): Promise<FinishedAgent>[] {
    return [...this.inFlight.values()].map((ownAgent) => ownAgent.finishing);
  }

  settleFinished(finished: FinishedAgent): void {
    this.inFlight.delete(finished.key);
    const { work, reading } = finished;
    if (work.kind === 'build') this.settleBuild(work.ticketId, reading?.kind === 'build' ? reading : null);
    else if (work.kind === 'review') this.settleReview(work.ticketId, work.round, reading?.kind === 'review' ? reading : null);
    else if (reading === null) this.collaborators.logger.parkingAgentReturnedNothing(work.ticketId);
    if (reading !== null && reading.status !== 'unreadable') this.adoptStatusReading(reading.status);
  }

  // A built ticket whose reviewer this run does not start holds the bar its builder handed on, and with it a slot, until a parking agent closes it.
  releaseBarsLeftRunning(): void {
    for (const ticketId of this.orderedTicketIds) {
      const record = this.recordOf(ticketId);
      if (record.stage !== 'built' || !record.barIsHandedOn) continue;
      record.barIsHandedOn = false;
      this.launch({ kind: 'park', ticketId, release: { cause: 'left-for-the-go' } });
    }
  }

  closeTheRun(): void {
    this.collaborators.logger.runDone(this.delivered.length, this.parked.map((parkedTicket) => parkedTicket.ticketId), this.findingsFiled.length, this.agentsRun);
  }

  outcome(): DispatchOutcome {
    return {
      delivered:               this.delivered,
      parked:                  this.parked,
      findingsFiled:           this.findingsFiled,
      agentsRun:               this.agentsRun,
      runWasStoppedByBoard:    this.runWasStoppedByBoard,
      runWasStoppedByFailures: false,
      lowPriorityWaiting:      [],
      held:                    [],
      pausedBuilds:            [],
      reviewsLeft:             [],
      dirtyMainCheckoutFiles:  [],
      groupOutcome:            {
        groupName:            this.groupName,
        integrated:           this.integrated,
        waitingOnPredecessor: this.waitingOnPredecessorIds(),
        bundleIsUnread:       this.bundleIsUnread,
      },
    };
  }

  private recordAdoptedFrom(ticket: GroupTicketReading): GroupTicketRecord {
    const ownClaimNote = DispatcherClaimNoteUtil.claimNoteFor(this.settings.runLabel, ticket.id);
    let stage: GroupTicketStage = 'to-build';
    if (SETTLED_TICKET_STATUSES.includes(ticket.status)) stage = 'integrated';
    else if (ticket.status === 'in-review') stage = 'built';
    if (ticket.status === 'delivered' || ticket.status === 'abandoned') this.settledBefore.add(ticket.id);
    return {
      stage,
      previousPass:        ticket.status === 'in-progress' && ticket.rowNote === ownClaimNote && ticket.worktreeExists ? 'builder' : null,
      failedPasses:        0,
      mainMovedReleases:   0,
      nextRound:           1,
      rounds:              [],
      rereviewRunsFirst:   false,
      earlierReviewerDied: false,
      barIsHandedOn:       stage === 'built' && ticket.openReviewBar,
      agentModelAndEffort: ticket.agentModelAndEffort,
    };
  }

  private recordOf(ticketId: string): GroupTicketRecord {
    const existing = this.records.get(ticketId);
    if (existing !== undefined) return existing;
    const record: GroupTicketRecord = {
      stage:               'parked',
      previousPass:        null,
      failedPasses:        0,
      mainMovedReleases:   0,
      nextRound:           1,
      rounds:              [],
      rereviewRunsFirst:   false,
      earlierReviewerDied: false,
      barIsHandedOn:       false,
      agentModelAndEffort: { model: DEFAULT_AGENT_MODEL, effort: DEFAULT_AGENT_EFFORT },
    };
    this.records.set(ticketId, record);
    return record;
  }

  private adoptStatusReading(status: StatusReading): void {
    if (!status.dispatcherIsStopped || this.runWasStoppedByBoard) return;
    this.runWasStoppedByBoard = true;
    this.collaborators.logger.statusShowsTheRunStopped(this.inFlight.size);
  }

  private predecessorOf(ticketId: string): string | null {
    const position = this.orderedTicketIds.indexOf(ticketId);
    return position > 0 ? this.orderedTicketIds[position - 1] ?? null : null;
  }

  private placementOf(ticketId: string): GroupPlacement {
    return {
      groupName:        this.groupName,
      orderedTicketIds: this.orderedTicketIds,
      releaseTicketId:  this.releaseTicketId,
      predecessorId:    this.predecessorOf(ticketId),
    };
  }

  private agentsInFlightOf(kind: AgentWork['kind']): number {
    return [...this.inFlight.values()].filter((ownAgent) => ownAgent.work.kind === kind).length;
  }

  private predecessorIsBuilt(ticketId: string): boolean {
    const predecessorId = this.predecessorOf(ticketId);
    if (predecessorId === null) return true;
    const { stage } = this.recordOf(predecessorId);
    return stage === 'built' || stage === 'reviewing' || stage === 'integrated';
  }

  private predecessorIsIntegrated(ticketId: string): boolean {
    const predecessorId = this.predecessorOf(ticketId);
    return predecessorId === null || this.recordOf(predecessorId).stage === 'integrated';
  }

  // The ticket every later one waits on: the first of the order not integrated yet.
  private firstUnintegratedTicketId(): string | undefined {
    return this.orderedTicketIds.find((ticketId) => this.recordOf(ticketId).stage !== 'integrated');
  }

  private nextReview(): AgentWork | null {
    if (this.agentsInFlightOf('review') >= DISPATCH_POLICY.GROUP_REVIEWERS_AT_ONCE) return null;
    const ticketId = this.orderedTicketIds.find((groupTicketId) => this.recordOf(groupTicketId).stage === 'built');
    if (ticketId === undefined || !this.predecessorIsIntegrated(ticketId)) return null;
    const record = this.recordOf(ticketId);
    record.stage = 'reviewing';
    const review: AgentWork = {
      kind:                'review',
      ticketId,
      round:               record.nextRound,
      rereviewRunsFirst:   record.rereviewRunsFirst,
      earlierReviewerDied: record.earlierReviewerDied,
    };
    return record.barIsHandedOn ? { ...review, barIsHandedOn: true } : review;
  }

  private nextBuild(): AgentWork | null {
    if (this.agentsInFlightOf('build') >= DISPATCH_POLICY.GROUP_BUILDERS_AT_ONCE) return null;
    const ticketId = this.orderedTicketIds.find((groupTicketId) => this.recordOf(groupTicketId).stage === 'to-build');
    if (ticketId === undefined || !this.predecessorIsBuilt(ticketId)) return null;
    const record = this.recordOf(ticketId);
    record.stage = 'building';
    return { kind: 'build', ticketId, previousPass: record.previousPass };
  }

  private launch(work: DispatchWork): void {
    const key = this.launchCount++;
    this.agentsRun++;
    const finishing = this.collaborators.startAgent(work.kind === 'park' ? { key, work } : {
      key,
      work,
      agentModelAndEffort:         this.recordOf(work.ticketId).agentModelAndEffort,
      pausedBuildWasFoundBySurvey: false,
      groupPlacement:              this.placementOf(work.ticketId),
    });
    this.inFlight.set(key, { work, finishing });
  }

  private park(ticketId: string, reason: ParkReason, rowsAreThisRunsOwn: boolean): void {
    this.recordOf(ticketId).stage = 'parked';
    this.parked.push({ ticketId, reason });
    this.collaborators.logger.ticketParked(ticketId, reason);
    if (rowsAreThisRunsOwn) this.launch({ kind: 'park', ticketId, release: { cause: 'parked', parkReason: reason } });
  }

  private countFailedPass(ticketId: string, failure: PassFailure, retry: (record: GroupTicketRecord) => void): void {
    const record = this.recordOf(ticketId);
    record.failedPasses++;
    if (record.failedPasses >= DISPATCH_POLICY.FAILED_PASSES_BEFORE_PARKING) {
      this.park(ticketId, { cause: 'second-failed-pass', failure }, true);
      return;
    }
    this.collaborators.logger.freshAgentTakesOver(ticketId, failure);
    retry(record);
  }

  private rebuild(ticketId: string, failure: PassFailure, previousPass: PreviousPass): void {
    this.countFailedPass(ticketId, failure, (record) => {
      record.stage        = 'to-build';
      record.previousPass = previousPass;
    });
  }

  private settleBuild(ticketId: string, reading: BuildReading | null): void {
    if (reading === null) {
      this.rebuild(ticketId, { cause: 'builder-returned-nothing' }, 'builder');
      return;
    }
    if (reading.outcome === 'claim-refused' && reading.claimNote === DispatcherClaimNoteUtil.claimNoteFor(this.settings.runLabel, ticketId)) {
      this.rebuild(ticketId, { cause: 'own-claim-refused', detail: reading.detail }, 'builder');
      return;
    }
    // Another's claim holds the ticket: its rows are not this run's to pause, and every later ticket waits behind it.
    if (reading.outcome === 'claim-refused') {
      this.park(ticketId, { cause: 'claim-refused', detail: reading.detail }, false);
      return;
    }
    if (reading.outcome === 'failed') {
      this.rebuild(ticketId, { cause: 'builder-stopped-short', detail: reading.detail }, 'builder');
      return;
    }
    const record = this.recordOf(ticketId);
    record.stage             = 'built';
    record.barIsHandedOn     = true;
    record.rereviewRunsFirst = false;
  }

  private settleReview(ticketId: string, expectedRound: number, reading: ReviewReading | null): void {
    const record = this.recordOf(ticketId);
    if (reading === null) {
      record.nextRound = expectedRound + 1;
      this.countFailedPass(ticketId, { cause: 'reviewer-returned-nothing' }, () => {
        record.stage               = 'built';
        record.rereviewRunsFirst   = true;
        record.earlierReviewerDied = true;
        record.barIsHandedOn       = false;
      });
      return;
    }
    this.findingsFiled.push(...reading.filedTicketIds);
    const round = reading.round === 'unstated' ? expectedRound : reading.round;
    record.rounds.push({ round, findings: reading.findings });
    record.nextRound = round + 1;
    if (reading.verdict === 'released') {
      this.settleRelease(ticketId);
      return;
    }
    if (reading.verdict === 'integrated' && ticketId === this.releaseTicketId) {
      this.park(ticketId, { cause: 'release-refused', statedReason: 'integrated-without-release', blockingFiles: [] }, true);
      return;
    }
    if (reading.verdict === 'integrated') {
      record.stage = 'integrated';
      this.integrated.push(ticketId);
      this.collaborators.logger.ticketIntegrated(ticketId, this.groupName);
      return;
    }
    if (reading.verdict === 'does-not-hold') {
      this.rebuild(ticketId, { cause: 'review-does-not-hold' }, 'review');
      return;
    }
    if (reading.verdict === 'not-released' && reading.releaseRefusal === 'main-moved' && ticketId === this.releaseTicketId) {
      this.settleMainMovedUnderTheRelease(ticketId);
      return;
    }
    if (reading.verdict !== 'round-requested') {
      const refusal = reading.releaseRefusal === 'main-moved' ? { statedReason: 'main-moved', blockingFiles: [] } : reading.releaseRefusal;
      this.park(ticketId, { cause: 'release-refused', statedReason: refusal.statedReason, blockingFiles: refusal.blockingFiles }, true);
      return;
    }
    const verdict = RoundVerdictUtil.nextRoundVerdictOf(record.rounds, { round, findings: reading.findings, reworkedLines: reading.reworkedLines });
    if (!verdict.granted) {
      this.park(ticketId, { cause: 'round-refused', refusal: verdict.refusal }, true);
      return;
    }
    this.collaborators.logger.roundGranted(ticketId, record.nextRound, reading.reworkedLines);
    this.reviewAgainWithTheBarLeftRunning(record);
  }

  private reviewAgainWithTheBarLeftRunning(record: GroupTicketRecord): void {
    record.stage             = 'built';
    record.rereviewRunsFirst = true;
    record.barIsHandedOn     = true;
  }

  // Only the release ticket's reviewer releases: a release reported by any other is a breach the run does not build on.
  private settleRelease(ticketId: string): void {
    if (ticketId !== this.releaseTicketId) {
      this.releasedOutOfTurn = true;
      this.park(ticketId, { cause: 'released-out-of-turn', releaseTicketId: this.releaseTicketId }, true);
      return;
    }
    const deliveredTicketIds = this.orderedTicketIds.filter((groupTicketId) => !this.settledBefore.has(groupTicketId));
    for (const groupTicketId of this.orderedTicketIds) this.recordOf(groupTicketId).stage = 'released';
    this.delivered.push(...deliveredTicketIds);
    this.collaborators.logger.groupReleased(ticketId, this.groupName, deliveredTicketIds);
  }

  private settleMainMovedUnderTheRelease(ticketId: string): void {
    const record = this.recordOf(ticketId);
    record.mainMovedReleases++;
    if (record.mainMovedReleases >= DISPATCH_POLICY.MAIN_MOVED_RELEASES_BEFORE_PARKING) {
      this.park(ticketId, { cause: 'main-line-moved', releases: record.mainMovedReleases }, true);
      return;
    }
    this.collaborators.logger.mainLineMovedUnderRelease(ticketId, record.nextRound);
    this.reviewAgainWithTheBarLeftRunning(record);
  }

  // Built after a ticket the run parked: its work waits, unreviewed, for that ticket to be settled by hand.
  private waitingOnPredecessorIds(): string[] {
    const firstUnintegratedTicketId = this.firstUnintegratedTicketId();
    if (firstUnintegratedTicketId === undefined || this.recordOf(firstUnintegratedTicketId).stage !== 'parked') return [];
    return this.orderedTicketIds.filter((ticketId) => this.recordOf(ticketId).stage === 'built');
  }
}

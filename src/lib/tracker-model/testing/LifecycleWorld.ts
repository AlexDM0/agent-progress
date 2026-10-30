/**
 * A seeded, clock-free world around one Board: each turn advances the lifecycle, checks the invariants against what the pass derived and
 * left, then lets a fake agent or user act at random on a live job or an open decision. It returns every invariant it saw broken.
 */
import type {
  InterruptionCause,
  Job,
  JobOutcome,
  JobState
} from '../@types/Job.ts';
import type { LogRecord }                                   from '../@types/LogRecord.ts';
import type { PlaybookStep, DecisionWording }               from '../@types/PlaybookStep.ts';
import type { Ticket, TicketFrontmatter }                   from '../@types/Ticket.ts';
import type { TrackerProgress }                             from '../@types/TrackerProgress.ts';
import type { MergeTargetOf }                               from '../AirlockClaims.ts';
import { Board }                                            from '../Board.ts';
import { BoardRefusal }                                     from '../BoardRefusal.ts';
import { createLogger }                                     from '../Logger.ts';
import { FIXTURE_AT, FIXTURE_LIMITS, FIXTURE_OBSERVATIONS } from './LifecycleFixtures.ts';

const WORLD_CONCURRENCY_LIMIT = 2;

const INTERRUPTION_CAUSES: readonly InterruptionCause[] = ['watcher-lost', 'agent-crashed', 'reboot', 'usage-limit'];

const ENDINGS_BY_KIND: Readonly<Record<'build' | 'review' | 'assistant', readonly JobOutcome[]>> = {
  build:     ['built', 'built', 'failed'],
  review:    ['reviewed', 'does-not-hold', 'round-granted'],
  assistant: ['closed'],
};

/** The states in which a job's Watcher runs its session, so the world keeps a Watcher instance live for it. */
const WATCHER_RUNNING_STATES: readonly JobState[] = ['running', 'waiting-for-answer'];

/** The states in which a worktree job's session or the Overseer acts on its worktree with git. */
const GIT_OPERATING_STATES: readonly JobState[] = ['preparing', 'running', 'waiting-for-answer', 'in-customs', 'gating', 'merging', 'landing'];

const CRASH_CAUSES: readonly string[] = ['watcher-lost', 'agent-crashed'];

const WORLD_TARGETS: readonly string[] = ['main', 'group-example'];

/** How often an allocation that finds nothing queued on the group claims a refresh: rare enough that the release still reaches its slot. */
const WORLD_REFRESH_CHANCE = 0.2;

function worldTargetOf(group: string | undefined): string {
  return group === undefined ? 'main' : `group-${group}`;
}

/** A group's release ticket merges into the main line; every other ticket of a group into the group's branch. */
const worldMergeTargetOf: MergeTargetOf = (ticket) => (ticket.releasesGroup === true ? 'main' : worldTargetOf(ticket.group));

const WORLD_WORDING: DecisionWording = {
  questions: [{
    question:    'Carry on?',
    header:      'Carry on',
    multiSelect: false,
    options:     [{ label: 'Yes', description: 'Carry on' }, { label: 'No', description: 'Wait' }],
  }],
  context: '',
};

/** Mulberry32: a small seeded generator, so a failing seed replays exactly. */
function randomSourceOf(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed     = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function worldTicket(id: string, overrides: Partial<TicketFrontmatter> = {}): Ticket {
  const frontmatter: TicketFrontmatter = {
    id,
    title:       `Example world ticket ${id}`,
    type:        'ticket',
    status:      'pending',
    filed:       FIXTURE_AT,
    updated:     FIXTURE_AT,
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    ...overrides,
  };
  return { frontmatter, body: '', filePath: `/example-agency/world/.agent-progress/tickets/${id}-example.md` };
}

export class LifecycleWorld {
  readonly violations: string[] = [];

  private readonly tickets: Ticket[] = [
    worldTicket('001'),
    worldTicket('002', { priority: 'low' }),
    worldTicket('003', { dependsOn: ['001'] }),
    worldTicket('004', { group: 'example' }),
    worldTicket('005', { group: 'example', dependsOn: ['004'] }),
    worldTicket('006', { priority: 'high' }),
    // A release with no dependency, so seeds reach its main-line merge while the group still refreshes.
    worldTicket('007', { group: 'example', releasesGroup: true }),
  ];

  private readonly progress: TrackerProgress = {
    trackerId:        'example-world',
    project:          'Example Agency',
    startedAt:        FIXTURE_AT,
    view:             { kind: 'auto' },
    nextTaskId:       1,
    concurrencyLimit: WORLD_CONCURRENCY_LIMIT,
    overseerState:    'running',
    tasks:            [],
  };

  private readonly logRecords: LogRecord[] = [];

  private readonly board: Board;

  private readonly random: () => number;

  private requestCount = 0;

  /** The Watcher instances the world keeps running per job: spawned as a job runs on an instance, killed only by an interruption or an end. */
  private readonly liveWatcherInstances = new Map<string, Set<number>>();

  /** How far the log was already checked for resumes, so each record is judged once. */
  private checkedRecordCount = 0;

  private readonly endedJobIds = new Set<string>();

  private readonly crashResumesByJobId = new Map<string, number>();

  constructor(seed: number) {
    this.random = randomSourceOf(seed);
    this.board  = new Board({
      progress: this.progress,
      tickets:  this.tickets,
      epics:    [],
      logger:   createLogger((record) => this.logRecords.push(record)),
      pipeline: { prepare: [], gates: [{ name: 'verify', run: 'bun run verify' }], review: { name: 'Review' } },
    });
  }

  run(turns: number): readonly string[] {
    for (let i = 0; i < turns; i += 1) {
      this.advance(i);
      this.act();
      this.syncHosts(i);
    }
    return this.violations;
  }

  /** Every record kind the world logged, once each, so a spec can prove the run did the work it checks. */
  loggedKinds(): string[] {
    return [...new Set(this.logRecords.map((record) => record.kind))];
  }

  private advance(turn: number): void {
    const jobsBefore = this.board.jobs().map((job) => ({ ...job }));
    let steps: readonly PlaybookStep[] = [];
    try {
      ({ steps } = this.board.followPlaybook(FIXTURE_LIMITS, FIXTURE_OBSERVATIONS, () => WORLD_WORDING));
    } catch (error) {
      this.violations.push(`turn ${turn}: the pass threw ${String(error)}`);
    }
    for (const step of steps) {
      if (step.kind !== 'resume-job') continue;
      const resumed = jobsBefore.find((job) => job.id === step.jobId);
      if (resumed?.state !== 'interrupted' || resumed.kind === 'assistant') this.violations.push(`turn ${turn}: resumed ${step.jobId}, which was no interrupted agent job`);
    }
    this.syncHosts(turn);
    this.checkInvariants(turn);
    this.checkMergeInvariants(turn);
    this.checkResumes(turn);
  }

  /** A job running on an instance the world has not spawned gets that Watcher; a job interrupted, ended or gone has none left. */
  private syncHosts(turn: number): void {
    const liveJobs = new Map(this.board.jobs().map((job) => [job.id, job]));
    for (const [jobId, instances] of this.liveWatcherInstances) {
      const job = liveJobs.get(jobId);
      if (job === undefined || !WATCHER_RUNNING_STATES.includes(job.state)) instances.clear();
    }
    for (const job of liveJobs.values()) {
      if (!WATCHER_RUNNING_STATES.includes(job.state)) continue;
      const instances = this.liveWatcherInstances.get(job.id) ?? new Set<number>();
      instances.add(job.watcherInstance);
      this.liveWatcherInstances.set(job.id, instances);
      if (instances.size > 1) this.violations.push(`turn ${turn}: job ${job.id} has Watcher instances ${[...instances].join(', ')} live at once`);
    }
  }

  private killWatcher(jobId: string): void {
    this.liveWatcherInstances.get(jobId)?.clear();
  }

  /** Read from the log as written: a resume of a job already ended, or a crash resume past the bound, is a violation. */
  private checkResumes(turn: number): void {
    for (const record of this.logRecords.slice(this.checkedRecordCount)) {
      if (record.kind === 'job-ended') this.endedJobIds.add(record.jobId);
      if (record.kind !== 'job-resumed') continue;
      if (this.endedJobIds.has(record.jobId)) this.violations.push(`turn ${turn}: resumed ${record.jobId}, a finished session`);
      if (!CRASH_CAUSES.includes(record.fields.cause)) continue;
      const crashResumes = (this.crashResumesByJobId.get(record.jobId) ?? 0) + 1;
      this.crashResumesByJobId.set(record.jobId, crashResumes);
      if (crashResumes > FIXTURE_LIMITS.JOB_RESUMES_BEFORE_FRESH) this.violations.push(`turn ${turn}: crash-resumed ${record.jobId} ${crashResumes} times`);
    }
    this.checkedRecordCount = this.logRecords.length;
  }

  private checkInvariants(turn: number): void {
    const jobs = this.board.jobs();
    for (const ticket of this.tickets) {
      const liveJobs = jobs.filter((job) => job.ticketIds.includes(ticket.frontmatter.id)).length;
      if (liveJobs > 1) this.violations.push(`turn ${turn}: ticket ${ticket.frontmatter.id} has ${liveJobs} live jobs`);
    }
    const gitOperationsByWorktree = new Map<string, number>();
    for (const job of jobs.filter((candidate) => (candidate.kind === 'build' || candidate.kind === 'review') && GIT_OPERATING_STATES.includes(candidate.state))) {
      const worktree = `ticket-${job.ticketIds[0] ?? ''}`;
      gitOperationsByWorktree.set(worktree, (gitOperationsByWorktree.get(worktree) ?? 0) + 1);
    }
    for (const [worktree, operations] of gitOperationsByWorktree) {
      if (operations > 1) this.violations.push(`turn ${turn}: worktree ${worktree} has ${operations} git operations at once`);
    }
    const slotJobs = jobs.filter((job) => job.kind === 'build' || job.kind === 'review').length;
    if (slotJobs > WORLD_CONCURRENCY_LIMIT) this.violations.push(`turn ${turn}: ${slotJobs} build and review jobs past the limit`);
    const answersByDecision = new Map<string, number>();
    for (const record of this.logRecords) {
      if (record.kind === 'decision-answered') answersByDecision.set(record.decisionId, (answersByDecision.get(record.decisionId) ?? 0) + 1);
    }
    for (const [decisionId, answers] of answersByDecision) {
      if (answers > 1) this.violations.push(`turn ${turn}: decision ${decisionId} answered ${answers} times`);
    }
    for (const job of jobs) {
      if (new Set(job.answeredRequestIds).size !== job.answeredRequestIds.length) this.violations.push(`turn ${turn}: job ${job.id} delivered an answer twice`);
      const stillAsked = this.board.decisions().some((decision) => decision.jobId === job.id) || this.board.incidents().some((incident) => incident.jobId === job.id);
      if (job.state === 'waiting-for-answer' && !stillAsked) this.violations.push(`turn ${turn}: job ${job.id} waits for an answer nobody was asked`);
    }
  }

  private pick<Item>(items: readonly Item[]): Item | undefined {
    return items[Math.floor(this.random() * items.length)];
  }

  private act(): void {
    if (this.random() < 0.3) {
      this.claimASlot();
      return;
    }
    const decision = this.pick(this.board.decisions());
    if (decision !== undefined && this.random() < 0.5) {
      this.answer(decision.id);
      return;
    }
    const job = this.pick(this.board.jobs());
    if (job !== undefined) this.actOn(job);
  }

  /** Answers, then answers again: the second must be refused, so a question is answered at most once. */
  private answer(decisionId: string): void {
    const decision = this.board.decisionById(decisionId);
    if (decision === undefined) return;
    this.board.answerDecision(decisionId, ['Yes'], FIXTURE_AT);
    if (decision.kind === 'parked') decision.ticketIds.forEach((ticketId) => this.board.unholdTicket(ticketId, FIXTURE_AT));
    if (decision.kind === 'outage') this.board.setOverseerState('running', FIXTURE_AT);
    if (decision.jobId !== null && this.board.jobById(decision.jobId)?.state === 'waiting-for-answer') this.board.moveJob(decision.jobId, 'running', FIXTURE_AT);
    try {
      this.board.answerDecision(decisionId, ['No'], FIXTURE_AT);
      this.violations.push(`decision ${decisionId} took a second answer`);
    } catch {
      // The refusal is the invariant holding.
    }
  }

  /** An Overseer's allocation at a random moment: the claim itself must refuse whatever would break a slot invariant. */
  private claimASlot(): void {
    const target = this.pick(WORLD_TARGETS) ?? 'main';
    const tip = `tip-${this.logRecords.length}`;
    try {
      const candidate = this.pick(this.board.mergeCandidatesOf(target, worldMergeTargetOf));
      // With nothing queued on the group, the Overseer's refresh may be due.
      if (candidate === undefined && target !== 'main' && this.random() < WORLD_REFRESH_CHANCE) {
        this.board.claimRefreshSlot({
          group: 'example', target, targetTip: tip, mainTip: `main-${tip}`
        }, FIXTURE_AT);
      }
      if (candidate === undefined) return;
      this.board.claimAirlock({
        ticketId: candidate.ticketId, target, targetTip: tip, branchTip: `branch-${candidate.ticketId}`, predictedConflictFiles: []
      }, worldMergeTargetOf, FIXTURE_AT);
    } catch (refusal) {
      if (!(refusal instanceof BoardRefusal)) throw refusal;
    }
  }

  /**
   * Lands only on a tree it gated first, or frees the slot as a moved target does, leaving the ticket queued. A group's ticket is integrated
   * and approved, a release delivers its bundle, and a refresh lands on its group's branch.
   */
  private actOnMerge(job: Readonly<Job>): void {
    const ticketId = job.ticketIds[0] ?? '';
    if (this.random() < 0.5) {
      this.board.endJob(job.id, { outcome: 'stopped', cause: 'target-moved' }, FIXTURE_AT);
      return;
    }
    const tree = `tree-${job.id}`;
    const target = job.target ?? 'main';
    this.board.recordGateRan({ tree, outcome: 'passed', cached: false }, FIXTURE_AT);
    this.board.recordMergeLanded(job.id, { target, commit: tree, kind: target === 'main' ? 'landed' : 'integrated' }, FIXTURE_AT);
    if (job.kind === 'refresh') {
      this.board.endJob(job.id, { outcome: 'refreshed', commit: tree }, FIXTURE_AT);
      return;
    }
    this.board.endJob(job.id, { outcome: target === 'main' ? 'landed' : 'integrated', commit: tree }, FIXTURE_AT);
    this.board.setTicketMergeQueued(ticketId, false, FIXTURE_AT);
    if (target !== 'main') {
      this.moveTicketWhenBuilt(ticketId, 'in-review', 'reviewed');
      return;
    }
    const group = this.groupOf(ticketId);
    const bundle = group === undefined ? [] : this.board.releaseBundleTicketIdsOf(group);
    bundle.forEach((bundleTicketId) => this.moveTicketWhenBuilt(bundleTicketId, 'reviewed', 'delivered'));
    this.moveTicketWhenBuilt(ticketId, 'in-review', 'delivered');
  }

  private actOn(job: Readonly<Job>): void {
    if (job.kind === 'merge' || job.kind === 'refresh') {
      this.actOnMerge(job);
      return;
    }
    const roll = this.random();
    if (job.state === 'launching') {
      this.board.moveJob(job.id, 'running', FIXTURE_AT);
      job.ticketIds.forEach((ticketId) => this.moveTicketWhenBuilt(ticketId, 'pending', 'in-progress'));
      return;
    }
    if (job.state !== 'running') return;
    if (roll < 0.15 && job.kind !== 'assistant') {
      this.board.moveJob(job.id, 'waiting-for-answer', FIXTURE_AT);
      this.requestCount += 1;
      this.board.openDecision({
        kind: 'agent-question', ticketIds: job.ticketIds, jobId: job.id, askedBy: 'builder', requestId: `R${this.requestCount}`, ...WORLD_WORDING,
      }, FIXTURE_AT);
      return;
    }
    if (roll < 0.35) {
      this.killWatcher(job.id);
      this.board.interruptJob(job.id, this.pick(INTERRUPTION_CAUSES) ?? 'watcher-lost', FIXTURE_AT);
      return;
    }
    this.end(job);
  }

  private end(job: Readonly<Job>): void {
    const kind    = job.kind === 'review' || job.kind === 'assistant' ? job.kind : 'build';
    const outcome = this.pick(ENDINGS_BY_KIND[kind]) ?? 'failed';
    this.board.endJob(job.id, { outcome }, FIXTURE_AT);
    const ticketId = job.ticketIds[0];
    if (ticketId === undefined) return;
    if (outcome === 'built') this.moveTicketWhenBuilt(ticketId, 'in-progress', 'in-review');
    if (outcome === 'reviewed' && this.ticketStatusOf(ticketId) === 'in-review') this.board.queueTicketForMerge(ticketId, worldTargetOf(this.groupOf(ticketId)), FIXTURE_AT);
    if (outcome === 'does-not-hold') this.moveTicketWhenBuilt(ticketId, 'in-review', 'in-progress');
  }

  private ticketStatusOf(ticketId: string): TicketFrontmatter['status'] | undefined {
    return this.tickets.find((candidate) => candidate.frontmatter.id === ticketId)?.frontmatter.status;
  }

  private releasesItsGroup(ticketId: string): boolean {
    return this.tickets.find((candidate) => candidate.frontmatter.id === ticketId)?.frontmatter.releasesGroup === true;
  }

  private groupOf(ticketId: string): string | undefined {
    return this.tickets.find((candidate) => candidate.frontmatter.id === ticketId)?.frontmatter.group;
  }

  /**
   * At most one merge or refresh per target, so never two refreshes; never a refresh beside its group's release merging main; a target
   * moving only to a tree gated first; no ticket slotted again before its last merge job ended.
   */
  private checkMergeInvariants(turn: number): void {
    const jobs = this.board.jobs();
    for (const target of WORLD_TARGETS) {
      const holders = jobs.filter((job) => (job.kind === 'merge' || job.kind === 'refresh') && job.target === target).length;
      if (holders > 1) this.violations.push(`turn ${turn}: ${holders} merge jobs hold ${target}`);
    }
    const releaseIsMerging = jobs.some((job) => job.kind === 'merge' && job.ticketIds.some((ticketId) => this.releasesItsGroup(ticketId)));
    if (releaseIsMerging && jobs.some((job) => job.kind === 'refresh')) this.violations.push(`turn ${turn}: a refresh runs beside its group's release`);
    const gatedTrees = new Set<string>();
    const openMergeJobByTicketId = new Map<string, string>();
    for (const record of this.logRecords) {
      if (record.kind === 'gate-ran' && record.fields.outcome === 'passed') gatedTrees.add(record.fields.tree);
      if (record.kind === 'merge-landed' && !gatedTrees.has(record.fields.commit)) {
        this.violations.push(`turn ${turn}: ${record.fields.target} moved to ungated ${record.fields.commit}`);
      }
      if (record.kind === 'job-ended') openMergeJobByTicketId.forEach((jobId, ticketId) => (jobId === record.jobId ? openMergeJobByTicketId.delete(ticketId) : undefined));
      if (record.kind !== 'job-launched' || record.fields.kind !== 'merge') continue;
      for (const ticketId of record.fields.ticketIds) {
        if (openMergeJobByTicketId.has(ticketId)) this.violations.push(`turn ${turn}: ticket ${ticketId} slotted twice with no board change between`);
        openMergeJobByTicketId.set(ticketId, record.jobId);
      }
    }
  }

  /** The world moves a ticket's status the way a verified report would, writing the frontmatter the Board reads. */
  private moveTicketWhenBuilt(ticketId: string, from: TicketFrontmatter['status'], to: TicketFrontmatter['status']): void {
    const ticket = this.tickets.find((candidate) => candidate.frontmatter.id === ticketId);
    if (ticket?.frontmatter.status === from) ticket.frontmatter.status = to;
  }
}

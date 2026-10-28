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
import type { LifecycleStep, DecisionWording }              from '../@types/LifecycleStep.ts';
import type { LogRecord }                                   from '../@types/LogRecord.ts';
import type { Ticket, TicketFrontmatter }                   from '../@types/Ticket.ts';
import type { TrackerProgress }                             from '../@types/TrackerProgress.ts';
import { Board }                                            from '../Board.ts';
import { createLogger }                                     from '../Logger.ts';
import { FIXTURE_AT, FIXTURE_LIMITS, FIXTURE_OBSERVATIONS } from './LifecycleFixtures.ts';

const WORLD_CONCURRENCY_LIMIT = 2;

const INTERRUPTION_CAUSES: readonly InterruptionCause[] = ['host-lost', 'agent-crashed', 'reboot', 'usage-limit'];

const ENDINGS_BY_KIND: Readonly<Record<'build' | 'review' | 'orchestrator', readonly JobOutcome[]>> = {
  build:        ['built', 'built', 'failed'],
  review:       ['reviewed', 'does-not-hold', 'round-granted'],
  orchestrator: ['closed'],
};

/** The states in which a job's host runs its session, so the world keeps a host instance live for it. */
const HOST_RUNNING_STATES: readonly JobState[] = ['running', 'waiting-for-answer'];

/** The states in which a worktree job's session or the runner acts on its worktree with git. */
const GIT_OPERATING_STATES: readonly JobState[] = ['preparing', 'running', 'waiting-for-answer', 'verifying', 'gating', 'merging', 'landing'];

const CRASH_CAUSES: readonly string[] = ['host-lost', 'agent-crashed'];

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
  ];

  private readonly progress: TrackerProgress = {
    trackerId:        'example-world',
    project:          'Example Agency',
    startedAt:        FIXTURE_AT,
    view:             { kind: 'auto' },
    nextTaskId:       1,
    concurrencyLimit: WORLD_CONCURRENCY_LIMIT,
    dispatcherState:  'running',
    checkCommand:     'bun run verify',
    tasks:            [],
  };

  private readonly logRecords: LogRecord[] = [];

  private readonly board: Board;

  private readonly random: () => number;

  private requestCount = 0;

  /** The host instances the world keeps running per job: spawned as a job runs on an instance, killed only by an interruption or an end. */
  private readonly liveHostInstances = new Map<string, Set<number>>();

  /** How far the log was already checked for resumes, so each record is judged once. */
  private checkedRecordCount = 0;

  private readonly endedJobIds = new Set<string>();

  private readonly crashResumesByJobId = new Map<string, number>();

  constructor(seed: number) {
    this.random = randomSourceOf(seed);
    this.board  = new Board({
      progress: this.progress, tickets: this.tickets, epics: [], logger: createLogger((record) => this.logRecords.push(record))
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
    let steps: readonly LifecycleStep[] = [];
    try {
      ({ steps } = this.board.advanceLifecycle(FIXTURE_LIMITS, FIXTURE_OBSERVATIONS, () => WORLD_WORDING));
    } catch (error) {
      this.violations.push(`turn ${turn}: the pass threw ${String(error)}`);
    }
    for (const step of steps) {
      if (step.kind !== 'resume-job') continue;
      const resumed = jobsBefore.find((job) => job.id === step.jobId);
      if (resumed?.state !== 'interrupted' || resumed.kind === 'orchestrator') this.violations.push(`turn ${turn}: resumed ${step.jobId}, which was no interrupted agent job`);
    }
    this.syncHosts(turn);
    this.checkInvariants(turn);
    this.checkResumes(turn);
  }

  /** A job running on an instance the world has not spawned gets that host; a job interrupted, ended or gone has none left. */
  private syncHosts(turn: number): void {
    const liveJobs = new Map(this.board.jobs().map((job) => [job.id, job]));
    for (const [jobId, instances] of this.liveHostInstances) {
      const job = liveJobs.get(jobId);
      if (job === undefined || !HOST_RUNNING_STATES.includes(job.state)) instances.clear();
    }
    for (const job of liveJobs.values()) {
      if (!HOST_RUNNING_STATES.includes(job.state)) continue;
      const instances = this.liveHostInstances.get(job.id) ?? new Set<number>();
      instances.add(job.hostInstance);
      this.liveHostInstances.set(job.id, instances);
      if (instances.size > 1) this.violations.push(`turn ${turn}: job ${job.id} has host instances ${[...instances].join(', ')} live at once`);
    }
  }

  private killHost(jobId: string): void {
    this.liveHostInstances.get(jobId)?.clear();
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
    }
  }

  private pick<Item>(items: readonly Item[]): Item | undefined {
    return items[Math.floor(this.random() * items.length)];
  }

  private act(): void {
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
    if (decision.kind === 'outage') this.board.setDispatcherState('running', null, FIXTURE_AT);
    if (decision.jobId !== null && this.board.jobById(decision.jobId)?.state === 'waiting-for-answer') this.board.moveJob(decision.jobId, 'running', FIXTURE_AT);
    try {
      this.board.answerDecision(decisionId, ['No'], FIXTURE_AT);
      this.violations.push(`decision ${decisionId} took a second answer`);
    } catch {
      // The refusal is the invariant holding.
    }
  }

  private actOn(job: Readonly<Job>): void {
    const roll = this.random();
    if (job.state === 'launching') {
      this.board.moveJob(job.id, 'running', FIXTURE_AT);
      job.ticketIds.forEach((ticketId) => this.moveTicketWhenBuilt(ticketId, 'pending', 'in-progress'));
      return;
    }
    if (job.state !== 'running') return;
    if (roll < 0.15 && job.kind !== 'orchestrator') {
      this.board.moveJob(job.id, 'waiting-for-answer', FIXTURE_AT);
      this.requestCount += 1;
      this.board.openDecision({
        kind: 'agent-question', ticketIds: job.ticketIds, jobId: job.id, askedBy: 'builder', requestId: `R${this.requestCount}`, ...WORLD_WORDING,
      }, FIXTURE_AT);
      return;
    }
    if (roll < 0.35) {
      this.killHost(job.id);
      this.board.interruptJob(job.id, this.pick(INTERRUPTION_CAUSES) ?? 'host-lost', FIXTURE_AT);
      return;
    }
    this.end(job);
  }

  private end(job: Readonly<Job>): void {
    const kind    = job.kind === 'review' || job.kind === 'orchestrator' ? job.kind : 'build';
    const outcome = this.pick(ENDINGS_BY_KIND[kind]) ?? 'failed';
    this.board.endJob(job.id, { outcome }, FIXTURE_AT);
    const ticketId = job.ticketIds[0];
    if (ticketId === undefined) return;
    if (outcome === 'built') this.moveTicketWhenBuilt(ticketId, 'in-progress', 'in-review');
    if (outcome === 'reviewed') this.moveTicketWhenBuilt(ticketId, 'in-review', 'reviewed');
    if (outcome === 'does-not-hold') this.moveTicketWhenBuilt(ticketId, 'in-review', 'in-progress');
  }

  /** The world moves a ticket's status the way a verified report would, writing the frontmatter the Board reads. */
  private moveTicketWhenBuilt(ticketId: string, from: TicketFrontmatter['status'], to: TicketFrontmatter['status']): void {
    const ticket = this.tickets.find((candidate) => candidate.frontmatter.id === ticketId);
    if (ticket?.frontmatter.status === from) ticket.frontmatter.status = to;
  }
}

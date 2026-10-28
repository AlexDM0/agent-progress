/**
 * The merge slot of a target on the board (design section 6.2): which queued tickets are its candidates, the claim that launches the one
 * merge job holding it, and the `merge-started` and `merge-landed` records. Git stays outside: tips and predictions arrive as values.
 */
import type { JobChanged, Logged } from './@types/BoardChanges.ts';
import type { Decision }           from './@types/Decision.ts';
import type { Job, LandingKind }   from './@types/Job.ts';
import type { TicketPriority }     from './@types/Ticket.ts';
import type { BoardRecords }       from './BoardRecords.ts';
import { BoardRefusal }            from './BoardRefusal.ts';
import type { Jobs }               from './Jobs.ts';
import { TicketDefaultsUtil }      from './utils/TicketDefaultsUtil.ts';

export interface MergeCandidate {
  ticketId:  string;
  priority:  TicketPriority;
  /** The log position of the ticket's last `merge-queued` record: its readiness to land. */
  readiness: number;
}

export interface MergeSlotClaim {
  ticketId:               string;
  target:                 string;
  targetTip:              string;
  branchTip:              string;
  predictedConflictFiles: readonly string[];
}

export interface MergeLanding {
  target: string;
  commit: string;
  kind:   LandingKind;
}

/** The decisions naming a queued ticket that keep it out of its slot until User answers. */
const SLOT_HOLDING_DECISION_KINDS: readonly Decision['kind'][] = ['waiver', 'landing-refused'];

const SLOT_HOLDING_JOB_KINDS: readonly Job['kind'][] = ['merge', 'refresh'];

export const MERGE_PRIORITY_RANK: Readonly<Record<TicketPriority, number>> = { high: 0, normal: 1, low: 2 };

export class MergeSlotClaims {
  constructor(private readonly records: BoardRecords, private readonly jobRules: Jobs) {}

  /** The live merge or refresh job holding the target's slot, if any. */
  slotHolderOf(target: string): Readonly<Job> | undefined {
    return this.jobRules.jobs().find((job) => SLOT_HOLDING_JOB_KINDS.includes(job.kind) && job.target === target);
  }

  /** `targetOf` maps a ticket's group to its target, so the tracker model needs no branch names. */
  mergeCandidatesOf(target: string, targetOf: (group: string | undefined) => string): MergeCandidate[] {
    const readinessByTicketId = new Map<string, number>();
    [...this.records.storedLogRecords, ...this.records.loggedRecords].forEach((record, position) => {
      if (record.kind === 'merge-queued') readinessByTicketId.set(record.ticketId, position);
    });
    const decisions = this.records.progress.decisions ?? [];
    return this.records.ticketRecords
      .filter(({ frontmatter }) => frontmatter.status === 'in-review' && frontmatter.hold === undefined && targetOf(frontmatter.group) === target)
      .filter((ticket) => this.records.linkedTaskRecordOf(ticket)?.mergeQueued === true)
      .filter(({ frontmatter }) => !decisions.some((decision) => SLOT_HOLDING_DECISION_KINDS.includes(decision.kind) && decision.ticketIds.includes(frontmatter.id)))
      .filter(({ frontmatter }) => !this.jobRules.jobs().some((job) => job.ticketIds.includes(frontmatter.id)))
      .map(({ frontmatter }) => ({
        ticketId:  frontmatter.id,
        priority:  TicketDefaultsUtil.ticketPriorityOf(frontmatter),
        readiness: readinessByTicketId.get(frontmatter.id) ?? -1,
      }));
  }

  /**
   * Re-derives the queue inside the hold: refused while the slot is held, for a ticket no longer queued, and `higher-priority-queued` when
   * a candidate of a strictly higher rank waits, since the prediction ran outside the lock. Launches the merge job, holding the slot.
   */
  claimMergeSlot(claim: MergeSlotClaim, targetOf: (group: string | undefined) => string, at: string): JobChanged {
    const holder = this.slotHolderOf(claim.target);
    if (holder !== undefined) throw new BoardRefusal({ reason: 'merge-slot-held', target: claim.target, jobId: holder.id });
    const candidates = this.mergeCandidatesOf(claim.target, targetOf);
    const claimed    = candidates.find((candidate) => candidate.ticketId === claim.ticketId);
    if (claimed === undefined) throw new BoardRefusal({ reason: 'merge-candidate-not-queued', ticketId: claim.ticketId, target: claim.target });
    const higher = candidates.filter((candidate) => MERGE_PRIORITY_RANK[candidate.priority] < MERGE_PRIORITY_RANK[claimed.priority]);
    if (higher.length > 0) throw new BoardRefusal({ reason: 'higher-priority-queued', ticketId: claim.ticketId, queuedTicketIds: higher.map((candidate) => candidate.ticketId) });

    const launched = this.jobRules.launchJob({
      kind: 'merge', role: null, ticketIds: [claim.ticketId], parentJobId: null, attempt: this.mergeAttemptsOf(claim.ticketId) + 1, target: claim.target,
    }, at);
    this.jobRules.moveJob(launched.job.id, 'merging', at);
    const job = this.jobRules.setJobSlot(launched.job.id, {
      target: claim.target, targetTip: claim.targetTip, branchTip: claim.branchTip, phase: 'merge-in'
    });
    const started = this.records.logger.log({
      kind:   'merge-started',
      jobId:  job.id,
      fields: {
        target: claim.target, targetTip: claim.targetTip, branchTip: claim.branchTip, predictedConflictFiles: [...claim.predictedConflictFiles]
      },
    }, at);
    return { job, logged: [...launched.logged, started] };
  }

  recordMergeLanded(jobId: string, landing: MergeLanding, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'merge-landed', jobId, fields: { target: landing.target, commit: landing.commit, kind: landing.kind } }, at)] };
  }

  /** Every tip the runner landed on the target, from the stored log and this hold's records. */
  recordedLandingsOn(target: string): string[] {
    return [...this.records.storedLogRecords, ...this.records.loggedRecords]
      .flatMap((record) => (record.kind === 'merge-landed' && record.fields.target === target ? [record.fields.commit] : []));
  }

  private mergeAttemptsOf(ticketId: string): number {
    return [...this.records.storedLogRecords, ...this.records.loggedRecords]
      .filter((record) => record.kind === 'job-launched' && record.fields.kind === 'merge' && record.fields.ticketIds.includes(ticketId)).length;
  }
}

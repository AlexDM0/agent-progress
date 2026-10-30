/**
 * A ticket's failed passes as a log reading: its jobs ended `failed` or `does-not-hold` since it was last started from `pending` or unheld.
 * Clock-free and restart-proof; an interruption, a resume, `replaced`, `stopped` or a usage limit is never a failed pass, and neither is a
 * review that does not hold while the ticket's newest build was `built`: that review resumes the builder, counted against its cycle's resumes.
 */
import type { JobKind, JobOutcome }      from '../@types/Job.ts';
import type { LogRecord, LogRecordKind } from '../@types/LogRecord.ts';

const FAILED_PASS_OUTCOMES: readonly JobOutcome[] = ['failed', 'does-not-hold'];

/** The records that move a ticket's status, which say whether a later start comes from review. */
const STATUS_MOVE_KINDS: readonly LogRecordKind[] = [
  'ticket-filed',
  'ticket-readied',
  'ticket-reopened',
  'ticket-started',
  'ticket-finished',
  'ticket-approved',
  'ticket-delivered',
  'ticket-abandoned',
];

function outcomeIsAFailedPass(outcome: JobOutcome): boolean {
  return FAILED_PASS_OUTCOMES.includes(outcome);
}

/** A start from `in-review` is rework, which keeps the count; a start from anywhere else begins it again. */
function failedPassesOf(ticketId: string, logRecords: readonly LogRecord[]): number {
  const jobKindsOfTheTicket = new Map<string, JobKind>();
  let ticketIsInReview      = false;
  let newestBuildWasBuilt   = false;
  let failedPasses          = 0;
  for (const record of logRecords) {
    if (record.kind === 'tracker-cleared') failedPasses = 0;
    if (record.kind === 'job-launched' && record.fields.ticketIds.includes(ticketId)) jobKindsOfTheTicket.set(record.jobId, record.fields.kind);
    const endedJobKind = record.kind === 'job-ended' ? jobKindsOfTheTicket.get(record.jobId) : undefined;
    if (record.kind === 'job-ended' && endedJobKind !== undefined) {
      const reviewResumesTheBuilder = endedJobKind === 'review' && record.fields.outcome === 'does-not-hold' && newestBuildWasBuilt;
      if (outcomeIsAFailedPass(record.fields.outcome) && !reviewResumesTheBuilder) failedPasses += 1;
      if (endedJobKind === 'build') newestBuildWasBuilt = record.fields.outcome === 'built';
    }
    if (!('ticketId' in record) || record.ticketId !== ticketId) continue;
    if (record.kind === 'ticket-unheld') failedPasses = 0;
    if (record.kind === 'ticket-unheld') newestBuildWasBuilt = false;
    if (record.kind === 'ticket-started' && !ticketIsInReview) failedPasses = 0;
    if (STATUS_MOVE_KINDS.includes(record.kind)) ticketIsInReview = record.kind === 'ticket-finished';
  }
  return failedPasses;
}

export const FailedPassUtil = {
  outcomeIsAFailedPass,
  failedPassesOf,
} as const;

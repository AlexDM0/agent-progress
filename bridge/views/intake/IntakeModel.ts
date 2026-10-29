/**
 * The Intake view as data: every product-owner session, live ones from the board and closed ones read back from the log, each with the
 * tickets it filed and its open questions. A closed session keeps its transcript and chat: a message resumes it by id.
 */
import type {
  ConversationBoardDocument,
  DecisionDocument,
  HistoryRecordDocument,
  TicketDocument
} from '../../@types/ConversationDocuments.ts';

export interface IntakeSession {
  readonly jobId:       string;
  /** The job's state while it is on the board; `closed` once intake closed and the job left it. */
  readonly state:       string;
  readonly closed:      boolean;
  readonly requestText: string | null;
  readonly drafts:      readonly TicketDocument[];
  readonly questions:   readonly DecisionDocument[];
}

const PRODUCT_OWNER_KIND = 'product-owner';
const CLOSED_OUTCOME = 'closed';

function closedSessionIdsOf(history: readonly HistoryRecordDocument[], liveJobIds: ReadonlySet<string>): string[] {
  const launchedProductOwner = (record: HistoryRecordDocument): boolean => record.kind === 'job-launched' && record.fields['kind'] === PRODUCT_OWNER_KIND;
  const productOwnerIds = history.flatMap((record) => (launchedProductOwner(record) && record.jobId !== undefined ? [record.jobId] : []));
  return productOwnerIds.filter((jobId) => {
    if (liveJobIds.has(jobId)) return false;
    const ended = history.findLast((record) => record.kind === 'job-ended' && record.jobId === jobId);
    return ended?.fields['outcome'] === CLOSED_OUTCOME;
  });
}

function intakeSessionsOf(board: ConversationBoardDocument): IntakeSession[] {
  const tickets = board.page?.tickets ?? [];
  const sessionOf = (jobId: string, state: string, requestText: string | null): IntakeSession => ({
    jobId,
    state,
    closed:    state === CLOSED_OUTCOME,
    requestText,
    drafts:    tickets.filter((ticket) => ticket.filedByJob === jobId),
    questions: board.decisions.filter((decision) => decision.jobId === jobId),
  });
  const liveJobs = board.jobs.filter((job) => job.kind === PRODUCT_OWNER_KIND);
  const liveJobIds = new Set(liveJobs.map((job) => job.id));
  return [
    ...liveJobs.map((job) => sessionOf(job.id, job.state, job.intake?.text ?? null)),
    ...closedSessionIdsOf(board.questionHistory ?? [], liveJobIds).reverse().map((jobId) => sessionOf(jobId, CLOSED_OUTCOME, null)),
  ];
}

export const IntakeModelUtil = Object.freeze({ intakeSessionsOf, closedSessionIdsOf });

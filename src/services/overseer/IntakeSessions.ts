/**
 * The Overseer's side of a product-owner intake (design section 8.4): the session's confinement (skills on, the web through WebFetch and
 * WebSearch only, Bash with no domain), what its first message is filled from, and the end of a closed intake, which opens `ready-drafts`.
 */
import { TicketAcceptanceUtil }                from '../../adapters/tickets/utils/TicketAcceptanceUtil.ts';
import type { WorkerProfile }                  from '../../lib/agent-launch/WorkerProfile.ts';
import type { Job }                            from '../../lib/tracker-model/@types/Job.ts';
import type { DecisionDraft, DecisionWording } from '../../lib/tracker-model/@types/PlaybookStep.ts';
import type { Board }                          from '../../lib/tracker-model/Board.ts';
import type { WatcherLiveness }                from './WatcherFleet.ts';

export const PRODUCT_OWNER_KIND = 'product-owner';

/** What a product owner's first message is filled from; a fresh session after a replaced one also gets its drafts and answers. */
export interface IntakeFacts {
  text:           string;
  drafts:         readonly { id: string; title: string }[];
  carriedAnswers: readonly Readonly<Record<string, string>>[];
}

function isIntakeJob(job: Readonly<Job>): boolean {
  return job.kind === PRODUCT_OWNER_KIND;
}

/** Writes only its session folder and its Hatch folder; the slash command loads the product-owner skill, so skills stay on. */
function productOwnerProfileOf(sessionProfile: WorkerProfile): WorkerProfile {
  return {
    ...sessionProfile, bashNetworkDomains: [], webNetworkDomains: 'any', askUser: true, skills: true, networkDomainGuard: null
  };
}

function intakeFactsOf(board: Board, job: Readonly<Job>): IntakeFacts | null {
  if (!isIntakeJob(job)) return null;
  const freshAfterReplacement = job.parentJobId !== null;
  return {
    text:           job.intake?.text ?? '',
    drafts:         freshAfterReplacement ? board.draftsFiledByIntakeOf(job.id).map((ticket) => ({ id: ticket.frontmatter.id, title: ticket.frontmatter.title })) : [],
    carriedAnswers: job.intake?.carriedAnswers ?? [],
  };
}

/**
 * A product owner whose input was closed, by `intake close` or `job stop`, ends `closed` once no Watcher of it is live, a Watcher that never
 * started included; the `ready-drafts` decision opens in the same hold.
 */
function endClosedIntakes(
  board: Board,
  livenessOf: (job: Readonly<Job>) => WatcherLiveness,
  decisionWordingOf: (draft: DecisionDraft) => DecisionWording,
  at: string,
): void {
  for (const job of board.jobs().filter((candidate) => isIntakeJob(candidate) && candidate.state === 'stopping')) {
    if (livenessOf(job).verdict === 'live') continue;
    board.endIntakeJob(job.id, TicketAcceptanceUtil.readinessGapsOf, decisionWordingOf, at);
  }
}

export const IntakeSessions = Object.freeze({
  isIntakeJob, productOwnerProfileOf, intakeFactsOf, endClosedIntakes
});

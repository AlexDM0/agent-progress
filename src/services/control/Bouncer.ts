/**
 * Which relayed control commands each job role may run, as a pure table over the job record and the command (design section 4.4). The
 * role and the job id come from the Hatch folder's job record, never from the request; an admitted filing comes back stamped with both.
 */
import type { Incident }                                 from '../../lib/tracker-model/@types/Incident.ts';
import type { JobRole }                                  from '../../lib/tracker-model/@types/Job.ts';
import type { TicketStatus }                             from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketIdUtil }                                  from '../../lib/tracker-model/utils/TicketIdUtil.ts';
import type { ControlCommand, ControlCommandOf }         from '../../shared/@types/ControlCommand.ts';
import type { RoleCommandRefusalReason }                 from '../../shared/@types/RoleCommandRefusalReason.ts';
import { WORKER_FILINGS_PER_JOB }                        from '../../shared/constants/OverseerLimits.ts';
import { ALLOWED_MOVES_BY_INCIDENT_KIND, FINDING_MOVES } from './constants/AllowedMovesByIncidentKind.ts';

/** The job record as the policy reads it: its role, what it filed so far (by `filedByJob`) and, for an Assistant, what it was delivered. */
export interface RelayingJob {
  id:                 string;
  role:               JobRole | null;
  filedTickets:       ReadonlyArray<{ id: string; status: TicketStatus }>;
  deliveredIncidents: ReadonlyArray<Pick<Incident, 'id' | 'kind' | 'ticketIds' | 'jobId'>>;
}

/** Whether the incident's kind allows the move, and a finding move names only tickets it lists; a `job fresh` needs a waiting job. */
function incidentMoveVerdictOf(incident: Pick<Incident, 'kind' | 'ticketIds' | 'jobId'>, command: ControlCommand): RoleCommandRefusalReason | null {
  const move = ALLOWED_MOVES_BY_INCIDENT_KIND[incident.kind].find((allowed) => allowed === command.kind);
  if (move === undefined || (move === 'job-fresh' && incident.jobId === null)) return 'incident-move-not-allowed';
  if (!FINDING_MOVES.includes(move)) return null;
  const everyTicketIsListed = referencedTicketTextsOf(command).every((reference) => {
    const ticketId = typeof reference === 'string' ? TicketIdUtil.parseTicketReference(reference) : null;
    return ticketId !== null && incident.ticketIds.includes(ticketId);
  });
  return everyTicketIsListed ? null : 'finding-not-listed';
}

export type BouncerVerdict =
  | { verdict: 'admitted'; command: ControlCommand }
  | { verdict: 'refused'; reason: RoleCommandRefusalReason };

const WORKER_ROLES: ReadonlySet<JobRole> = new Set(['builder', 'reviewer', 'merge-fix']);

/** Kinds the product owner may run on any ticket; its `intake-close` closes its own job, stamped from the Hatch folder. */
const PRODUCT_OWNER_KINDS: ReadonlySet<string> = new Set([
  'ticket-depends',
  'epic-add',
  'draft-open',
  'draft-claim',
  'draft-release',
  'draft-note',
  'draft-ask',
  'draft-answer',
  'draft-drop',
  'draft-close',
  'draft-abandon',
  'intake-close',
]);

const PRODUCT_OWNER_OWN_DRAFT_KINDS: ReadonlySet<string> = new Set(['ticket-edit', 'ticket-priority', 'ticket-network', 'ticket-epic', 'ticket-abandon']);

const FIELDS_ONLY_THE_OVERSEER_DECIDES = ['jobId', 'role', 'admission'] as const;

/** Their `jobId` is the job the move acts on, not the sender's identity. */
const JOB_TARGETING_KINDS: ReadonlySet<string> = new Set(['job-fresh', 'job-message', 'gate-retry', 'merge-fixer', 'merge-abort', 'merge-review', 'merge-land']);

function refused(reason: RoleCommandRefusalReason): BouncerVerdict {
  return { verdict: 'refused', reason };
}

function fieldOf(command: ControlCommand, field: string): unknown {
  return Object.hasOwn(command, field) ? (command as unknown as Record<string, unknown>)[field] : undefined;
}

/** A worker's one filing is a low finding: only `--priority low`, `--needs-user`, `--type`, `--size`, the body and the two ticket links. */
function workerFilingIsShaped(command: ControlCommandOf<'ticket-add'>): boolean {
  return command.priority === 'low'
    && command.model === undefined
    && command.effort === undefined
    && command.group === undefined
    && command.dependsOn.length === 0
    && command.epics.length === 0
    && command.network.length === 0;
}

function workerVerdictOf(job: RelayingJob, command: ControlCommand): BouncerVerdict {
  if (command.kind !== 'ticket-add') return refused('command-not-allowed-for-role');
  if (!workerFilingIsShaped(command)) return refused('worker-filing-flag');
  if (job.filedTickets.length >= WORKER_FILINGS_PER_JOB) return refused('worker-filing-limit');
  const findingRoute = command.needsUser === true ? 'user' : 'assistant';
  return { verdict: 'admitted', command: { ...command, admission: { filedByJob: job.id, findingRoute } } };
}

function productOwnerVerdictOf(job: RelayingJob, command: ControlCommand): BouncerVerdict {
  if (command.kind === 'ticket-add') {
    if (command.needsUser === true) return refused('worker-filing-flag');
    return { verdict: 'admitted', command: { ...command, admission: { filedByJob: job.id } } };
  }
  if (command.kind === 'intake-close') return { verdict: 'admitted', command: { ...command, jobId: job.id } };
  if (PRODUCT_OWNER_KINDS.has(command.kind)) return { verdict: 'admitted', command };
  if (!PRODUCT_OWNER_OWN_DRAFT_KINDS.has(command.kind)) return refused('command-not-allowed-for-role');
  const ticketReference = fieldOf(command, 'ticketReference');
  const ticketId        = typeof ticketReference === 'string' ? TicketIdUtil.parseTicketReference(ticketReference) : null;
  const ownDraft        = job.filedTickets.some((filed) => filed.id === ticketId && filed.status === 'draft');
  return ownDraft ? { verdict: 'admitted', command } : refused('not-own-draft');
}

function referencedTicketTextsOf(command: ControlCommand): unknown[] {
  const references = fieldOf(command, 'ticketReferences');
  if (Array.isArray(references)) return references;
  return [fieldOf(command, 'ticketReference')];
}

function assistantVerdictOf(job: RelayingJob, command: ControlCommand): BouncerVerdict {
  const incidentId = fieldOf(command, 'incidentId');
  const incident   = job.deliveredIncidents.find((delivered) => delivered.id === incidentId);
  if (incident === undefined) return refused('incident-move-not-allowed');
  const reason = incidentMoveVerdictOf(incident, command);
  return reason === null ? { verdict: 'admitted', command } : refused(reason);
}

/** Resolver and resolution-review Hatch nothing; a job with no role runs no agent, so it relays nothing either. */
function verdictOf(job: RelayingJob, command: ControlCommand): BouncerVerdict {
  const forgedField = FIELDS_ONLY_THE_OVERSEER_DECIDES.some((field) => Object.hasOwn(command, field) && !(field === 'jobId' && JOB_TARGETING_KINDS.has(command.kind)));
  if (forgedField) return refused('hatch-identity-mismatch');
  if (job.role === null) return refused('command-not-allowed-for-role');
  if (WORKER_ROLES.has(job.role)) return workerVerdictOf(job, command);
  if (job.role === 'product-owner') return productOwnerVerdictOf(job, command);
  if (job.role === 'assistant') return assistantVerdictOf(job, command);
  return refused('command-not-allowed-for-role');
}

export const Bouncer = Object.freeze({ verdictOf, incidentMoveVerdictOf });

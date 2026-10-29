/** What the board's slots leave a dispatcher run, whole-board or group: which own agents a status block shows, and how many agents the run may hold. */
import { CONCURRENCY_LIMIT_CEILING_AGENTS } from '../../../src/lib/tracker-model/constants/ConcurrencyLimits.ts';
import type { StatusReading }               from '../../@types/AgentReadings.ts';
import type { DispatchWork }                from '../../@types/DispatchWork.ts';

// A status block without the rows confirms nothing, except a bar handed on (a builder's `in-review` or a reviewer's call for another round),
// which only a block listing the rows can contradict.
function ownAgentIsConfirmedByStatus(work: DispatchWork, status: StatusReading): boolean {
  if (work.kind === 'park') return false; // Never on the board: the row it pauses counts as another's until it returns, the safe side.
  const confirmingTicketIds = work.kind === 'build' ? status.inProgressTicketIds : status.inProgressReviewOfIds;
  if (confirmingTicketIds === 'unlisted') return work.kind === 'review' && work.barIsHandedOn === true;
  return confirmingTicketIds.includes(work.ticketId);
}

// Only an own agent whose row the board shows is subtracted: one that has not run its first command yet is not in `agentsInFlight`, and
// subtracting it too would read a real other agent's slot as free.
function othersInFlightOf(status: StatusReading, ownWork: readonly DispatchWork[]): number {
  return Math.max(0, status.agentsInFlight - ownWork.filter((work) => ownAgentIsConfirmedByStatus(work, status)).length);
}

// Every own agent counts against the slots, on the board yet or not; the ceiling holds whatever limit the board states.
function ownSlotLimitOf(statedLimit: number, othersInFlight: number): number {
  return Math.max(0, Math.min(statedLimit, CONCURRENCY_LIMIT_CEILING_AGENTS) - othersInFlight);
}

export const SlotCountUtil = {
  ownAgentIsConfirmedByStatus,
  othersInFlightOf,
  ownSlotLimitOf,
} as const;

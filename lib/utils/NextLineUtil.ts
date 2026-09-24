import type { DispatcherState } from '../constants/Types';

const READY_TICKETS_LISTED_AT_MOST = 5;

interface BoardCapacity {
  limit:                     number;
  agentsInFlight:            number;
  freeSlots:                 number;
  readyTicketIds:            readonly string[];
  lowPriorityReadyTicketIds: readonly string[];
  dispatcherState:           DispatcherState;
}

/**
 * A running dispatcher needs no advice, and one that finished by itself needs relaunching only when a normal or high ticket is there for it to
 * take: low tickets alone are the orchestrator's to triage before any run is launched for them.
 */
function dispatcherAdviceOf(capacity: BoardCapacity): string {
  if (capacity.dispatcherState === 'stopped') return '; dispatcher stopped: wait for the user\'s go';
  if (capacity.dispatcherState !== 'finished' || capacity.readyTicketIds.length === 0) return '';
  const normalOrHighTicketIsReady = capacity.readyTicketIds.some((ticketId) => !capacity.lowPriorityReadyTicketIds.includes(ticketId));
  return normalOrHighTicketIsReady ? '; launch the dispatcher' : '; only low priority ready: triage, then launch';
}

function slotsTextOf(capacity: BoardCapacity): string {
  if (capacity.freeSlots === 0) return `no slot free (${capacity.agentsInFlight} ${capacity.agentsInFlight === 1 ? 'agent' : 'agents'} in flight)`;
  return `${capacity.freeSlots} of ${capacity.limit} slots free`;
}

/** The ids are printed as given, in the dispatch order `readyTicketIdsOf` already sorts them into; only the first five are named. */
function readyTextOf(readyTicketIds: readonly string[]): string {
  if (readyTicketIds.length === 0) return 'nothing ready';

  const named    = readyTicketIds.slice(0, READY_TICKETS_LISTED_AT_MOST).map((identifier) => `#${identifier}`).join(', ');
  const leftOver = readyTicketIds.length - READY_TICKETS_LISTED_AT_MOST;
  return leftOver > 0 ? `ready: ${named} and ${leftOver} more` : `ready: ${named}`;
}

/** The last line a human-facing command prints, so an orchestrator is told after every move whether a slot and a ticket are both waiting. */
function composeNextLine(capacity: BoardCapacity): string {
  return `Next: ${slotsTextOf(capacity)}; ${readyTextOf(capacity.readyTicketIds)}${dispatcherAdviceOf(capacity)}`;
}

const RUNNING_DISPATCHER_NOTICE = 'Dispatcher running: it picks this change up at its next agent\'s return. Never stop or relaunch it for this.';

/** For the moves that change what a dispatcher picks up: an orchestrator that stopped a run to add work lost the agents in flight. */
function endWithRunningDispatcherNotice(humanText: string, dispatcherState: DispatcherState): string {
  return dispatcherState === 'running' ? `${humanText}\n${RUNNING_DISPATCHER_NOTICE}` : humanText;
}

export const NextLineUtil = { composeNextLine, endWithRunningDispatcherNotice } as const;

import type { DispatchSummary } from '../../@types/DispatchOutcome.ts';
import type {
  AgentKind,
  DispatchRunName,
  RecordedAgentCall,
  RecordedDispatchRun
} from '../@types/RecordedDispatchRun.ts';

/** Each stated field narrows the calls to those that match it; an empty filter matches every call. */
export interface RecordedCallFilter {
  run?:      DispatchRunName;
  kind?:     AgentKind;
  ticketId?: string;
}

/** A run's returned summary, read as the shipped shape; `null` when that run returned none. */
function summaryFrom(returnedSummary: unknown): DispatchSummary | null {
  return returnedSummary as DispatchSummary | null;
}

/** The main run's summary, dereferenced as returned, so a claim read on a run that returned none fails loudly. */
function mainSummaryOf(run: RecordedDispatchRun): DispatchSummary {
  return summaryFrom(run.summary) as DispatchSummary;
}

function callsOf(run: RecordedDispatchRun, filter: RecordedCallFilter): RecordedAgentCall[] {
  return run.calls.filter((call) => (filter.run === undefined || call.run === filter.run)
    && (filter.kind === undefined || call.kind === filter.kind)
    && (filter.ticketId === undefined || call.ticketId === filter.ticketId));
}

function reviewCountOf(run: RecordedDispatchRun, ticketId?: string): number {
  return callsOf(run, ticketId === undefined ? { kind: 'review' } : { kind: 'review', ticketId }).length;
}

/** Whether there was a builder or reviewer, on `ticketId` when one is given, and every one of them ran on this model and effort. */
function workersRunOn(run: RecordedDispatchRun, model: string, effort: string, ticketId?: string): boolean {
  const workers = run.calls.filter((call) => (call.kind === 'build' || call.kind === 'review') && (ticketId === undefined || call.ticketId === ticketId));
  return workers.length > 0 && workers.every((call) => call.model === model && call.effort === effort);
}

/** A call as its kind, followed by its ticket id when it has one: `survey`, `build 001`. */
function kindAndTicketOf(call: RecordedAgentCall): string {
  return call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`;
}

/** Each call of the run, or of the named one of its runs, as its kind and ticket. */
function kindsAndTicketsOf(run: RecordedDispatchRun, runName?: DispatchRunName): string[] {
  return callsOf(run, runName === undefined ? {} : { run: runName }).map(kindAndTicketOf);
}

export const RecordedDispatchRunUtil = {
  summaryFrom,
  mainSummaryOf,
  callsOf,
  reviewCountOf,
  workersRunOn,
  kindAndTicketOf,
  kindsAndTicketsOf,
} as const;

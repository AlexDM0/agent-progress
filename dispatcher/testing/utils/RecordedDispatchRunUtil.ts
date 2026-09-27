import type { DispatchSummary }     from '../../@types/DispatchOutcome.ts';
import type { RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';

/** A run's returned summary, read as the shipped shape; `null` when that run returned none. */
function summaryFrom(returnedSummary: unknown): DispatchSummary | null {
  return returnedSummary as DispatchSummary | null;
}

/** The main run's summary, dereferenced as returned, so a claim read on a run that returned none fails loudly. */
function mainSummaryOf(run: RecordedDispatchRun): DispatchSummary {
  return summaryFrom(run.summary) as DispatchSummary;
}

/** Each call of the run as its kind, followed by its ticket id when it has one: `survey`, `build 001`. */
function kindsAndTicketsOf(run: RecordedDispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
}

export const RecordedDispatchRunUtil = { summaryFrom, mainSummaryOf, kindsAndTicketsOf } as const;

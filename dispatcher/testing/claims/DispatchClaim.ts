import type { DispatchSummary }                       from '../../@types/DispatchOutcome.ts';
import type { DispatchScenario, RecordedDispatchRun } from '../DispatchScriptHarness.ts';
import type { SourceMutant }                          from '../SourceMutant.ts';

export interface DispatchClaim {
  name:        string;
  scenarioFor: () => DispatchScenario;
  holds:       (run: RecordedDispatchRun) => boolean;
  mutant:      SourceMutant;
}

/** The modules a claim's mutant may rewrite, each the one that holds the decisions it names. */
export const DISPATCHER_MODULE_PATHS = {
  DISPATCH_RUN:               'dispatcher/run/DispatchRun.ts',
  DISPATCHER:                 'dispatcher/Dispatcher.ts',
  AGENT_STARTER:              'dispatcher/run/AgentStarter.ts',
  WORKFLOW_INPUT_UTIL:        'dispatcher/utils/WorkflowInputUtil.ts',
  ROUND_VERDICT_UTIL:         'dispatcher/utils/RoundVerdictUtil.ts',
  AGENT_PROMPT_UTIL:          'dispatcher/utils/AgentPromptUtil.ts',
  DISPATCH_WORDING_UTIL:      'dispatcher/utils/DispatchWordingUtil.ts',
  DISPATCHER_CLAIM_NOTE_UTIL: 'src/shared/utils/DispatcherClaimNoteUtil.ts',
} as const;

/** A run's returned summary, read as the shipped shape; `null` when that run returned none. */
export function dispatchSummaryFrom(returnedSummary: unknown): DispatchSummary | null {
  return returnedSummary as DispatchSummary | null;
}

/** The main run's summary, dereferenced as returned, so a claim read on a run that returned none fails loudly. */
export function runSummaryOf(run: RecordedDispatchRun): DispatchSummary {
  return dispatchSummaryFrom(run.summary) as DispatchSummary;
}

/** Each call of the run as its kind, followed by its ticket id when it has one: `survey`, `build 001`. */
export function kindsAndTickets(run: RecordedDispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
}

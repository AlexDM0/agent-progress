/**
 * The dispatcher's driver: it reads the Workflow arguments, surveys the board, runs the build and park loops within the board's slots, and
 * returns the run's summary.
 */
import type { DispatchSummary }         from './@types/DispatchOutcome.ts';
import type { WorkflowRuntime }         from './@types/WorkflowRuntime.ts';
import { createAgentStarter }           from './run/AgentStarter.ts';
import { DispatchRun }                  from './run/DispatchRun.ts';
import { createWorkflowDispatchLogger } from './run/WorkflowDispatchLogger.ts';
import { DispatchWordingUtil }          from './utils/DispatchWordingUtil.ts';
import { WorkflowInputUtil }            from './utils/WorkflowInputUtil.ts';

// Its own async function, awaited from both loops: inlining it would drop a microtask hop that the frozen trace table pins.
async function settleNextFinished(run: DispatchRun): Promise<void> {
  const finished = await Promise.race(run.finishingOfAgentsInFlight());
  run.settleFinished(finished);
}

// Microtask order is behaviour: nothing is awaited before the first agent call, only `runAgent` and `settleNextFinished` are async, a reply is
// mapped in the `.then` that builds its finished record, and no timer runs.
export async function runDispatcher(runtime: WorkflowRuntime): Promise<DispatchSummary> {
  const verdict = WorkflowInputUtil.settingsVerdictOf(runtime.args);
  if (verdict.verdict === 'invalid') throw new Error(DispatchWordingUtil.settingsRefusalText(verdict));
  const { settings } = verdict;
  const logger = createWorkflowDispatchLogger(runtime.log);
  const starter = createAgentStarter(runtime, settings, logger);
  const run = new DispatchRun(settings, { logger, startAgent: starter.startAgent });

  const ticketIdsWithoutStatedSettings = run.ticketIdsWithoutStatedSettings();
  if (ticketIdsWithoutStatedSettings.length > 0) {
    runtime.phase('Survey');
    run.recordSurveyAgentStarted();
    const lookup = await starter.runSurveyAgent({ kind: 'ticket-settings', ticketIds: ticketIdsWithoutStatedSettings });
    run.adoptLookedUpTicketSettings(WorkflowInputUtil.ticketSettingsLookupOf(lookup), ticketIdsWithoutStatedSettings);
  }

  if (settings.ticketIds === null) {
    runtime.phase('Survey');
    run.recordSurveyAgentStarted();
    const survey = await starter.runSurveyAgent({ kind: 'survey' });
    if (run.adoptSurvey(WorkflowInputUtil.surveyReadingOf(survey)) === 'nothing-dispatched') return DispatchWordingUtil.summaryOf(run.outcome());
  }

  runtime.phase('Build');
  for (;;) {
    run.startWorkWithinSlots();
    if (run.finishingOfAgentsInFlight().length === 0) break;
    await settleNextFinished(run);
  }

  run.carryOutParksAwaitingTheNextAgent();
  run.setAsideRowsToRelease();
  if (run.parkPhaseHasWork()) {
    runtime.phase('Park');
    for (;;) {
      run.releaseRowsWithinSlots();
      if (run.finishingOfAgentsInFlight().length === 0) break;
      await settleNextFinished(run);
    }
    run.noteRowsLeftRunning();
  }

  run.closeTheRun();
  return DispatchWordingUtil.summaryOf(run.outcome());
}

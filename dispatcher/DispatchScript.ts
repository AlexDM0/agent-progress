/** The Workflow script's entry, and the only module that names the Workflow globals; the bundle calls it once, as the script's last statement. */
import type { DispatchSummary } from './@types/DispatchOutcome.ts';
import { runDispatcher }        from './Dispatcher.ts';

export async function dispatchFromWorkflowGlobals(): Promise<DispatchSummary> {
  return runDispatcher({
    agent,
    phase,
    log,
    args,
  });
}

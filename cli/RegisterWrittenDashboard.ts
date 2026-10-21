/**
 * After a call wrote a tracker's `progress.html`, records the tracker in the machine-wide monitor registry. A registry that cannot take the
 * entry warns on standard error and never changes the command's exit code.
 */
import type { DashboardRenderOutcome } from '../src/services/tracker/DashboardRendering.ts';
import { registerWithTheMonitor }      from '../src/services/tracker/MonitorRegistration.ts';
import type { Workspace }              from '../src/services/tracker/Workspace.ts';
import type { CommandContext }         from './CommandContext.ts';

/** An unreadable tracker writes no page, so it registers nothing. */
export async function registerWrittenDashboard(context: CommandContext, workspace: Workspace, renderOutcome: DashboardRenderOutcome): Promise<void> {
  if (renderOutcome.verdict === 'unreadable') return;
  const outcome = await registerWithTheMonitor({
    workspace,
    homeDirectory:        context.homeDirectory,
    temporaryDirectories: context.temporaryDirectories,
    command:              context.commandVerb,
    now:                  context.now,
  });
  if (outcome.verdict === 'registered-over-malformed') {
    context.standardError(
      `The monitor registry ${outcome.registryFilePath} was malformed (${outcome.problems.join('; ')}); it was rewritten keeping every readable entry.`,
    );
  } else if (outcome.verdict === 'not-registered-newer-version') {
    context.standardError(
      `The monitor registry ${outcome.registryFilePath} is version ${outcome.version}, newer than this agent-progress writes; it was left untouched.`,
    );
  } else if (outcome.verdict === 'not-registered-unwritable') {
    context.standardError(`The monitor registry ${outcome.registryFilePath} could not be updated: ${outcome.reason}`);
  }
}

/**
 * After a call wrote a tracker, records it in the machine-wide monitor registry. A registry that cannot take the entry warns on standard
 * error and never changes the command's exit code.
 */
import { registerWithTheMonitor } from '../src/services/tracker/MonitorRegistration.ts';
import type { Workspace }         from '../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }          from '../src/shared/constants/ProductNames.ts';
import type { CommandContext }    from './CommandContext.ts';

export async function registerWrittenTracker(context: CommandContext, workspace: Workspace): Promise<void> {
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
      `The monitor registry ${outcome.registryFilePath} is version ${outcome.version}, newer than this ${PRODUCT_NAMES.PROGRAM} writes; it was left untouched.`,
    );
  } else if (outcome.verdict === 'not-registered-unwritable') {
    context.standardError(`The monitor registry ${outcome.registryFilePath} could not be updated: ${outcome.reason}`);
  }
}

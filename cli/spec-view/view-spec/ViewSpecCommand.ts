/**
 * Writes the spec view of the spec-kit project at or above the current directory: `progress-spec.json` and `progress-spec.html` in its
 * `.agent-progress/`. It needs no tracker, takes no lock and reads or writes no tracker file.
 */
import { findSpecKitRoot }           from '../../../src/adapters/spec-kit/SpecKitRoot.ts';
import { renderSpecPage }            from '../../../src/services/render/SpecPageRendering.ts';
import { workspacePathsFor }         from '../../../src/services/tracker/Workspace.ts';
import { agentProgressRootOverride } from '../../../src/shared/Environment.ts';
import { OperationRefusal }          from '../../../src/shared/OperationRefusal.ts';
import type { CommandHandler }       from '../../CommandHandler.ts';
import { openInTheDefaultBrowser }   from '../../OpenInTheDefaultBrowser.ts';

const USAGE = 'agent-progress view-spec [--open]';

const OPEN_OPTION_NAME = 'open';

const KNOWN_OPTION_NAMES: readonly string[] = [OPEN_OPTION_NAME];

export const viewSpecCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const opensThePage = commandArguments.flag(OPEN_OPTION_NAME);

  const overrideRoot = agentProgressRootOverride();
  const specKitRoot  = findSpecKitRoot(context.currentDirectory, overrideRoot);
  if (specKitRoot.verdict === 'not-found') {
    throw new OperationRefusal('refused', {
      kind:                      'no-spec-kit-found',
      searchedFrom:              specKitRoot.searchedDirectory,
      searchedFromIsTheOverride: overrideRoot !== undefined,
    });
  }

  const outcome = await renderSpecPage({
    specKitRootDirectory: specKitRoot.rootDirectory,
    trackerDirectory:     workspacePathsFor(specKitRoot.rootDirectory).trackerDirectory,
    generatedAt:          context.now(),
  }, context.renderState);
  if (outcome.verdict === 'unreadable-snapshot') {
    const problem = outcome.reading.verdict === 'absent' ? 'it is missing after being written' : outcome.reading.reason;
    throw new OperationRefusal('unrepaired', `The spec view could not be regenerated: ${outcome.snapshotFilePath} could not be read back (${problem}).`);
  }
  if (outcome.pageScriptFailure !== null) {
    context.standardError(`The spec view was written without its page script, so the page shows no snapshot: ${outcome.pageScriptFailure}`);
  }

  if (opensThePage) openInTheDefaultBrowser(context, outcome.pageFilePath);
  context.standardOutput(outcome.pageFilePath);
};

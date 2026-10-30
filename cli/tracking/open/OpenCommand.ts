import { Baton }                   from '../../../src/services/overseer/Baton.ts';
import { overseerFilesIn }         from '../../../src/services/overseer/OverseerFiles.ts';
import { requireWorkspace }        from '../../../src/services/tracker/Workspace.ts';
import { OperationRefusal }        from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }           from '../../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }     from '../../CommandHandler.ts';
import { openInTheDefaultBrowser } from '../../OpenInTheDefaultBrowser.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} open`;

const KNOWN_OPTION_NAMES: readonly string[] = [];

/** The live Overseer's URL while a Baton names a live process; with none, there is no page to open. */
export const openCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace       = requireWorkspace(context.currentDirectory);
  const { overseerDirectory } = overseerFilesIn(workspace.trackerDirectory);
  const newest          = Baton.newestBatonOf(overseerDirectory);
  if (newest.verdict !== 'live') throw new OperationRefusal('refused', { kind: 'overseer-down', overseerDirectory });

  openInTheDefaultBrowser(context, newest.record.url);
  context.standardOutput(newest.record.url);
  return Promise.resolve();
};

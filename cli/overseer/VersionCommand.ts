import { CodeVersion }         from '../../src/services/overseer/CodeVersion.ts';
import { PRODUCT_NAMES }       from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler } from '../CommandHandler.ts';
import { INSTALL_VERSION }     from '../constants/InstallVersion.ts';
import { OutputUtil }          from '../utils/OutputUtil.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} version [--json]`;

/** Read-only and needing no tracker: the live Overseer runs the binary on disk with `--json` to learn whether new code landed. */
export const versionCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json'], USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const versions = { codeVersion: CodeVersion.onDisk(), installVersion: INSTALL_VERSION };
  OutputUtil.printEntity(commandArguments, context, versions, `code ${versions.codeVersion}, install version ${versions.installVersion}`);
  return Promise.resolve();
};

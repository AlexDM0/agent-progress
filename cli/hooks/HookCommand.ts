/**
 * The `hook` verb. `bash-domains` is the network guard a runner renders into a job's settings; the other events are the measurement hooks
 * of `cli/measurement/hook/`, delegated there until they retire.
 */
import { OperationRefusal }                            from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                               from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }                         from '../CommandHandler.ts';
import { MEASUREMENT_HOOK_EVENTS, runMeasurementHook } from '../measurement/hook/HookCommand.ts';
import { guardTheNetworkDomains }                      from './BashDomainsHook.ts';

const BASH_DOMAINS_EVENT = 'bash-domains';

const USAGE = `${PRODUCT_NAMES.PROGRAM} hook subagent-stop|pre-tool-use|post-tool-use|bash-domains --allow <domains>  (the hook JSON arrives on standard input)`;

const NO_OPTION_NAMES: readonly string[] = [];

/**
 * The measurement hooks' arguments are the one thing they refuse, with exit 1: the harness always passes exactly the event word, so anything
 * else is a person typing the command by hand. `bash-domains` refuses nothing: whatever it is given, it answers at exit 0.
 */
export const hookCommand: CommandHandler = async (commandArguments, context) => {
  const event = commandArguments.positional();
  if (event === BASH_DOMAINS_EVENT) {
    await guardTheNetworkDomains(commandArguments, context);
    return;
  }
  commandArguments.rejectUnknownOptions(NO_OPTION_NAMES, USAGE);
  if (event === undefined || !MEASUREMENT_HOOK_EVENTS.includes(event)) {
    const named = event === undefined ? 'no hook event' : `"${event}"`;
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} hook takes one event and was given ${named}.\n  Usage: ${USAGE}`);
  }
  commandArguments.rejectExtraPositionals(1, USAGE);
  await runMeasurementHook(event, commandArguments, context);
};

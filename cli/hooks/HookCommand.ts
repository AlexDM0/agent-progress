/**
 * The `hook` verb. `session-start` prints the session instructions `init` and `update` wire it to; `bash-domains` is the network guard a
 * runner renders into a job's settings.
 */
import { OperationRefusal }            from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }               from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }         from '../CommandHandler.ts';
import { guardTheNetworkDomains }      from './BashDomainsHook.ts';
import { printTheSessionInstructions } from './SessionStartHook.ts';

const BASH_DOMAINS_EVENT = 'bash-domains';

const SESSION_START_EVENT = 'session-start';

const USAGE = `${PRODUCT_NAMES.PROGRAM} hook session-start|bash-domains --allow <domains>  (the hook JSON arrives on standard input)`;

/** Both events refuse nothing and exit 0 whatever they are given; any other event is a person typing the command by hand, refused at exit 1. */
export const hookCommand: CommandHandler = async (commandArguments, context) => {
  const event = commandArguments.positional();
  if (event === SESSION_START_EVENT) {
    printTheSessionInstructions(context);
    return;
  }
  if (event === BASH_DOMAINS_EVENT) {
    await guardTheNetworkDomains(commandArguments, context);
    return;
  }
  const named = event === undefined ? 'no hook event' : `"${event}"`;
  throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} hook takes one event and was given ${named}.\n  Usage: ${USAGE}`);
};

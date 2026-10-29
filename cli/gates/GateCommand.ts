/** `gate retry <J> [--incident <I>]`: settles the job's `gate-cannot-run` incident, after which the gate runs again. */
import { PRODUCT_NAMES }       from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler } from '../CommandHandler.ts';
import {
  incidentOf,
  jobIdAt,
  recordIncidentMove,
  refuseUsage
} from '../RecordedIncidentMove.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} gate retry <J> [--incident <I>] [--json]`;

export const GATE_SUBCOMMAND_NAMES = ['retry'] as const;

export const gateCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json', 'incident'], USAGE);
  if (commandArguments.positionals()[0] !== 'retry') refuseUsage('Write gate retry.', USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);
  await recordIncidentMove(commandArguments, context, { kind: 'gate-retry', jobId: jobIdAt(commandArguments, 1, USAGE), ...incidentOf(commandArguments) });
};

/**
 * `merge fixer|abort|review|land <J> [--incident <I>]`: the Airlock moves on a merge job's `merge-gate-failed` or
 * `resolution-over-threshold` incident, each recorded in a hold for the Airlock to carry out on its next sweep.
 */
import type { ControlCommand } from '../../src/shared/@types/ControlCommand.ts';
import { PRODUCT_NAMES }       from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler } from '../CommandHandler.ts';
import {
  incidentOf,
  jobIdAt,
  recordIncidentMove,
  refuseUsage
} from '../RecordedIncidentMove.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} merge fixer|abort|review|land <J> [--incident <I>] [--json]`;

export const MERGE_SUBCOMMAND_NAMES = ['fixer', 'abort', 'review', 'land'] as const;

const KIND_OF_SUBCOMMAND = {
  fixer:  'merge-fixer',
  abort:  'merge-abort',
  review: 'merge-review',
  land:   'merge-land',
} as const satisfies Record<typeof MERGE_SUBCOMMAND_NAMES[number], ControlCommand['kind']>;

export const mergeCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json', 'incident'], USAGE);
  const subcommand = MERGE_SUBCOMMAND_NAMES.find((name) => name === commandArguments.positionals()[0]);
  if (subcommand === undefined) refuseUsage(`Write one of merge ${MERGE_SUBCOMMAND_NAMES.join(', ')}.`, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);
  await recordIncidentMove(commandArguments, context, { kind: KIND_OF_SUBCOMMAND[subcommand], jobId: jobIdAt(commandArguments, 1, USAGE), ...incidentOf(commandArguments) });
};

/** `worktree repair <id> --step <step> [--incident <I>]`: a code-implemented repair of a ticket's worktree, run and recorded in one hold. */
import type { WorktreeRepairStep }                     from '../../src/shared/@types/ControlCommand.ts';
import { PRODUCT_NAMES }                               from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }                         from '../CommandHandler.ts';
import { incidentOf, recordIncidentMove, refuseUsage } from '../RecordedIncidentMove.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} worktree repair <id> --step prune|reinstall|recreate|unlock [--incident <I>] [--json]`;

export const WORKTREE_SUBCOMMAND_NAMES = ['repair'] as const;

const WORKTREE_REPAIR_STEPS: readonly WorktreeRepairStep[] = ['prune', 'reinstall', 'recreate', 'unlock'];

export const worktreeCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json', 'incident', 'step'], USAGE);
  if (commandArguments.positionals()[0] !== 'repair') refuseUsage('Write worktree repair.', USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);
  const ticketReference = commandArguments.positionals()[1];
  if (ticketReference === undefined) refuseUsage('Name the ticket whose worktree to repair, as 12.', USAGE);
  const written = commandArguments.option('step');
  const step = WORKTREE_REPAIR_STEPS.find((candidate) => candidate === written);
  if (step === undefined) refuseUsage(`Write --step as one of ${WORKTREE_REPAIR_STEPS.join(', ')}.`, USAGE);
  await recordIncidentMove(commandArguments, context, {
    kind: 'worktree-repair', ticketReference, step, ...incidentOf(commandArguments)
  });
};

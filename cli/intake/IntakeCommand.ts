/**
 * `intake -- <text>` records a product-owner job the runner launches in a session folder of its own; `intake close <J>` closes its input,
 * and the runner then opens the `ready-drafts` decision. Under the product owner's own job `intake close` names no job: the runner stamps it.
 */
import { ControlService }        from '../../src/services/control/ControlService.ts';
import type { ControlCommandOf } from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }      from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }         from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }   from '../CommandContext.ts';
import type { CommandHandler }   from '../CommandHandler.ts';
import { openTrackerForWriting } from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }     from '../RelayUnderJob.ts';
import type { ArgumentParser }   from '../arguments/ArgumentParser.ts';
import { OutputUtil }            from '../utils/OutputUtil.ts';

const { PROGRAM } = PRODUCT_NAMES;

const START_USAGE = `${PROGRAM} intake -- <text> [--json]`;
const CLOSE_USAGE = `${PROGRAM} intake close <J> [--set <id,id>]... [--json]`;

const JOB_ID_PATTERN = /^J[1-9][0-9]*$/i;

function refuseUsage(problem: string, usage: string): never {
  throw new OperationRefusal('refused', `${problem}\n  Usage: ${usage}`);
}

async function recordControl(
  commandArguments: ArgumentParser,
  context: CommandContext,
  command: ControlCommandOf<'intake-start'> | ControlCommandOf<'intake-close'>,
): Promise<string> {
  await relayWhenUnderJob(context, command);
  const { job, logged } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  const sentences = OutputUtil.loggedSentencesOf(logged);
  OutputUtil.printEntity(commandArguments, context, { jobId: job.id, logged }, sentences === '' ? `Intake of job ${job.id} closed.` : sentences);
  return job.id;
}

/** Each `--set` is one ticket set the product owner proposes to ready, its ids separated by commas. */
function proposedDraftSetsIn(commandArguments: ArgumentParser): string[][] {
  return commandArguments.optionValues('set').map((written) => written.split(',').map((ticketId) => ticketId.trim().replace(/^#/, '')).filter((ticketId) => ticketId !== ''));
}

async function closeIntake(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(['json', 'set'], CLOSE_USAGE);
  const proposedDraftSets = proposedDraftSetsIn(commandArguments);
  if (context.job !== undefined) {
    commandArguments.rejectExtraPositionals(1, CLOSE_USAGE);
    await relayWhenUnderJob(context, { kind: 'intake-close', proposedDraftSets });
    return;
  }
  commandArguments.rejectExtraPositionals(2, CLOSE_USAGE);
  const written = commandArguments.positionals()[1];
  if (written === undefined || !JOB_ID_PATTERN.test(written)) refuseUsage('Name the product-owner job whose intake to close, as J4.', CLOSE_USAGE);
  await recordControl(commandArguments, context, { kind: 'intake-close', jobId: written.toUpperCase(), proposedDraftSets });
}

export const intakeCommand: CommandHandler = async (commandArguments, context) => {
  if (commandArguments.positionalsBeforeSeparator()[0] === 'close') {
    await closeIntake(commandArguments, context);
    return;
  }
  commandArguments.rejectUnknownOptions(['json'], START_USAGE);
  if (commandArguments.positionalsBeforeSeparator().length > 0) refuseUsage('Write the request after --.', START_USAGE);
  const text = commandArguments.positionals().join(' ').trim();
  if (text === '') refuseUsage('Write the request after --.', START_USAGE);
  const jobId = await recordControl(commandArguments, context, { kind: 'intake-start', text });
  context.standardError(`The runner launches the product owner of job ${jobId}; follow it with \`${PROGRAM} job attach ${jobId}\`.`);
};

export const INTAKE_SUBCOMMAND_NAMES: readonly string[] = Object.freeze(['close']);

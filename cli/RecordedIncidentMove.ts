/**
 * What `worktree repair`, `gate retry` and `merge` share: a job id read as `J<n>`, the optional `--incident <I>`, and one control command
 * recorded in a hold (relayed when run under a job), printed as what it logged.
 */
import { ControlService }        from '../src/services/control/ControlService.ts';
import type { ControlCommand }   from '../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }      from '../src/shared/OperationRefusal.ts';
import type { CommandContext }   from './CommandContext.ts';
import { openTrackerForWriting } from './OpenTrackerForWriting.ts';
import { relayWhenUnderJob }     from './RelayUnderJob.ts';
import type { ArgumentParser }   from './arguments/ArgumentParser.ts';
import { OutputUtil }            from './utils/OutputUtil.ts';

const JOB_ID_PATTERN = /^J[1-9][0-9]*$/i;

export function refuseUsage(problem: string, usage: string): never {
  throw new OperationRefusal('refused', `${problem}\n  Usage: ${usage}`);
}

export function jobIdAt(commandArguments: ArgumentParser, position: number, usage: string): string {
  const written = commandArguments.positionals()[position];
  if (written === undefined) refuseUsage('Name the job, as J4.', usage);
  if (!JOB_ID_PATTERN.test(written)) refuseUsage(`"${written}" is not a job id. Write J and its number, as J4.`, usage);
  return written.toUpperCase();
}

/** `--incident <I>` names the incident the move handles; without it the move takes its subject's one open incident that allows it. */
export function incidentOf(commandArguments: ArgumentParser): { incidentId?: string } {
  const incidentId = commandArguments.option('incident')?.toUpperCase();
  return incidentId === undefined ? {} : { incidentId };
}

export async function recordIncidentMove(commandArguments: ArgumentParser, context: CommandContext, command: ControlCommand): Promise<void> {
  await relayWhenUnderJob(context, command);
  const { logged } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  const sentences = OutputUtil.loggedSentencesOf(logged);
  OutputUtil.printEntity(commandArguments, context, { command, logged }, sentences === '' ? 'Nothing to do.' : sentences);
}

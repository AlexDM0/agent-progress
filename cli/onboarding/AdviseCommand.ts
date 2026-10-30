/** `advise` records an onboarder job on demand, which the runner launches on a main-line snapshot to advise on the stored pipeline. */
import { ControlService }        from '../../src/services/control/ControlService.ts';
import { PRODUCT_NAMES }         from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }   from '../CommandHandler.ts';
import { openTrackerForWriting } from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }     from '../RelayUnderJob.ts';
import { OutputUtil }            from '../utils/OutputUtil.ts';

const { PROGRAM } = PRODUCT_NAMES;

const ADVISE_USAGE = `${PROGRAM} advise [--json]`;

export const adviseCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json'], ADVISE_USAGE);
  commandArguments.rejectExtraPositionals(1, ADVISE_USAGE);
  await relayWhenUnderJob(context, { kind: 'onboarder-advise' });
  const { job, logged } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply({ kind: 'onboarder-advise' }, change).result);
  OutputUtil.printEntity(commandArguments, context, { jobId: job.id, logged }, OutputUtil.loggedSentencesOf(logged));
  context.standardError(`The runner launches the onboarder of job ${job.id}; follow it with \`${PROGRAM} job attach ${job.id}\`.`);
};

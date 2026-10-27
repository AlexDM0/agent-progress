/** The `task` command's usage, and the task id and row annotation every one of its subcommands reads. */
import type { TaskAnnotation } from '../../../src/lib/tracker-model/@types/BoardChanges.ts';
import { OperationRefusal }    from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }       from '../../../src/shared/constants/ProductNames.ts';
import type { ArgumentParser } from '../../arguments/ArgumentParser.ts';
import { OptionValueUtil }     from '../../utils/OptionValueUtil.ts';

export const TASK_USAGE = [
  'add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--review-of <id>] [--start] [--tokens <n>] [--at <when>] [--force]',
  'start|pause|finish|approve|rereview|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]',
  'update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]',
  'remove <id>',
].map((usage) => `${PRODUCT_NAMES.PROGRAM} task ${usage}`).join('\n         ');

export function taskIdFrom(written: string | undefined, subcommand: string): number {
  if (written === undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} task${subcommand} needs a task id.\n  Usage: ${TASK_USAGE}`);
  }
  const identifier = OptionValueUtil.taskIdOf(written);
  if (identifier === null) {
    throw new OperationRefusal(
      'refused',
      `"${written}" is not a task id. A task id is the whole number shown beside the row, for example \`${PRODUCT_NAMES.PROGRAM} task${subcommand} 18\`.`,
    );
  }
  return identifier;
}

export function annotationFrom(commandArguments: ArgumentParser): TaskAnnotation {
  const owner  = commandArguments.option('owner');
  const note   = commandArguments.option('note');
  const tokens = OptionValueUtil.tokenCountFrom(commandArguments);
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(note === undefined ? {} : { note }),
    ...(tokens === undefined ? {} : { tokens }),
  };
}

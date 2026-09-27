import type { MovedToStatus }                     from '../../../src/adapters/utils/StatusWordingUtil.ts';
import { StatusWordingUtil }                      from '../../../src/adapters/utils/StatusWordingUtil.ts';
import { OperationRefusal }                       from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }                    from '../../CommandContext.ts';
import type { CommandHandler }                    from '../../CommandHandler.ts';
import { openTrackerForWritingThenReadNextLine }  from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                    from '../../arguments/ArgumentParser.ts';
import { OutputUtil }                             from '../../utils/OutputUtil.ts';
import { addOneTask }                             from './TaskAdd.ts';
import { TASK_USAGE, annotationFrom, taskIdFrom } from './TaskArguments.ts';
import { removeOneTask, updateOneTask }           from './TaskCorrection.ts';

const TRANSITION_SUBCOMMANDS: Readonly<Record<string, MovedToStatus>> = {
  start:    'in-progress',
  pause:    'paused',
  finish:   'in-review',
  approve:  'reviewed',
  rereview: 're-review',
  deliver:  'delivered',
};

const TRANSITION_OPTION_NAMES = ['owner', 'note', 'at', 'tokens', 'force', 'json'];

async function transitionOneTask(
  subcommand: string,
  targetStatus: MovedToStatus,
  commandArguments: ArgumentParser,
  context: CommandContext,
): Promise<void> {
  commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, TASK_USAGE);
  commandArguments.rejectExtraPositionals(2, TASK_USAGE);

  const taskId      = taskIdFrom(commandArguments.positionals()[1], subcommand);
  const movesAnyway = commandArguments.flag('force');

  const { result: task, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, ({ board, at }) => {
    board.moveTask(taskId, targetStatus, { movesAnyway }, at);
    return board.annotateTask(taskId, annotationFrom(commandArguments));
  });

  OutputUtil.printEntityThenNextLine(commandArguments, context, task, `Task #${task.id} ${StatusWordingUtil.movedPhraseFor(targetStatus)}: ${task.name}`, nextLine);
}

export const taskCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  if (subcommand === 'add') return addOneTask(commandArguments, context);
  const targetStatus = subcommand !== undefined && Object.hasOwn(TRANSITION_SUBCOMMANDS, subcommand) ? TRANSITION_SUBCOMMANDS[subcommand] : undefined;
  if (subcommand !== undefined && targetStatus !== undefined) return transitionOneTask(subcommand, targetStatus, commandArguments, context);
  if (subcommand === 'update') return updateOneTask(commandArguments, context);
  if (subcommand === 'remove') return removeOneTask(commandArguments, context);

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress task needs a subcommand' : `"${subcommand}" is not an agent-progress task subcommand`}.\n  Usage: ${TASK_USAGE}`,
  );
};

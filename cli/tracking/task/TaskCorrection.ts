/** `task update` and `task remove`: they correct or drop a row and, unlike the moves, stamp no time. */
import type { TaskStatus }                        from '../../../src/lib/tracker-model/@types/Task.ts';
import { TASK_STATUSES }                          from '../../../src/lib/tracker-model/constants/Statuses.ts';
import { VocabularyUtil }                         from '../../../src/lib/tracker-model/utils/VocabularyUtil.ts';
import { OperationRefusal }                       from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }                    from '../../CommandContext.ts';
import { openTrackerForWriting }                  from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                    from '../../arguments/ArgumentParser.ts';
import { RetiredWordRefusalUtil }                 from '../../legacy/utils/RetiredWordRefusalUtil.ts';
import { ReviewBarNameFilingUtil }                from '../../legacy/utils/ReviewBarNameFilingUtil.ts';
import { OutputUtil }                             from '../../utils/OutputUtil.ts';
import { TASK_USAGE, annotationFrom, taskIdFrom } from './TaskArguments.ts';

const UPDATE_OPTION_NAMES    = ['name', 'owner', 'note', 'status', 'tokens', 'force', 'json'];
const REMOVE_OPTION_NAMES    = ['json'];
const UPDATABLE_OPTION_NAMES = ['name', 'owner', 'note', 'status', 'tokens'];

function statusFrom(writtenStatus: string | undefined): TaskStatus | undefined {
  if (writtenStatus === undefined || VocabularyUtil.taskStatusIsKnown(writtenStatus)) return writtenStatus;
  // The seam to the retired words; dropping `cli/legacy/` leaves only the unknown-status refusal below.
  RetiredWordRefusalUtil.refuseARetiredTaskStatus(writtenStatus);
  throw new OperationRefusal('refused', `"${writtenStatus}" is not a task status. The statuses are ${TASK_STATUSES.join(', ')}.`);
}

/** `update` corrects a row and deliberately moves no timestamp, which is what separates it from the transitions. */
export async function updateOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(UPDATE_OPTION_NAMES, TASK_USAGE);
  commandArguments.rejectExtraPositionals(2, TASK_USAGE);

  const taskId      = taskIdFrom(commandArguments.positionals()[1], 'update');
  const status      = statusFrom(commandArguments.option('status'));
  const movesAnyway = commandArguments.flag('force');

  const changesSomething = UPDATABLE_OPTION_NAMES.some((name) => commandArguments.option(name) !== undefined);
  if (!changesSomething) {
    throw new OperationRefusal(
      'refused',
      `agent-progress task update needs at least one of --name, --owner, --note, --status or --tokens.\n  Usage: ${TASK_USAGE}`,
    );
  }

  const name = commandArguments.option('name');
  // The seam: dropping cli/legacy/ stores a free-standing row renamed to a review-shaped name without a link.
  const reviewLinkOfTheName = name === undefined ? undefined : ReviewBarNameFilingUtil.reviewLinkNamedBy(name);
  const task = await openTrackerForWriting(commandArguments, context, ({ board }) => {
    board.correctTask(taskId, {
      ...(name === undefined ? {} : { name }),
      ...(status === undefined ? {} : { status }),
      ...(reviewLinkOfTheName === undefined ? {} : { reviewOf: reviewLinkOfTheName }),
    }, { movesAnyway });
    return board.annotateTask(taskId, annotationFrom(commandArguments));
  });

  OutputUtil.printEntity(commandArguments, context, task, `Task #${task.id} updated: ${task.name}`);
}

export async function removeOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(REMOVE_OPTION_NAMES, TASK_USAGE);
  commandArguments.rejectExtraPositionals(2, TASK_USAGE);

  const taskId = taskIdFrom(commandArguments.positionals()[1], 'remove');

  const task = await openTrackerForWriting(commandArguments, context, ({ board }) => board.removeTask(taskId));

  OutputUtil.printEntity(commandArguments, context, task, `Task #${task.id} removed: ${task.name}`);
}

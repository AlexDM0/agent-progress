import { LegacyStatusUtil }    from '../../src/adapters/utils/LegacyStatusUtil';
import type { TaskAnnotation } from '../../src/lib/tracker-model/@types/BoardChanges';
import type { TaskStatus }     from '../../src/lib/tracker-model/@types/Task';
import { TASK_STATUSES }       from '../../src/lib/tracker-model/constants/Statuses';
import { VocabularyUtil }      from '../../src/lib/tracker-model/utils/VocabularyUtil';
import { OperationRefusal }    from '../../src/shared/OperationRefusal';
import { VERB_FOR_STATUS }     from '../../src/shared/constants/StatusVerbs';
import type { CommandContext } from '../CommandContext';
import {
  openTrackerForWriting,
  openTrackerForWritingThenReadNextLine,
  printEntity,
  printEntityThenNextLine,
  tokenCountFrom
} from '../CommandSupport';
import type { CommandHandler } from '../CommandTable';
import type { ArgumentParser } from '../arguments/ArgumentParser';

const USAGE = [
  'agent-progress task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--review-of <id>] [--start] [--tokens <n>] [--at <when>] [--force]',
  'agent-progress task start|pause|finish|approve|rereview|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]',
  'agent-progress task update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]',
  'agent-progress task remove <id>',
].join('\n         ');

interface TaskTransition {
  status: TaskStatus;
  spoken: string;
}

const TRANSITION_SUBCOMMANDS: Record<string, TaskTransition> = {
  [VERB_FOR_STATUS['in-progress']]: { status: 'in-progress', spoken: 'started' },
  [VERB_FOR_STATUS['paused']]:      { status: 'paused', spoken: 'paused' },
  [VERB_FOR_STATUS['in-review']]:   { status: 'in-review', spoken: 'in review' },
  [VERB_FOR_STATUS['reviewed']]:    { status: 'reviewed', spoken: 'reviewed' },
  [VERB_FOR_STATUS['re-review']]:   { status: 're-review', spoken: 'under review again' },
  [VERB_FOR_STATUS['delivered']]:   { status: 'delivered', spoken: 'delivered' },
};

/** A verb that was renamed is refused naming its replacement, rather than read as an unknown word. */
const RETIRED_SUBCOMMAND_REPLACEMENTS: Record<string, string> = { review: 'approve' };

const ADD_OPTION_NAMES        = ['owner', 'note', 'ticket', 'review-of', 'start', 'at', 'tokens', 'force', 'json'];
const TRANSITION_OPTION_NAMES = ['owner', 'note', 'at', 'tokens', 'force', 'json'];
const UPDATE_OPTION_NAMES     = ['name', 'owner', 'note', 'status', 'tokens', 'force', 'json'];
const REMOVE_OPTION_NAMES     = ['json'];
const UPDATABLE_OPTION_NAMES  = ['name', 'owner', 'note', 'status', 'tokens'];

function taskIdFrom(written: string | undefined, subcommand: string): number {
  if (written === undefined) {
    throw new OperationRefusal('refused', `agent-progress task ${subcommand} needs a task id.\n  Usage: ${USAGE}`);
  }
  const identifier = Number(written);
  if (!Number.isSafeInteger(identifier) || identifier <= 0) {
    throw new OperationRefusal(
      'refused',
      `"${written}" is not a task id. A task id is the whole number shown beside the row, for example \`agent-progress task ${subcommand} 18\`.`,
    );
  }
  return identifier;
}

function annotationFrom(commandArguments: ArgumentParser): TaskAnnotation {
  const owner  = commandArguments.option('owner');
  const note   = commandArguments.option('note');
  const tokens = tokenCountFrom(commandArguments);
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(note === undefined ? {} : { note }),
    ...(tokens === undefined ? {} : { tokens }),
  };
}

async function addOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ADD_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const name = commandArguments.positionals()[1];
  if (name === undefined || name.trim() === '') {
    throw new OperationRefusal('refused', `agent-progress task add needs a name.\n  Usage: ${USAGE}`);
  }
  const ticketReference   = commandArguments.option('ticket');
  const reviewedReference = commandArguments.option('review-of');
  const owner             = commandArguments.option('owner');
  const note              = commandArguments.option('note');
  const tokens            = tokenCountFrom(commandArguments);
  const startsNow         = commandArguments.flag('start');
  const movesTheLink      = commandArguments.flag('force');

  const { result: task, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, ({ board, at }) => {
    const ticket = ticketReference === undefined ? undefined : board.ticketByReference(ticketReference);
    if (ticketReference !== undefined && ticket === undefined) {
      throw new OperationRefusal(
        'refused',
        `There is no ticket ${ticketReference}. Run \`agent-progress ticket list\` to see the tickets this tracker holds.`,
      );
    }

    const reviewedTicket = reviewedReference === undefined ? undefined : board.ticketByReference(reviewedReference);
    if (reviewedReference !== undefined && reviewedTicket === undefined) {
      throw new OperationRefusal(
        'refused',
        `--review-of names ticket ${reviewedReference}, and there is none. Run \`agent-progress ticket list\` to see the tickets this tracker holds.`,
      );
    }

    return board.addTask({
      name,
      startsNow,
      movesTheLink,
      ...(owner === undefined ? {} : { owner }),
      ...(note === undefined ? {} : { note }),
      ...(tokens === undefined ? {} : { tokens }),
      ...(ticket === undefined ? {} : { ticketId: ticket.frontmatter.id }),
      ...(reviewedTicket === undefined ? {} : { reviewOf: reviewedTicket.frontmatter.id }),
    }, at);
  });

  const humanLine = `Task #${task.id} added: ${task.name}`;
  // Only a row started as it is added takes a slot; a pending one moves nothing the Next line reads.
  if (startsNow) {
    printEntityThenNextLine(commandArguments, context, task, humanLine, nextLine);
  } else {
    printEntity(commandArguments, context, task, humanLine);
  }
}

async function transitionOneTask(
  subcommand: string,
  move: TaskTransition,
  commandArguments: ArgumentParser,
  context: CommandContext,
): Promise<void> {
  commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const taskId      = taskIdFrom(commandArguments.positionals()[1], subcommand);
  const movesAnyway = commandArguments.flag('force');

  const { result: task, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, ({ board, at }) => {
    board.moveTask(taskId, move.status, { movesAnyway }, at);
    return board.annotateTask(taskId, annotationFrom(commandArguments));
  });

  printEntityThenNextLine(commandArguments, context, task, `Task #${task.id} ${move.spoken}: ${task.name}`, nextLine);
}

/** `update` corrects a row and deliberately moves no timestamp, which is what separates it from the transitions. */
async function updateOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(UPDATE_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const taskId        = taskIdFrom(commandArguments.positionals()[1], 'update');
  const writtenStatus = commandArguments.option('status');
  if (writtenStatus !== undefined && !VocabularyUtil.taskStatusIsKnown(writtenStatus)) {
    const renamedStatus = LegacyStatusUtil.currentTaskStatusFor(writtenStatus);
    if (renamedStatus !== null) {
      throw new OperationRefusal('refused', `"${writtenStatus}" is the old name of the task status ${renamedStatus}; pass --status ${renamedStatus}.`);
    }
    throw new OperationRefusal('refused', `"${writtenStatus}" is not a task status. The statuses are ${TASK_STATUSES.join(', ')}.`);
  }
  const status: TaskStatus | undefined = writtenStatus !== undefined && VocabularyUtil.taskStatusIsKnown(writtenStatus) ? writtenStatus : undefined;
  const movesAnyway = commandArguments.flag('force');

  const changesSomething = UPDATABLE_OPTION_NAMES.some((name) => commandArguments.option(name) !== undefined);
  if (!changesSomething) {
    throw new OperationRefusal(
      'refused',
      `agent-progress task update needs at least one of --name, --owner, --note, --status or --tokens.\n  Usage: ${USAGE}`,
    );
  }

  const name = commandArguments.option('name');
  const task = await openTrackerForWriting(commandArguments, context, ({ board }) => {
    board.correctTask(taskId, {
      ...(name === undefined ? {} : { name }),
      ...(status === undefined ? {} : { status }),
    }, { movesAnyway });
    return board.annotateTask(taskId, annotationFrom(commandArguments));
  });

  printEntity(commandArguments, context, task, `Task #${task.id} updated: ${task.name}`);
}

function refuseARetiredSubcommand(subcommand: string, commandArguments: ArgumentParser): never {
  const replacement  = RETIRED_SUBCOMMAND_REPLACEMENTS[subcommand] ?? subcommand;
  const targetStatus = TRANSITION_SUBCOMMANDS[replacement]?.status ?? replacement;
  const taskId       = commandArguments.positionals()[1] ?? '<id>';
  throw new OperationRefusal(
    'refused',
    `\`agent-progress task ${subcommand}\` was renamed: \`agent-progress task ${replacement} ${taskId}\` moves a row to ${targetStatus}. Nothing was written.`,
  );
}

async function removeOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(REMOVE_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const taskId = taskIdFrom(commandArguments.positionals()[1], 'remove');

  const task = await openTrackerForWriting(commandArguments, context, ({ board }) => board.removeTask(taskId));

  printEntity(commandArguments, context, task, `Task #${task.id} removed: ${task.name}`);
}

export const taskCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  if (subcommand === 'add') return addOneTask(commandArguments, context);
  const move = subcommand !== undefined && Object.hasOwn(TRANSITION_SUBCOMMANDS, subcommand) ? TRANSITION_SUBCOMMANDS[subcommand] : undefined;
  if (subcommand !== undefined && move !== undefined) return transitionOneTask(subcommand, move, commandArguments, context);
  if (subcommand === 'update') return updateOneTask(commandArguments, context);
  if (subcommand === 'remove') return removeOneTask(commandArguments, context);
  if (subcommand !== undefined && Object.hasOwn(RETIRED_SUBCOMMAND_REPLACEMENTS, subcommand)) refuseARetiredSubcommand(subcommand, commandArguments);

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress task needs a subcommand' : `"${subcommand}" is not an agent-progress task subcommand`}.\n  Usage: ${USAGE}`,
  );
};

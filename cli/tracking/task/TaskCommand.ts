import type { MovedToStatus }                                           from '../../../src/adapters/utils/StatusWordingUtil.ts';
import { StatusWordingUtil }                                            from '../../../src/adapters/utils/StatusWordingUtil.ts';
import { TicketBodyUtil }                                               from '../../../src/adapters/utils/TicketBodyUtil.ts';
import type { TaskAnnotation }                                          from '../../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { TaskStatus }                                              from '../../../src/lib/tracker-model/@types/Task.ts';
import { TASK_STATUSES }                                                from '../../../src/lib/tracker-model/constants/Statuses.ts';
import { VocabularyUtil }                                               from '../../../src/lib/tracker-model/utils/VocabularyUtil.ts';
import { OperationRefusal }                                             from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }                                          from '../../CommandContext.ts';
import type { CommandHandler }                                          from '../../CommandHandler.ts';
import { openTrackerForWriting, openTrackerForWritingThenReadNextLine } from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                                          from '../../arguments/ArgumentParser.ts';
import { RetiredWordRefusalUtil }                                       from '../../legacy/utils/RetiredWordRefusalUtil.ts';
import { ReviewBarNameFilingUtil }                                      from '../../legacy/utils/ReviewBarNameFilingUtil.ts';
import { OptionValueUtil }                                              from '../../utils/OptionValueUtil.ts';
import { OutputUtil }                                                   from '../../utils/OutputUtil.ts';

const USAGE = [
  'agent-progress task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--review-of <id>] [--start] [--tokens <n>] [--at <when>] [--force]',
  'agent-progress task start|pause|finish|approve|rereview|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]',
  'agent-progress task update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]',
  'agent-progress task remove <id>',
].join('\n         ');

const TRANSITION_SUBCOMMANDS: Record<string, MovedToStatus> = {
  [StatusWordingUtil.verbFor('in-progress')]: 'in-progress',
  [StatusWordingUtil.verbFor('paused')]:      'paused',
  [StatusWordingUtil.verbFor('in-review')]:   'in-review',
  [StatusWordingUtil.verbFor('reviewed')]:    'reviewed',
  [StatusWordingUtil.verbFor('re-review')]:   're-review',
  [StatusWordingUtil.verbFor('delivered')]:   'delivered',
};

const ADD_OPTION_NAMES        = ['owner', 'note', 'ticket', 'review-of', 'start', 'at', 'tokens', 'force', 'json'];
const TRANSITION_OPTION_NAMES = ['owner', 'note', 'at', 'tokens', 'force', 'json'];
const UPDATE_OPTION_NAMES     = ['name', 'owner', 'note', 'status', 'tokens', 'force', 'json'];
const REMOVE_OPTION_NAMES     = ['json'];
const UPDATABLE_OPTION_NAMES  = ['name', 'owner', 'note', 'status', 'tokens'];

function taskIdFrom(written: string | undefined, subcommand: string): number {
  if (written === undefined) {
    throw new OperationRefusal('refused', `agent-progress task ${subcommand} needs a task id.\n  Usage: ${USAGE}`);
  }
  const identifier = OptionValueUtil.taskIdOf(written);
  if (identifier === null) {
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
  const tokens = OptionValueUtil.tokenCountFrom(commandArguments);
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
  const tokens            = OptionValueUtil.tokenCountFrom(commandArguments);
  const startsNow         = commandArguments.flag('start');
  const movesTheLink      = commandArguments.flag('force');
  // The seam: dropping cli/legacy/ files such a row without a link.
  const reviewLinkOfTheName = ticketReference === undefined && reviewedReference === undefined ? ReviewBarNameFilingUtil.reviewLinkNamedBy(name) : undefined;

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
      ...(reviewedTicket === undefined ? {} : { reviewOf: { ticketId: reviewedTicket.frontmatter.id, round: TicketBodyUtil.nextReviewRoundOf(reviewedTicket.body) } }),
      ...(reviewLinkOfTheName === undefined ? {} : { reviewOf: reviewLinkOfTheName }),
    }, at);
  });

  const humanLine = `Task #${task.id} added: ${task.name}`;
  // Only a row started as it is added takes a slot; a pending one moves nothing the Next line reads.
  if (startsNow) {
    OutputUtil.printEntityThenNextLine(commandArguments, context, task, humanLine, nextLine);
  } else {
    OutputUtil.printEntity(commandArguments, context, task, humanLine);
  }
}

async function transitionOneTask(
  subcommand: string,
  targetStatus: MovedToStatus,
  commandArguments: ArgumentParser,
  context: CommandContext,
): Promise<void> {
  commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const taskId      = taskIdFrom(commandArguments.positionals()[1], subcommand);
  const movesAnyway = commandArguments.flag('force');

  const { result: task, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, ({ board, at }) => {
    board.moveTask(taskId, targetStatus, { movesAnyway }, at);
    return board.annotateTask(taskId, annotationFrom(commandArguments));
  });

  OutputUtil.printEntityThenNextLine(commandArguments, context, task, `Task #${task.id} ${StatusWordingUtil.movedPhraseFor(targetStatus)}: ${task.name}`, nextLine);
}

/** `update` corrects a row and deliberately moves no timestamp, which is what separates it from the transitions. */
async function updateOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(UPDATE_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const taskId        = taskIdFrom(commandArguments.positionals()[1], 'update');
  const writtenStatus = commandArguments.option('status');
  if (writtenStatus !== undefined && !VocabularyUtil.taskStatusIsKnown(writtenStatus)) {
    // The seam to the retired words; dropping `cli/legacy/` leaves only the unknown-status refusal below.
    RetiredWordRefusalUtil.refuseARetiredTaskStatus(writtenStatus);
    throw new OperationRefusal('refused', `"${writtenStatus}" is not a task status. The statuses are ${TASK_STATUSES.map(StatusWordingUtil.statusWordFor).join(', ')}.`);
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
  // The seams: dropping cli/legacy/ stores a free-standing row renamed to a review-shaped name without a link, and a rename keeps any link.
  const reviewLinkOfTheName = name === undefined ? undefined : ReviewBarNameFilingUtil.reviewLinkNamedBy(name);
  const task = await openTrackerForWriting(commandArguments, context, ({ board }) => {
    const previousRow      = board.tasks().find((row) => row.id === taskId);
    const relinkedReviewOf = name === undefined || previousRow === undefined ? undefined : ReviewBarNameFilingUtil.reviewLinkAfterRenaming(previousRow, name);
    board.correctTask(taskId, {
      ...(name === undefined ? {} : { name }),
      ...(status === undefined ? {} : { status }),
      ...(reviewLinkOfTheName === undefined ? {} : { reviewOf: reviewLinkOfTheName }),
      ...(relinkedReviewOf === undefined ? {} : { relinkedReviewOf }),
    }, { movesAnyway });
    return board.annotateTask(taskId, annotationFrom(commandArguments));
  });

  OutputUtil.printEntity(commandArguments, context, task, `Task #${task.id} updated: ${task.name}`);
}

async function removeOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(REMOVE_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const taskId = taskIdFrom(commandArguments.positionals()[1], 'remove');

  const task = await openTrackerForWriting(commandArguments, context, ({ board }) => board.removeTask(taskId));

  OutputUtil.printEntity(commandArguments, context, task, `Task #${task.id} removed: ${task.name}`);
}

export const taskCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  if (subcommand === 'add') return addOneTask(commandArguments, context);
  const targetStatus = subcommand !== undefined && Object.hasOwn(TRANSITION_SUBCOMMANDS, subcommand) ? TRANSITION_SUBCOMMANDS[subcommand] : undefined;
  if (subcommand !== undefined && targetStatus !== undefined) return transitionOneTask(subcommand, targetStatus, commandArguments, context);
  if (subcommand === 'update') return updateOneTask(commandArguments, context);
  if (subcommand === 'remove') return removeOneTask(commandArguments, context);
  // The seam to the retired verbs; dropping `cli/legacy/` leaves only the unknown-subcommand refusal below.
  if (subcommand !== undefined) RetiredWordRefusalUtil.refuseARetiredTaskVerb(subcommand, commandArguments);

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress task needs a subcommand' : `"${subcommand}" is not an agent-progress task subcommand`}.\n  Usage: ${USAGE}`,
  );
};

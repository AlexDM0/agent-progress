import { TASK_STATUSES, taskStatusIsKnown }    from '../../lib/constants/Statuses';
import type { ProgressFile, Task, TaskStatus } from '../../lib/constants/Types';
import { OperationRefusal }                    from '../../lib/platform/OperationRefusal';
import {
  addTask,
  findTask,
  removeTask,
  transitionTask
}                                             from '../../lib/progress/ProgressStore';
import { readTicket }                         from '../../lib/tickets/TicketStore';
import { TokenCountUtil }                     from '../../lib/utils/TokenCountUtil';
import type { CommandContext }                from '../CommandContext';
import { openTrackerForWriting, printEntity } from '../CommandSupport';
import type { CommandHandler }                from '../CommandTable';
import type { ArgumentParser }                from '../arguments/ArgumentParser';

const USAGE = [
  'agent-progress task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--start] [--tokens <n>] [--at <when>]',
  'agent-progress task start|pause|finish|review|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>] [--at <when>] [--force]',
  'agent-progress task update <id> [--name <text>] [--owner <who>] [--note <text>] [--status <status>] [--tokens <n>] [--force]',
  'agent-progress task remove <id>',
].join('\n         ');

const TRANSITION_SUBCOMMANDS: Record<string, { status: TaskStatus; spoken: string }> = {
  start:   { status: 'running',   spoken: 'started' },
  pause:   { status: 'paused',    spoken: 'paused' },
  finish:  { status: 'finished',  spoken: 'finished' },
  review:  { status: 'reviewed',  spoken: 'reviewed' },
  deliver: { status: 'delivered', spoken: 'delivered' },
};

/** Written out rather than derived, because a command folder may not import a sibling's (`lib/ImportDirection.spec.ts`). */
const TICKET_VERB_FOR_TASK_STATUS: Partial<Record<TaskStatus, string>> = {
  pending:   'ticket reopen',
  running:   'ticket start',
  finished:  'ticket review',
  reviewed:  'ticket done',
  delivered: 'ticket deliver',
  abandoned: 'ticket abandon',
};

const ADD_OPTION_NAMES        = ['owner', 'note', 'ticket', 'start', 'at', 'tokens', 'force', 'json'];
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

function tokenCountFrom(commandArguments: ArgumentParser): number | undefined {
  const written = commandArguments.option('tokens');
  if (written === undefined) return undefined;

  const count = TokenCountUtil.parseTokenCount(written);
  if (count === null) {
    throw new OperationRefusal(
      'refused',
      `--tokens "${written}" is not a token count. Write a whole number, or a decimal with a \`k\` or \`m\` suffix: \`12000\`, \`12k\`, \`12.3k\`, \`1.2m\`.`,
    );
  }
  return count;
}

function requireTask(progress: ProgressFile, taskId: number): Task {
  const task = findTask(progress, taskId);
  if (task === undefined) {
    throw new OperationRefusal('refused', `There is no task #${taskId}. Run \`agent-progress status\` to see the rows this tracker holds.`);
  }
  return task;
}

/** A row a ticket owns moves through the `ticket` verbs so the two files cannot disagree; a pause and its resume are exempt. */
function refuseATicketOwnedMove(task: Task, targetStatus: TaskStatus, movesAnyway: boolean): void {
  if (task.ticket === null || movesAnyway) return;
  if (targetStatus === 'paused') return;
  if (targetStatus === 'running' && task.status === 'paused') return;

  const ticketVerb = TICKET_VERB_FOR_TASK_STATUS[targetStatus] ?? 'ticket status';
  throw new OperationRefusal(
    'refused',
    `Task #${task.id} belongs to ticket #${task.ticket}, so moving it here would leave the row and the ticket disagreeing. `
    + `Run \`agent-progress ${ticketVerb} ${task.ticket}\` instead, which moves both, or pass --force to move only the row.`,
  );
}

function applyOwnerNoteAndTokens(commandArguments: ArgumentParser, task: Task): void {
  const owner  = commandArguments.option('owner');
  const note   = commandArguments.option('note');
  const tokens = tokenCountFrom(commandArguments);
  if (owner !== undefined) task.owner = owner;
  if (note !== undefined) task.note = note;
  if (tokens !== undefined) task.tokens = tokens;
}

async function addOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ADD_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const name = commandArguments.positionals()[1];
  if (name === undefined || name.trim() === '') {
    throw new OperationRefusal('refused', `agent-progress task add needs a name.\n  Usage: ${USAGE}`);
  }
  const ticketReference = commandArguments.option('ticket');
  const owner           = commandArguments.option('owner');
  const note            = commandArguments.option('note');
  const tokens          = tokenCountFrom(commandArguments);
  const startsNow       = commandArguments.flag('start');
  const movesTheLink    = commandArguments.flag('force');

  const task = await openTrackerForWriting(commandArguments, context, (change) => {
    const {
      progress,
      workspace,
      at,
      writeTicketAfterwards,
    } = change;

    const ticket = ticketReference === undefined ? null : readTicket(workspace, ticketReference);
    if (ticketReference !== undefined && ticket === null) {
      throw new OperationRefusal(
        'refused',
        `There is no ticket ${ticketReference}. Run \`agent-progress ticket list\` to see the tickets this tracker holds.`,
      );
    }

    if (ticket !== null && ticket.frontmatter.task !== null) {
      const alreadyLinked = findTask(progress, ticket.frontmatter.task);
      if (alreadyLinked !== undefined) {
        if (!movesTheLink) {
          throw new OperationRefusal(
            'refused',
            `Ticket #${ticket.frontmatter.id} already has task #${alreadyLinked.id} ("${alreadyLinked.name}"). `
            + 'Pass --force to move the ticket on to the new row, or leave --ticket off.',
          );
        }
        alreadyLinked.ticket = null;
      }
    }

    const created = addTask(progress, {
      name,
      ...(owner === undefined ? {} : { owner }),
      ...(note === undefined ? {} : { note }),
      ...(tokens === undefined ? {} : { tokens }),
      ...(ticket === null ? {} : { ticket: ticket.frontmatter.id }),
    });
    if (startsNow) transitionTask(progress, created.id, 'running', at);

    if (ticket !== null) {
      ticket.frontmatter.task = created.id;
      writeTicketAfterwards(ticket);
    }
    return created;
  });

  printEntity(commandArguments, context, task, `Task #${task.id} added: ${task.name}`);
}

async function transitionOneTask(subcommand: string, commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const move        = TRANSITION_SUBCOMMANDS[subcommand];
  const taskId      = taskIdFrom(commandArguments.positionals()[1], subcommand);
  const movesAnyway = commandArguments.flag('force');
  if (move === undefined) {
    throw new OperationRefusal('refused', `"${subcommand}" is not an agent-progress task subcommand.\n  Usage: ${USAGE}`);
  }

  const task = await openTrackerForWriting(commandArguments, context, (change) => {
    const moved = requireTask(change.progress, taskId);
    refuseATicketOwnedMove(moved, move.status, movesAnyway);
    transitionTask(change.progress, taskId, move.status, change.at);
    applyOwnerNoteAndTokens(commandArguments, moved);
    return moved;
  });

  printEntity(commandArguments, context, task, `Task #${task.id} ${move.spoken}: ${task.name}`);
}

/** `update` corrects a row and deliberately moves no timestamp, which is what separates it from the transitions. */
async function updateOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(UPDATE_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const taskId        = taskIdFrom(commandArguments.positionals()[1], 'update');
  const writtenStatus = commandArguments.option('status');
  if (writtenStatus !== undefined && !taskStatusIsKnown(writtenStatus)) {
    throw new OperationRefusal('refused', `"${writtenStatus}" is not a task status. The statuses are ${TASK_STATUSES.join(', ')}.`);
  }
  const status: TaskStatus | undefined = writtenStatus !== undefined && taskStatusIsKnown(writtenStatus) ? writtenStatus : undefined;
  const movesAnyway = commandArguments.flag('force');

  const changesSomething = UPDATABLE_OPTION_NAMES.some((name) => commandArguments.option(name) !== undefined);
  if (!changesSomething) {
    throw new OperationRefusal(
      'refused',
      `agent-progress task update needs at least one of --name, --owner, --note, --status or --tokens.\n  Usage: ${USAGE}`,
    );
  }

  const task = await openTrackerForWriting(commandArguments, context, (change) => {
    const updated = requireTask(change.progress, taskId);
    if (status !== undefined) refuseATicketOwnedMove(updated, status, movesAnyway);
    const name = commandArguments.option('name');
    if (name !== undefined) updated.name = name;
    applyOwnerNoteAndTokens(commandArguments, updated);
    if (status !== undefined) updated.status = status;
    return updated;
  });

  printEntity(commandArguments, context, task, `Task #${task.id} updated: ${task.name}`);
}

async function removeOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(REMOVE_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const taskId = taskIdFrom(commandArguments.positionals()[1], 'remove');

  const task = await openTrackerForWriting(commandArguments, context, (change) => {
    const {
      progress,
      workspace,
      writeTicketAfterwards,
    } = change;
    requireTask(progress, taskId);
    const removed = removeTask(progress, taskId);
    if (removed === undefined) {
      throw new OperationRefusal('refused', `There is no task #${taskId}.`);
    }

    // Unlinked here so the two files agree at every moment both are on disk, rather than at the next transition.
    if (removed.ticket !== null) {
      const ticket = readTicket(workspace, removed.ticket);
      if (ticket !== null && ticket.frontmatter.task === taskId) {
        ticket.frontmatter.task = null;
        writeTicketAfterwards(ticket);
      }
    }
    return removed;
  });

  printEntity(commandArguments, context, task, `Task #${task.id} removed: ${task.name}`);
}

export const taskCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  if (subcommand === 'add') return addOneTask(commandArguments, context);
  if (subcommand !== undefined && Object.hasOwn(TRANSITION_SUBCOMMANDS, subcommand)) {
    return transitionOneTask(subcommand, commandArguments, context);
  }
  if (subcommand === 'update') return updateOneTask(commandArguments, context);
  if (subcommand === 'remove') return removeOneTask(commandArguments, context);

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress task needs a subcommand' : `"${subcommand}" is not an agent-progress task subcommand`}.\n  Usage: ${USAGE}`,
  );
};

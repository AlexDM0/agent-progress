/** Re-seeds one row per surviving ticket from that ticket's own stamps, so a cleared tracker still draws the work that was done. */
import { OperationRefusal }                                       from '../../lib/platform/OperationRefusal';
import { appendLogEntry }                                         from '../../lib/progress/ProgressStore';
import { deleteAllTickets, listTickets }                          from '../../lib/tickets/TicketStore';
import { seedTaskFromTicket }                                     from '../../lib/tickets/TicketTransitions';
import { openTrackerForWriting, printEntity, progressOperations } from '../CommandSupport';
import type { CommandHandler }                                    from '../CommandTable';

const USAGE = 'agent-progress clear [--all] [--yes]';

const KNOWN_OPTION_NAMES = ['all', 'yes', 'json'];

const CLEARED_LOG_TEXT = 'Tracker cleared';

export const clearCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const deletesTickets = commandArguments.flag('all');
  const skipsQuestion  = commandArguments.flag('yes');

  if (!skipsQuestion) {
    // Fail closed off a terminal: prompting where nobody can answer is a hang, so the command refuses instead.
    if (!context.standardInputIsTerminal) {
      throw new OperationRefusal(
        'refused',
        'agent-progress clear needs --yes when standard input is not a terminal, because there is nobody to answer the confirmation.',
      );
    }
    const question = deletesTickets
      ? 'Delete every task row, the log and every ticket in this tracker? [y/N]'
      : 'Delete every task row and the log, keeping the tickets? [y/N]';
    if (!await context.confirm(question)) {
      context.standardOutput('Nothing was cleared.');
      return;
    }
  }

  const summary = await openTrackerForWriting(commandArguments, context, (change) => {
    const {
      progress,
      workspace,
      at,
      writeTicketAfterwards,
    } = change;

    const removedTaskCount = progress.tasks.length;
    const removedLogCount  = progress.log.length;

    // Emptied in place, never replaced: `trackerId` namespaces the page's stored range, and a fresh one would reset every reader's view.
    progress.startedAt  = at;
    progress.view       = { kind: 'auto' };
    progress.tasks.length = 0;
    progress.log.length   = 0;
    appendLogEntry(progress, at, CLEARED_LOG_TEXT);

    if (deletesTickets) {
      return {
        removedTaskCount,
        removedLogCount,
        deletedTicketCount:  deleteAllTickets(workspace),
        reseededTicketCount: 0,
      };
    }

    const surviving = listTickets(workspace).tickets;
    for (const ticket of surviving) {
      seedTaskFromTicket({ progress, ticket, operations: progressOperations });
      writeTicketAfterwards(ticket);
    }
    return {
      removedTaskCount,
      removedLogCount,
      deletedTicketCount:  0,
      reseededTicketCount: surviving.length,
    };
  });

  const ticketLine = deletesTickets
    ? `${summary.deletedTicketCount} ticket(s) deleted`
    : `${summary.reseededTicketCount} ticket(s) re-seeded`;
  printEntity(
    commandArguments,
    context,
    summary,
    `Tracker cleared: ${summary.removedTaskCount} task row(s) and ${summary.removedLogCount} log entr(ies) removed, ${ticketLine}.`,
  );
};

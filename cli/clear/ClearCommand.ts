import { OperationRefusal }                   from '../../src/shared/OperationRefusal';
import { openTrackerForWriting, printEntity } from '../CommandSupport';
import type { CommandHandler }                from '../CommandTable';

const USAGE = 'agent-progress clear [--all] [--yes]';

const KNOWN_OPTION_NAMES = ['all', 'yes', 'json'];

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

  let deletedTicketCount = 0;
  const summary = await openTrackerForWriting(commandArguments, context, (change) => {
    const cleared = change.board.clearTracker({ ticketsSurvive: !deletesTickets }, change.at);
    // After the progress file, like every ticket write, so a failed write leaves the tickets and the file that names them together.
    if (deletesTickets) change.deleteAllTicketFilesAfterwards((deletedFileCount) => { deletedTicketCount = deletedFileCount; });
    return {
      removedTaskCount:    cleared.removedTaskCount,
      removedLogCount:     change.storedLogEntryCount,
      reseededTicketCount: cleared.survivingTicketCount,
    };
  });

  const ticketLine = deletesTickets
    ? `${deletedTicketCount} ticket(s) deleted`
    : `${summary.reseededTicketCount} ticket(s) re-seeded`;
  printEntity(
    commandArguments,
    context,
    {
      removedTaskCount:    summary.removedTaskCount,
      removedLogCount:     summary.removedLogCount,
      deletedTicketCount,
      reseededTicketCount: summary.reseededTicketCount,
    },
    `Tracker cleared: ${summary.removedTaskCount} task row(s) and ${summary.removedLogCount} log entr(ies) removed, ${ticketLine}.`,
  );
};

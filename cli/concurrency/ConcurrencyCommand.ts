import { OperationRefusal } from '../../lib/platform/OperationRefusal';
import { requireWorkspace } from '../../lib/platform/Workspace';
import {
  appendLogEntry,
  concurrencyLimitIsWellFormed,
  concurrencyOf,
  readProgressFile
}                                             from '../../lib/progress/ProgressStore';
import type { CommandContext }                from '../CommandContext';
import { openTrackerForWriting, printEntity } from '../CommandSupport';
import type { CommandHandler }                from '../CommandTable';
import type { ArgumentParser }                from '../arguments/ArgumentParser';

const USAGE = 'agent-progress concurrency [<n>] [--json]';

const KNOWN_OPTION_NAMES = ['json'];

const WHOLE_NUMBER_PATTERN = /^\d+$/;

function limitFrom(written: string): number {
  const limit = WHOLE_NUMBER_PATTERN.test(written) ? Number(written) : Number.NaN;
  if (!concurrencyLimitIsWellFormed(limit)) {
    throw new OperationRefusal('refused', `"${written}" is not a concurrency limit. Write a whole number of agents, 1 or more.\n  Usage: ${USAGE}`);
  }
  return limit;
}

/** The read takes no lock, as `status` takes none: the progress file is written atomically, so it is either the old one or the new one. */
function printCurrentLimit(commandArguments: ArgumentParser, context: CommandContext): void {
  const workspace    = requireWorkspace(context.currentDirectory);
  const progressRead = readProgressFile(workspace);
  if (progressRead.verdict !== 'readable') {
    const reason = progressRead.verdict === 'absent' ? 'it is not there' : progressRead.reason;
    throw new OperationRefusal('unrepaired', `${workspace.progressFilePath} cannot be read: ${reason}`);
  }
  const concurrency = concurrencyOf(progressRead.progress);
  printEntity(commandArguments, context, concurrency, String(concurrency.limit));
}

export const concurrencyCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  const written = commandArguments.positional();
  if (written === undefined) {
    printCurrentLimit(commandArguments, context);
    return;
  }
  const limit = limitFrom(written);

  const changed = await openTrackerForWriting(commandArguments, context, (change) => {
    const previousLimit             = concurrencyOf(change.progress).limit;
    change.progress.concurrencyLimit = limit;
    appendLogEntry(change.progress, change.at, `Concurrency limit set to ${limit}`);
    return { previousLimit, concurrency: concurrencyOf(change.progress) };
  });

  const { concurrency, previousLimit } = changed;
  printEntity(
    commandArguments,
    context,
    concurrency,
    `Concurrency limit set to ${limit} (was ${previousLimit}): ${concurrency.inFlight} running, ${concurrency.freeSlots} free.`,
  );
};

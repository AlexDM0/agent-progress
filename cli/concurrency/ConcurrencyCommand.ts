import { CONCURRENCY_LIMIT_CEILING_AGENTS }                            from '../../lib/constants/Limits';
import { OperationRefusal }                                            from '../../lib/platform/OperationRefusal';
import { requireWorkspace }                                            from '../../lib/platform/Workspace';
import { appendLogEntry, concurrencyLimitIsWellFormed, concurrencyOf } from '../../lib/progress/ProgressStore';
import type { CommandContext }                                         from '../CommandContext';
import { openTrackerForWriting, printEntity, requireProgressFile }     from '../CommandSupport';
import type { CommandHandler }                                         from '../CommandTable';
import type { ArgumentParser }                                         from '../arguments/ArgumentParser';

const USAGE = 'agent-progress concurrency [<n>] [--json]';

const KNOWN_OPTION_NAMES = ['json'];

const WHOLE_NUMBER_PATTERN = /^\d+$/;

function limitFrom(written: string): number {
  const limit = WHOLE_NUMBER_PATTERN.test(written) ? Number(written) : Number.NaN;
  if (!concurrencyLimitIsWellFormed(limit) || limit > CONCURRENCY_LIMIT_CEILING_AGENTS) {
    throw new OperationRefusal(
      'refused',
      `"${written}" is not a concurrency limit. Write a whole number of agents from 1 to ${CONCURRENCY_LIMIT_CEILING_AGENTS}.\n  Usage: ${USAGE}`,
    );
  }
  return limit;
}

function printCurrentLimit(commandArguments: ArgumentParser, context: CommandContext): void {
  const concurrency = concurrencyOf(requireProgressFile(requireWorkspace(context.currentDirectory)));
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
    `Concurrency limit set to ${limit} (was ${previousLimit}): ${concurrency.agentsInFlight} agents in flight, ${concurrency.freeSlots} free.`,
  );
};

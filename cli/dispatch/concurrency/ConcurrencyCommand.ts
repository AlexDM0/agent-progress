import { readingBoardOf }                   from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { CONCURRENCY_LIMIT_CEILING_AGENTS } from '../../../src/lib/tracker-model/constants/ConcurrencyLimits.ts';
import { BoardSettingsUtil }                from '../../../src/lib/tracker-model/utils/BoardSettingsUtil.ts';
import { requireProgressFile }              from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                 from '../../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                 from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }              from '../../CommandContext.ts';
import type { CommandHandler }              from '../../CommandHandler.ts';
import { openTrackerForWriting }            from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }              from '../../arguments/ArgumentParser.ts';
import { OutputUtil }                       from '../../utils/OutputUtil.ts';

const USAGE = 'agent-progress concurrency [<n>] [--json]';

const KNOWN_OPTION_NAMES = ['json'];

const WHOLE_NUMBER_PATTERN = /^\d+$/;

function limitFrom(written: string): number {
  const limit = WHOLE_NUMBER_PATTERN.test(written) ? Number(written) : Number.NaN;
  if (!BoardSettingsUtil.concurrencyLimitIsWellFormed(limit) || limit > CONCURRENCY_LIMIT_CEILING_AGENTS) {
    throw new OperationRefusal(
      'refused',
      `"${written}" is not a concurrency limit. Write a whole number of agents from 1 to ${CONCURRENCY_LIMIT_CEILING_AGENTS}.\n  Usage: ${USAGE}`,
    );
  }
  return limit;
}

function printCurrentLimit(commandArguments: ArgumentParser, context: CommandContext): void {
  // Built over progress.json alone, so a broken log or ticket file does not stop this read.
  const concurrency = readingBoardOf(requireProgressFile(requireWorkspace(context.currentDirectory)), [], []).concurrency();
  OutputUtil.printEntity(commandArguments, context, concurrency, String(concurrency.limit));
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

  const { logged, previousLimit, concurrency } = await openTrackerForWriting(commandArguments, context, (change) => change.board.setConcurrencyLimit(limit, change.at));

  const loggedSentence = OutputUtil.loggedSentencesOf(logged);
  OutputUtil.printEntity(
    commandArguments,
    context,
    concurrency,
    `${loggedSentence} (was ${previousLimit}): ${concurrency.agentsInFlight} agents in flight, ${concurrency.freeSlots} free.`,
  );
};

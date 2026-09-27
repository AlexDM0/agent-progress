/** `task add`: files a row, linked to a ticket it works or reviews, and starts it at once with `--start`. */
import { TicketBodyUtil }                        from '../../../src/adapters/utils/TicketBodyUtil.ts';
import { OperationRefusal }                      from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }                   from '../../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                   from '../../arguments/ArgumentParser.ts';
import { OptionValueUtil }                       from '../../utils/OptionValueUtil.ts';
import { OutputUtil }                            from '../../utils/OutputUtil.ts';
import { TASK_USAGE }                            from './TaskArguments.ts';

const ADD_OPTION_NAMES = ['owner', 'note', 'ticket', 'review-of', 'start', 'at', 'tokens', 'force', 'json'];

export async function addOneTask(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ADD_OPTION_NAMES, TASK_USAGE);
  commandArguments.rejectExtraPositionals(2, TASK_USAGE);

  const name = commandArguments.positionals()[1];
  if (name === undefined || name.trim() === '') {
    throw new OperationRefusal('refused', `agent-progress task add needs a name.\n  Usage: ${TASK_USAGE}`);
  }
  const ticketReference   = commandArguments.option('ticket');
  const reviewedReference = commandArguments.option('review-of');
  const owner             = commandArguments.option('owner');
  const note              = commandArguments.option('note');
  const tokens            = OptionValueUtil.tokenCountFrom(commandArguments);
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
      ...(reviewedTicket === undefined ? {} : { reviewOf: { ticketId: reviewedTicket.frontmatter.id, round: TicketBodyUtil.nextReviewRoundOf(reviewedTicket.body) } }),
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

import { TicketJsonUtil }                                               from '../../src/adapters/utils/TicketJsonUtil.ts';
import { OperationRefusal }                                             from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }                                          from '../CommandContext.ts';
import { openTrackerForWriting, openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                                          from '../arguments/ArgumentParser.ts';
import { NextLineUtil }                                                 from '../utils/NextLineUtil.ts';
import { OptionValueUtil }                                              from '../utils/OptionValueUtil.ts';
import { OutputUtil }                                                   from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }                                 from './@types/TicketSubcommandHandler.ts';
import { setTicketDependencies }                                        from './TicketDepends.ts';
import { holdOrUnholdTicket }                                           from './TicketHold.ts';
import { TICKET_USAGE }                                                 from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                                           from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }                                             from './utils/TicketLookupUtil.ts';

const LINK_OPTION_NAMES     = ['force', 'json'];
const PRIORITY_OPTION_NAMES = ['at', 'json'];
const AGENT_OPTION_NAMES    = ['model', 'effort', 'at', 'json'];

async function linkOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(LINK_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(3, TICKET_USAGE);

  const [, ticketReference, taskReference] = commandArguments.positionals();
  if (ticketReference === undefined || taskReference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket link needs a ticket id and a task id.\n  Usage: ${TICKET_USAGE}`);
  }
  const taskId = OptionValueUtil.taskIdOf(taskReference);
  if (taskId === null) {
    throw new OperationRefusal('refused', `"${taskReference}" is not a task id. A task id is the whole number shown beside the row.`);
  }
  const movesTheLink = commandArguments.flag('force');

  const linked = await openTrackerForWriting(
    commandArguments,
    context,
    (change) => change.board.linkTicketToTask(TicketLookupUtil.requireTicket(change, ticketReference).frontmatter.id, taskId, { movesTheLink }),
  );

  OutputUtil.printEntity(commandArguments, context, TicketJsonUtil.ticketAsJson(linked), `Ticket #${linked.frontmatter.id} linked to task #${taskId}`);
}

async function setTicketPriority(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(PRIORITY_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(3, TICKET_USAGE);

  const [, reference, writtenPriority] = commandArguments.positionals();
  if (reference === undefined || writtenPriority === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket priority needs a ticket id and a priority.\n  Usage: ${TICKET_USAGE}`);
  }
  const priority = TicketArgumentUtil.requirePriority(writtenPriority);

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => change.board.setTicketPriority(TicketLookupUtil.requireTicket(change, reference).frontmatter.id, priority, change.at),
  );

  const closingLines = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  OutputUtil.printEntityThenNextLine(commandArguments, context, TicketJsonUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged), closingLines);
}

async function setTicketAgent(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(AGENT_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket agent needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }
  const model  = TicketArgumentUtil.agentModelFrom(commandArguments.option('model'));
  const effort = TicketArgumentUtil.agentEffortFrom(commandArguments.option('effort'));
  if (model === undefined && effort === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket agent needs --model, --effort or both.\n  Usage: ${TICKET_USAGE}`);
  }

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticketId = TicketLookupUtil.requireTicket(change, reference).frontmatter.id;
    return change.board.setTicketAgents(ticketId, {
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    }, change.at);
  });

  const closingLines = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  OutputUtil.printEntityThenNextLine(commandArguments, context, TicketJsonUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged), closingLines);
}

export const TICKET_SETTING_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = {
  link:     linkOneTicket,
  depends:  setTicketDependencies,
  priority: setTicketPriority,
  agent:    setTicketAgent,
  hold:     async (commandArguments, context) => holdOrUnholdTicket(true, commandArguments, context),
  unhold:   async (commandArguments, context) => holdOrUnholdTicket(false, commandArguments, context),
};

import { TicketJsonUtil }                                               from '../../src/adapters/utils/TicketJsonUtil.ts';
import { ControlService }                                               from '../../src/services/control/ControlService.ts';
import type { ControlCommandOf }                                        from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                                             from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                                from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                                          from '../CommandContext.ts';
import { hatchWhenUnderJob }                                            from '../HatchUnderJob.ts';
import { openTrackerForWriting, openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                                          from '../arguments/ArgumentParser.ts';
import { SUBCOMMAND_WITH_TWO_ARGUMENTS_POSITIONAL_COUNT }               from '../arguments/constants/SubcommandPositionalCounts.ts';
import { OptionValueUtil }                                              from '../utils/OptionValueUtil.ts';
import { OutputUtil }                                                   from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }                                 from './@types/TicketSubcommandHandler.ts';
import { setTicketDependencies }                                        from './TicketDepends.ts';
import { setTicketEpics }                                               from './TicketEpic.ts';
import { holdOrUnholdTicket }                                           from './TicketHold.ts';
import { setTicketIntroducedBy }                                        from './TicketIntroducedBy.ts';
import { markOrClearReleaseTicket }                                     from './TicketReleaseMarker.ts';
import { TICKET_USAGE }                                                 from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                                           from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }                                             from './utils/TicketLookupUtil.ts';

const LINK_OPTION_NAMES     = ['force', 'json'];
const PRIORITY_OPTION_NAMES = ['at', 'json'];
const SIZE_OPTION_NAMES     = ['at', 'json'];
const AGENT_OPTION_NAMES  = ['model', 'effort', 'at', 'json'];
const NETWORK_OPTION_NAMES  = ['clear', 'at', 'json'];

async function linkOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(LINK_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(SUBCOMMAND_WITH_TWO_ARGUMENTS_POSITIONAL_COUNT, TICKET_USAGE);

  const [, ticketReference, taskReference] = commandArguments.positionals();
  if (ticketReference === undefined || taskReference === undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket link needs a ticket id and a task id.\n  Usage: ${TICKET_USAGE}`);
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
  commandArguments.rejectExtraPositionals(SUBCOMMAND_WITH_TWO_ARGUMENTS_POSITIONAL_COUNT, TICKET_USAGE);

  const [, reference, writtenPriority] = commandArguments.positionals();
  if (reference === undefined || writtenPriority === undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket priority needs a ticket id and a priority.\n  Usage: ${TICKET_USAGE}`);
  }
  const priority = TicketArgumentUtil.requirePriority(writtenPriority);

  const command: ControlCommandOf<'ticket-priority'> = { kind: 'ticket-priority', ticketReference: reference, priority };
  await hatchWhenUnderJob(context, command);
  const { result: changed, nextLine } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => ControlService.apply(command, change).result,
  );

  OutputUtil.printEntityThenNextLine(commandArguments, context, TicketJsonUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged), nextLine);
}

async function setTicketSize(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(SIZE_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(SUBCOMMAND_WITH_TWO_ARGUMENTS_POSITIONAL_COUNT, TICKET_USAGE);

  const [, reference, writtenSize] = commandArguments.positionals();
  if (reference === undefined || writtenSize === undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket size needs a ticket id and a size.\n  Usage: ${TICKET_USAGE}`);
  }
  const size = TicketArgumentUtil.requireSize(writtenSize);

  const changed = await openTrackerForWriting(
    commandArguments,
    context,
    (change) => change.board.setTicketSize(TicketLookupUtil.requireTicket(change, reference).frontmatter.id, size, change.at),
  );

  OutputUtil.printEntity(commandArguments, context, TicketJsonUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged));
}

async function setTicketAgent(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(AGENT_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket agent needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }
  const model  = TicketArgumentUtil.agentModelFrom(commandArguments.option('model'));
  const effort = TicketArgumentUtil.agentEffortFrom(commandArguments.option('effort'));
  if (model === undefined && effort === undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket agent needs --model, --effort or both.\n  Usage: ${TICKET_USAGE}`);
  }

  const { result: changed, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticketId = TicketLookupUtil.requireTicket(change, reference).frontmatter.id;
    return change.board.setTicketAgents(ticketId, {
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    }, change.at);
  });

  OutputUtil.printEntityThenNextLine(commandArguments, context, TicketJsonUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged), nextLine);
}

/** Bare domains beside `--clear` could mean either, so the two together are refused rather than guessed. */
async function setTicketNetwork(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(NETWORK_OPTION_NAMES, TICKET_USAGE);

  const [, reference, ...domainTexts] = commandArguments.positionals();
  const clears                        = commandArguments.flag('clear');
  if (reference === undefined || (domainTexts.length === 0) === !clears) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket network needs a ticket id, then its domains or --clear, not both.\n  Usage: ${TICKET_USAGE}`);
  }
  const domains = TicketArgumentUtil.networkDomainListFrom(domainTexts);

  const command: ControlCommandOf<'ticket-network'> = { kind: 'ticket-network', ticketReference: reference, domains };
  await hatchWhenUnderJob(context, command);
  const changed = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);

  OutputUtil.printEntity(commandArguments, context, TicketJsonUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged));
}

export const TICKET_SETTING_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = {
  network:         setTicketNetwork,
  link:            linkOneTicket,
  depends:         setTicketDependencies,
  epic:            setTicketEpics,
  'introduced-by': setTicketIntroducedBy,
  priority:        setTicketPriority,
  size:            setTicketSize,
  agent:           setTicketAgent,
  hold:            async (commandArguments, context) => holdOrUnholdTicket(true, commandArguments, context),
  unhold:          async (commandArguments, context) => holdOrUnholdTicket(false, commandArguments, context),
  'release-of':    markOrClearReleaseTicket,
};

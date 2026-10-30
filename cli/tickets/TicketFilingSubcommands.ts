import { TicketJsonUtil }                        from '../../src/adapters/utils/TicketJsonUtil.ts';
import { TICKET_TYPES }                          from '../../src/lib/tracker-model/constants/TicketFields.ts';
import { ControlService }                        from '../../src/services/control/ControlService.ts';
import { requireWorkspace }                      from '../../src/services/tracker/Workspace.ts';
import type { ControlCommandOf }                 from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                      from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                         from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                   from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }                     from '../RelayUnderJob.ts';
import { suppliedMarkdownBodyOf }                from '../SuppliedMarkdownBody.ts';
import type { ArgumentParser }                   from '../arguments/ArgumentParser.ts';
import { OutputUtil }                            from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }          from './@types/TicketSubcommandHandler.ts';
import { TICKET_USAGE }                          from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                    from './utils/TicketArgumentUtil.ts';

const ADD_OPTION_NAMES = [
  'type', 'priority', 'size', 'model', 'effort', 'group', 'depends-on', 'epic', 'network', 'introduced-by', 'found-in-review', 'body', 'body-file', 'at', 'json', 'needs-user',
];

function draftFilingNoteOf(ticketId: string): string {
  return `\nIt is a draft ticket, with no row: \`${PRODUCT_NAMES.PROGRAM} ticket ready ${ticketId}\` readies it to build.`;
}

async function addOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ADD_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const title = commandArguments.positionals()[1];
  if (title === undefined || title.trim() === '') {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket add needs a title.\n  Usage: ${TICKET_USAGE}`);
  }
  if (commandArguments.option('body') !== undefined && commandArguments.option('body-file') !== undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket add takes --body or --body-file, not both.\n  Usage: ${TICKET_USAGE}`);
  }
  const type      = TicketArgumentUtil.ticketTypeFrom(commandArguments.option('type'));
  if (type === undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket add needs --type ${TICKET_TYPES.join('|')}.\n  Usage: ${TICKET_USAGE}`);
  }
  const priority  = TicketArgumentUtil.priorityFrom(commandArguments.option('priority'));
  const size      = TicketArgumentUtil.sizeFrom(commandArguments.option('size'));
  const model     = TicketArgumentUtil.agentModelFrom(commandArguments.option('model'));
  const effort    = TicketArgumentUtil.agentEffortFrom(commandArguments.option('effort'));
  const group     = commandArguments.option('group');
  const dependsOn = TicketArgumentUtil.dependencyListFrom([commandArguments.option('depends-on') ?? '']);
  const epics     = TicketArgumentUtil.epicKeyListFrom([commandArguments.option('epic') ?? '']);
  const network   = TicketArgumentUtil.networkDomainListFrom([commandArguments.option('network') ?? '']);
  const introducedBy  = TicketArgumentUtil.linkedTicketIdFrom(commandArguments.option('introduced-by'));
  const foundInReview = TicketArgumentUtil.linkedTicketIdFrom(commandArguments.option('found-in-review'));

  // Read before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely. The id is not: only the lock hold makes it this ticket's.
  requireWorkspace(context.currentDirectory);
  const suppliedBody = await suppliedMarkdownBodyOf(commandArguments, context);

  const command: ControlCommandOf<'ticket-add'> = {
    kind:     'ticket-add',
    title,
    type,
    ...(priority === undefined ? {} : { priority }),
    ...(size === undefined ? {} : { size }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(group === undefined ? {} : { group }),
    dependsOn,
    epics,
    network,
    introducedBy,
    foundInReview,
    bodyText: suppliedBody ?? null,
    ...(commandArguments.flag('needs-user') ? { needsUser: true as const } : {}),
  };
  await relayWhenUnderJob(context, command);
  const { result: filed, nextLine } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => ControlService.apply(command, change).result,
  );

  OutputUtil.printEntityThenNextLine(
    commandArguments,
    context,
    TicketJsonUtil.ticketAsJson(filed.ticket),
    `${OutputUtil.loggedSentencesOf(filed.logged)}${draftFilingNoteOf(filed.ticket.frontmatter.id)}\n  ${filed.ticket.filePath}`,
    nextLine,
  );
}

export const TICKET_FILING_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = { add: addOneTicket };

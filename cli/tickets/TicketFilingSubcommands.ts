import { readFileSync } from 'node:fs';

import { TicketJsonUtil }                        from '../../src/adapters/utils/TicketJsonUtil.ts';
import { TICKET_TYPES }                          from '../../src/lib/tracker-model/constants/TicketFields.ts';
import { createTicket }                          from '../../src/services/tracker/TicketStore.ts';
import { requireWorkspace }                      from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                      from '../../src/shared/OperationRefusal.ts';
import { resourceFilePathOf }                    from '../../src/shared/ResourceFilePath.ts';
import { PRODUCT_NAMES }                         from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                   from '../CommandContext.ts';
import { filledTemplateOf }                      from '../FilledTemplate.ts';
import { openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import { suppliedMarkdownBodyOf }                from '../SuppliedMarkdownBody.ts';
import type { ArgumentParser }                   from '../arguments/ArgumentParser.ts';
import { NextLineUtil }                          from '../utils/NextLineUtil.ts';
import { OutputUtil }                            from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }          from './@types/TicketSubcommandHandler.ts';
import { TICKET_USAGE }                          from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                    from './utils/TicketArgumentUtil.ts';

const ADD_OPTION_NAMES = ['type', 'priority', 'size', 'model', 'effort', 'group', 'depends-on', 'epic', 'introduced-by', 'found-in-review', 'body', 'body-file', 'at', 'json'];

const TICKET_BODY_TEMPLATE_PATH = ['templates', 'TicketBody.md'];

function bodyForNewTicket(suppliedBody: string | undefined, ticketId: string, title: string): string {
  if (suppliedBody !== undefined && suppliedBody.trim() !== '') return suppliedBody;

  return filledTemplateOf(readFileSync(resourceFilePathOf(...TICKET_BODY_TEMPLATE_PATH), 'utf8'), { id: ticketId, title });
}

const LOW_PRIORITY_FILING_NOTE = ' (low priority: no row until it is started)';

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
  const introducedBy  = TicketArgumentUtil.linkedTicketIdFrom(commandArguments.option('introduced-by'));
  const foundInReview = TicketArgumentUtil.linkedTicketIdFrom(commandArguments.option('found-in-review'));

  // Read before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely. The id is not: only the lock hold makes it this ticket's.
  requireWorkspace(context.currentDirectory);
  const suppliedBody = await suppliedMarkdownBodyOf(commandArguments, context);

  const { result: filed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticket = createTicket(change.workspace, {
      title,
      type,
      ...(priority === undefined ? {} : { priority }),
      ...(group === undefined ? {} : { group }),
      bodyFor: (ticketId) => bodyForNewTicket(suppliedBody, ticketId, title),
      at:      change.at,
    });
    if (dependsOn.length > 0) ticket.frontmatter.dependsOn = dependsOn;
    if (epics.length > 0) ticket.frontmatter.epics = epics;
    if (introducedBy !== null) ticket.frontmatter.introducedBy = introducedBy;
    if (foundInReview !== null) ticket.frontmatter.foundInReview = foundInReview;
    if (size !== undefined) ticket.frontmatter.size = size;
    if (model !== undefined) ticket.frontmatter.model = model;
    if (effort !== undefined) ticket.frontmatter.effort = effort;
    return change.board.fileTicket(ticket, change.at);
  });

  OutputUtil.printEntityThenNextLine(
    commandArguments,
    context,
    TicketJsonUtil.ticketAsJson(filed.ticket),
    `${OutputUtil.loggedSentencesOf(filed.logged)}${priority === 'low' ? LOW_PRIORITY_FILING_NOTE : ''}\n  ${filed.ticket.filePath}`,
    NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState),
  );
}

export const TICKET_FILING_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = { add: addOneTicket };

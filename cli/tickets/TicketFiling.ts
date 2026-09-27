import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';

import { StatusWordingUtil }                     from '../../src/adapters/utils/StatusWordingUtil.ts';
import type { TicketType }                       from '../../src/lib/tracker-model/@types/Ticket.ts';
import { createTicket }                          from '../../src/services/tracker/TicketStore.ts';
import { requireWorkspace }                      from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                      from '../../src/shared/OperationRefusal.ts';
import { resourceFilePathOf }                    from '../../src/shared/ResourceFilePath.ts';
import type { CommandContext }                   from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../TrackerWriting.ts';
import type { ArgumentParser }                   from '../arguments/ArgumentParser.ts';
import { NextLineUtil }                          from '../utils/NextLineUtil.ts';
import { OutputUtil }                            from '../utils/OutputUtil.ts';
import { TemplatePlaceholderUtil }               from '../utils/TemplatePlaceholderUtil.ts';
import type { TicketSubcommandHandler }          from './@types/TicketSubcommandHandler.ts';
import { TICKET_USAGE }                          from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                    from './utils/TicketArgumentUtil.ts';
import { TicketOutputUtil }                      from './utils/TicketOutputUtil.ts';

const ADD_OPTION_NAMES = ['type', 'priority', 'model', 'effort', 'group', 'depends-on', 'body', 'body-file', 'at', 'json'];

const DEFAULT_TICKET_TYPE: TicketType = 'change';

const STANDARD_INPUT_MARKER = '-';

const TICKET_BODY_TEMPLATE_PATH = ['templates', 'TicketBody.md'];

function bodyForNewTicket(suppliedBody: string | undefined, ticketId: string, title: string): string {
  if (suppliedBody !== undefined && suppliedBody.trim() !== '') return suppliedBody;

  return TemplatePlaceholderUtil.filledTemplateOf(readFileSync(resourceFilePathOf(...TICKET_BODY_TEMPLATE_PATH), 'utf8'), { id: ticketId, title });
}

async function suppliedBodyFor(commandArguments: ArgumentParser, context: CommandContext): Promise<string | undefined> {
  const written = commandArguments.option('body');
  if (written !== undefined) return written;

  const bodyFile = commandArguments.option('body-file');
  if (bodyFile === STANDARD_INPUT_MARKER) return context.readStandardInput();
  if (bodyFile === undefined) return undefined;
  try {
    return readFileSync(resolve(context.currentDirectory, bodyFile), 'utf8');
  } catch (problem) {
    throw new OperationRefusal('refused', `--body-file ${bodyFile} could not be read: ${problem instanceof Error ? problem.message : String(problem)}`);
  }
}

function lowPriorityFilingNote(): string {
  return ` (${StatusWordingUtil.priorityWordFor('low')} priority: no row until it is started)`;
}

async function addOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ADD_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const title = commandArguments.positionals()[1];
  if (title === undefined || title.trim() === '') {
    throw new OperationRefusal('refused', `agent-progress ticket add needs a title.\n  Usage: ${TICKET_USAGE}`);
  }
  const type      = TicketArgumentUtil.ticketTypeFrom(commandArguments.option('type')) ?? DEFAULT_TICKET_TYPE;
  const priority  = TicketArgumentUtil.priorityFrom(commandArguments.option('priority'));
  const model     = TicketArgumentUtil.agentModelFrom(commandArguments.option('model'));
  const effort    = TicketArgumentUtil.agentEffortFrom(commandArguments.option('effort'));
  const group     = commandArguments.option('group');
  const dependsOn = TicketArgumentUtil.dependencyListFrom([commandArguments.option('depends-on') ?? '']);

  // Read before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely. The id is not: only the lock hold makes it this ticket's.
  requireWorkspace(context.currentDirectory);
  const suppliedBody = await suppliedBodyFor(commandArguments, context);

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
    if (model !== undefined) ticket.frontmatter.model = model;
    if (effort !== undefined) ticket.frontmatter.effort = effort;
    return change.board.fileTicket(ticket, change.at);
  });

  OutputUtil.printEntityThenNextLine(
    commandArguments,
    context,
    TicketOutputUtil.ticketAsJson(filed.ticket),
    `${TicketOutputUtil.loggedSentencesOf(filed.logged)}${priority === 'low' ? lowPriorityFilingNote() : ''}\n  ${filed.ticket.filePath}`,
    NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState),
  );
}

export const TICKET_FILING_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = { add: addOneTicket };

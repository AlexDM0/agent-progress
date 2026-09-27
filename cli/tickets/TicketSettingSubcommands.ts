import { StatusWordingUtil }                                            from '../../src/adapters/utils/StatusWordingUtil.ts';
import type { Task }                                                    from '../../src/lib/tracker-model/@types/Task.ts';
import { OperationRefusal }                                             from '../../src/shared/OperationRefusal.ts';
import { DispatcherClaimNoteUtil }                                      from '../../src/shared/utils/DispatcherClaimNoteUtil.ts';
import type { CommandContext }                                          from '../CommandContext.ts';
import { openTrackerForWriting, openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                                          from '../arguments/ArgumentParser.ts';
import { NextLineUtil }                                                 from '../utils/NextLineUtil.ts';
import { OptionValueUtil }                                              from '../utils/OptionValueUtil.ts';
import { OutputUtil }                                                   from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }                                 from './@types/TicketSubcommandHandler.ts';
import { TICKET_USAGE }                                                 from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                                           from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }                                             from './utils/TicketLookupUtil.ts';
import { TicketOutputUtil }                                             from './utils/TicketOutputUtil.ts';

const LINK_OPTION_NAMES     = ['force', 'json'];
const DEPENDS_OPTION_NAMES  = ['json'];
const PRIORITY_OPTION_NAMES = ['at', 'json'];
const AGENT_OPTION_NAMES    = ['model', 'effort', 'at', 'json'];
const HOLD_OPTION_NAMES     = ['reason', 'at', 'json'];
const UNHOLD_OPTION_NAMES   = ['at', 'json'];

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

  OutputUtil.printEntity(commandArguments, context, TicketOutputUtil.ticketAsJson(linked), `Ticket #${linked.frontmatter.id} linked to task #${taskId}`);
}

async function setTicketDependencies(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(DEPENDS_OPTION_NAMES, TICKET_USAGE);

  const [, reference, ...dependencyTexts] = commandArguments.positionals();
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket depends needs a ticket id, then the ids it waits on (none clears the list).\n  Usage: ${TICKET_USAGE}`);
  }
  const dependsOn = TicketArgumentUtil.dependencyListFrom(dependencyTexts);

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => change.board.setTicketDependencies(TicketLookupUtil.requireTicket(change, reference).frontmatter.id, dependsOn, change.at),
  );

  const closingLines = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  OutputUtil.printEntityThenNextLine(commandArguments, context, TicketOutputUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged), closingLines);
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
  OutputUtil.printEntityThenNextLine(commandArguments, context, TicketOutputUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged), closingLines);
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
  OutputUtil.printEntityThenNextLine(commandArguments, context, TicketOutputUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged), closingLines);
}

// Every dispatcher run's builder takes over only a row paused under a dispatcher claim note; any other pause is a person's, resumed by hand.
function resumeBuildHintFor(ticketId: string, pausedRow: Readonly<Task>): string {
  const pausedWord = StatusWordingUtil.statusWordFor('paused');
  if (!DispatcherClaimNoteUtil.noteIsADispatcherClaimOn(pausedRow.note, ticketId)) {
    return `Its build row #${pausedRow.id} was left ${pausedWord} under a person's note, which the dispatcher never takes over: `
      + `resume it with \`agent-progress task start ${pausedRow.id}\`, or settle the row by hand.`;
  }
  const singleTicketRun = `launch a single-ticket dispatcher run for #${ticketId} (ticketIds: ["${ticketId}"]) to resume it`;
  return `Its build was left ${pausedWord}: the next whole-board dispatcher run resumes it; when none is going or about to be launched, ${singleTicketRun} now.`;
}

/** A hold stops the dispatcher starting the ticket's next builder or reviewer; an agent already running is never interrupted by it. */
async function holdOrUnholdTicket(holds: boolean, commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const verb = holds ? 'hold' : 'unhold';
  commandArguments.rejectUnknownOptions(holds ? HOLD_OPTION_NAMES : UNHOLD_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket ${verb} needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }
  const reason = commandArguments.option('reason') ?? '';

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const { board } = change;
    const ticketId  = TicketLookupUtil.requireTicket(change, reference).frontmatter.id;
    if (holds) return { holdChange: board.holdTicket(ticketId, reason, change.at), resumeBuildHint: null };
    const holdChange = board.unholdTicket(ticketId, change.at);
    const pausedRow  = board.pausedBuildRowOf(ticketId);
    return { holdChange, resumeBuildHint: pausedRow === null ? null : resumeBuildHintFor(ticketId, pausedRow) };
  });

  const { holdChange, resumeBuildHint } = changed;
  const endedNextLine                   = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  const closingLines                    = resumeBuildHint === null ? endedNextLine : `${endedNextLine}\n${resumeBuildHint}`;
  OutputUtil.printEntityThenNextLine(
    commandArguments,
    context,
    TicketOutputUtil.ticketAsJson(holdChange.ticket),
    OutputUtil.loggedSentencesOf(holdChange.logged),
    closingLines,
  );
}

export const TICKET_SETTING_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = {
  link:     linkOneTicket,
  depends:  setTicketDependencies,
  priority: setTicketPriority,
  agent:    setTicketAgent,
  hold:     async (commandArguments, context) => holdOrUnholdTicket(true, commandArguments, context),
  unhold:   async (commandArguments, context) => holdOrUnholdTicket(false, commandArguments, context),
};

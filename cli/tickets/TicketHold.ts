/** `ticket hold` and `ticket unhold`, and the hint an unhold prints about a build it left paused. */
import type { Task }                             from '../../src/lib/tracker-model/@types/Task.ts';
import { OperationRefusal }                      from '../../src/shared/OperationRefusal.ts';
import { DispatcherClaimNoteUtil }               from '../../src/shared/utils/DispatcherClaimNoteUtil.ts';
import type { CommandContext }                   from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                   from '../arguments/ArgumentParser.ts';
import { NextLineUtil }                          from '../utils/NextLineUtil.ts';
import { OutputUtil }                            from '../utils/OutputUtil.ts';
import { TICKET_USAGE }                          from './constants/TicketUsage.ts';
import { TicketLookupUtil }                      from './utils/TicketLookupUtil.ts';
import { TicketOutputUtil }                      from './utils/TicketOutputUtil.ts';

const HOLD_OPTION_NAMES   = ['reason', 'at', 'json'];
const UNHOLD_OPTION_NAMES = ['at', 'json'];

// Every dispatcher run's builder takes over only a row paused under a dispatcher claim note; any other pause is a person's, resumed by hand.
function resumeBuildHintFor(ticketId: string, pausedRow: Readonly<Task>): string {
  if (!DispatcherClaimNoteUtil.noteIsADispatcherClaimOn(pausedRow.note, ticketId)) {
    return `Its build row #${pausedRow.id} was left paused under a person's note, which the dispatcher never takes over: `
      + `resume it with \`agent-progress task start ${pausedRow.id}\`, or settle the row by hand.`;
  }
  const singleTicketRun = `launch a single-ticket dispatcher run for #${ticketId} (ticketIds: ["${ticketId}"]) to resume it`;
  return `Its build was left paused: the next whole-board dispatcher run resumes it; when none is going or about to be launched, ${singleTicketRun} now.`;
}

/** A hold stops the dispatcher starting the ticket's next builder or reviewer; an agent already running is never interrupted by it. */
export async function holdOrUnholdTicket(holds: boolean, commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
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

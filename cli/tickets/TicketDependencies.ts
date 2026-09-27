/** `ticket depends`: replaces, adds to or removes from the list of tickets one waits on, and says which open dependency it dropped. */
import { TicketJsonUtil }                        from '../../src/adapters/utils/TicketJsonUtil.ts';
import { TicketPhraseUtil }                      from '../../src/adapters/utils/TicketPhraseUtil.ts';
import type { TicketDependenciesChanged }        from '../../src/lib/tracker-model/@types/BoardChanges.ts';
import { OperationRefusal }                      from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }                   from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                   from '../arguments/ArgumentParser.ts';
import { NextLineUtil }                          from '../utils/NextLineUtil.ts';
import { OutputUtil }                            from '../utils/OutputUtil.ts';
import { TICKET_USAGE }                          from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                    from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }                      from './utils/TicketLookupUtil.ts';

const DEPENDS_OPTION_NAMES = ['add', 'remove', 'json'];

type DependencyEdit = { kind: 'replace' | 'add' | 'remove'; ticketIds: string[] };

/** Bare ids beside `--add` or `--remove` could mean either list, and `--add 3 4` reads the 4 as bare, so both are refused rather than guessed. */
function dependencyEditFrom(commandArguments: ArgumentParser, dependencyTexts: readonly string[]): DependencyEdit {
  const addedText   = commandArguments.option('add');
  const removedText = commandArguments.option('remove');
  if (addedText !== undefined && removedText !== undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket depends takes --add or --remove, not both: run it once for each.\n  Usage: ${TICKET_USAGE}`);
  }
  const editedText = addedText ?? removedText;
  if (editedText === undefined) return { kind: 'replace', ticketIds: TicketArgumentUtil.dependencyListFrom(dependencyTexts) };
  const optionToken = addedText === undefined ? '--remove' : '--add';
  if (dependencyTexts.length > 0) {
    throw new OperationRefusal(
      'refused',
      `agent-progress ticket depends was given ${optionToken} and bare ids, which is ambiguous: `
      + `list every id in the option, as \`${optionToken} 3,4\`, or give bare ids alone to replace the list.\n  Usage: ${TICKET_USAGE}`,
    );
  }
  return { kind: addedText === undefined ? 'remove' : 'add', ticketIds: TicketArgumentUtil.dependencyListFrom([editedText]) };
}

function droppedDependencyLinesOf(ticketId: string, changed: TicketDependenciesChanged): string[] {
  return changed.droppedUnsettledTicketIds.map((droppedId) => `#${droppedId} is still open: #${ticketId} may now start before it`);
}

export async function setTicketDependencies(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(DEPENDS_OPTION_NAMES, TICKET_USAGE);

  const [, reference, ...dependencyTexts] = commandArguments.positionals();
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket depends needs a ticket id, then the ids it waits on (none clears the list).\n  Usage: ${TICKET_USAGE}`);
  }
  const edit = dependencyEditFrom(commandArguments, dependencyTexts);

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticketId = TicketLookupUtil.requireTicket(change, reference).frontmatter.id;
    if (edit.kind === 'add') return change.board.addTicketDependencies(ticketId, edit.ticketIds, change.at);
    if (edit.kind === 'remove') return change.board.removeTicketDependencies(ticketId, edit.ticketIds, change.at);
    return change.board.setTicketDependencies(ticketId, edit.ticketIds, change.at);
  });

  const ticketId      = changed.ticket.frontmatter.id;
  const droppedSuffix = changed.droppedTicketIds.length === 0 ? '' : ` (dropped ${TicketPhraseUtil.ticketReferencesText(changed.droppedTicketIds)})`;
  const humanLines    = [`${OutputUtil.loggedSentencesOf(changed.logged)}${droppedSuffix}`, ...droppedDependencyLinesOf(ticketId, changed)].join('\n');
  const entity        = { ...TicketJsonUtil.ticketAsJson(changed.ticket), added: changed.addedTicketIds, dropped: changed.droppedTicketIds };
  OutputUtil.printEntityThenNextLine(commandArguments, context, entity, humanLines, NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState));
}

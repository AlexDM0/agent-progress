/** `ticket depends`: replaces, adds to or removes from the list of tickets one waits on, and says which open dependency it dropped. */
import { TicketJsonUtil }                        from '../../src/adapters/utils/TicketJsonUtil.ts';
import { TicketPhraseUtil }                      from '../../src/adapters/utils/TicketPhraseUtil.ts';
import type { TicketDependenciesChanged }        from '../../src/lib/tracker-model/@types/BoardChanges.ts';
import { ControlService }                        from '../../src/services/control/ControlService.ts';
import type { ControlCommandOf, ListEdit }       from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                      from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                         from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                   from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }                     from '../RelayUnderJob.ts';
import type { ArgumentParser }                   from '../arguments/ArgumentParser.ts';
import { OutputUtil }                            from '../utils/OutputUtil.ts';
import { TICKET_USAGE }                          from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                    from './utils/TicketArgumentUtil.ts';

const DEPENDS_OPTION_NAMES = ['add', 'remove', 'json'];

type DependencyEdit = { kind: ListEdit; ticketIds: string[] };

/** Bare ids beside `--add` or `--remove` could mean either list, and `--add 3 4` reads the 4 as bare, so both are refused rather than guessed. */
function dependencyEditFrom(commandArguments: ArgumentParser, dependencyTexts: readonly string[]): DependencyEdit {
  const addedText   = commandArguments.option('add');
  const removedText = commandArguments.option('remove');
  if (addedText !== undefined && removedText !== undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket depends takes --add or --remove, not both: run it once for each.\n  Usage: ${TICKET_USAGE}`);
  }
  const editedText = addedText ?? removedText;
  if (editedText === undefined) return { kind: 'replace', ticketIds: TicketArgumentUtil.dependencyListFrom(dependencyTexts) };
  const optionToken = addedText === undefined ? '--remove' : '--add';
  if (dependencyTexts.length > 0) {
    throw new OperationRefusal(
      'refused',
      `${PRODUCT_NAMES.PROGRAM} ticket depends was given ${optionToken} and bare ids, which is ambiguous: `
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
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket depends needs a ticket id, then the ids it waits on (none clears the list).\n  Usage: ${TICKET_USAGE}`);
  }
  const edit = dependencyEditFrom(commandArguments, dependencyTexts);

  const command: ControlCommandOf<'ticket-depends'> = {
    kind: 'ticket-depends', ticketReference: reference, edit: edit.kind, ticketIds: edit.ticketIds
  };
  await relayWhenUnderJob(context, command);
  const { result: changed, nextLine } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => ControlService.apply(command, change).result,
  );

  const ticketId      = changed.ticket.frontmatter.id;
  const droppedSuffix = changed.droppedTicketIds.length === 0 ? '' : ` (dropped ${TicketPhraseUtil.ticketReferencesText(changed.droppedTicketIds)})`;
  const humanLines    = [`${OutputUtil.loggedSentencesOf(changed.logged)}${droppedSuffix}`, ...droppedDependencyLinesOf(ticketId, changed)].join('\n');
  const entity        = { ...TicketJsonUtil.ticketAsJson(changed.ticket), added: changed.addedTicketIds, dropped: changed.droppedTicketIds };
  OutputUtil.printEntityThenNextLine(commandArguments, context, entity, humanLines, nextLine);
}

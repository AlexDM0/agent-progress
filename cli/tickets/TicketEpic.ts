/** `ticket epic`: replaces, adds to or removes from the epics a ticket belongs to, mirroring `ticket depends`; the first key is its primary epic. */
import { TicketJsonUtil }        from '../../src/adapters/utils/TicketJsonUtil.ts';
import { OperationRefusal }      from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }   from '../CommandContext.ts';
import { openTrackerForWriting } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }   from '../arguments/ArgumentParser.ts';
import { OutputUtil }            from '../utils/OutputUtil.ts';
import { TICKET_USAGE }          from './constants/TicketUsage.ts';
import { TicketArgumentUtil }    from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }      from './utils/TicketLookupUtil.ts';

const EPIC_OPTION_NAMES = ['add', 'remove', 'at', 'json'];

type EpicListEdit = { kind: 'replace' | 'add' | 'remove'; epicKeys: string[] };

/** Bare keys beside `--add` or `--remove` could mean either list, so both are refused rather than guessed, as `ticket depends` does. */
function epicListEditFrom(commandArguments: ArgumentParser, epicKeyTexts: readonly string[]): EpicListEdit {
  const addedText   = commandArguments.option('add');
  const removedText = commandArguments.option('remove');
  if (addedText !== undefined && removedText !== undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket epic takes --add or --remove, not both: run it once for each.\n  Usage: ${TICKET_USAGE}`);
  }
  const editedText = addedText ?? removedText;
  if (editedText === undefined) return { kind: 'replace', epicKeys: TicketArgumentUtil.epicKeyListFrom(epicKeyTexts) };
  const optionToken = addedText === undefined ? '--remove' : '--add';
  if (epicKeyTexts.length > 0) {
    throw new OperationRefusal(
      'refused',
      `agent-progress ticket epic was given ${optionToken} and bare keys, which is ambiguous: `
      + `list every key in the option, as \`${optionToken} checkout-redesign,loyalty-programme\`, or give bare keys alone to replace the list.\n  Usage: ${TICKET_USAGE}`,
    );
  }
  return { kind: addedText === undefined ? 'remove' : 'add', epicKeys: TicketArgumentUtil.epicKeyListFrom([editedText]) };
}

export async function setTicketEpics(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(EPIC_OPTION_NAMES, TICKET_USAGE);

  const [, reference, ...epicKeyTexts] = commandArguments.positionals();
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket epic needs a ticket id, then the keys of its epics (none clears the list).\n  Usage: ${TICKET_USAGE}`);
  }
  const edit = epicListEditFrom(commandArguments, epicKeyTexts);

  const changed = await openTrackerForWriting(commandArguments, context, (change) => {
    const ticketId = TicketLookupUtil.requireTicket(change, reference).frontmatter.id;
    if (edit.kind === 'add') return change.board.addTicketEpics(ticketId, edit.epicKeys, change.at);
    if (edit.kind === 'remove') return change.board.removeTicketEpics(ticketId, edit.epicKeys, change.at);
    return change.board.setTicketEpics(ticketId, edit.epicKeys, change.at);
  });

  const droppedSuffix = changed.droppedEpicKeys.length === 0 ? '' : ` (dropped ${changed.droppedEpicKeys.join(', ')})`;
  const entity        = { ...TicketJsonUtil.ticketAsJson(changed.ticket), added: changed.addedEpicKeys, dropped: changed.droppedEpicKeys };
  OutputUtil.printEntity(commandArguments, context, entity, `${OutputUtil.loggedSentencesOf(changed.logged)}${droppedSuffix}`);
}

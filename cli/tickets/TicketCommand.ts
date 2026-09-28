import { OperationRefusal }             from '../../src/shared/OperationRefusal.ts';
import type { CommandHandler }          from '../CommandHandler.ts';
import type { TicketSubcommandHandler } from './@types/TicketSubcommandHandler.ts';
import { TICKET_CLAIM_SUBCOMMANDS }     from './TicketClaimSubcommands.ts';
import { editTicketBody }               from './TicketEdit.ts';
import { TICKET_FILING_SUBCOMMANDS }    from './TicketFilingSubcommands.ts';
import { TICKET_MOVE_SUBCOMMANDS }      from './TicketMoveSubcommands.ts';
import { TICKET_READING_SUBCOMMANDS }   from './TicketReadingSubcommands.ts';
import { TICKET_SETTING_SUBCOMMANDS }   from './TicketSettingSubcommands.ts';
import { TICKET_USAGE }                 from './constants/TicketUsage.ts';

const TICKET_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = Object.freeze({
  ...TICKET_FILING_SUBCOMMANDS,
  ...TICKET_READING_SUBCOMMANDS,
  ...TICKET_MOVE_SUBCOMMANDS,
  ...TICKET_CLAIM_SUBCOMMANDS,
  ...TICKET_SETTING_SUBCOMMANDS,
  edit: editTicketBody,
});

export const ticketCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  // `Object.hasOwn`, never a bare index: `subcommand` is argv text, and `constructor` is a truthy inherited property.
  const handler = subcommand !== undefined && Object.hasOwn(TICKET_SUBCOMMANDS, subcommand) ? TICKET_SUBCOMMANDS[subcommand] : undefined;
  if (subcommand !== undefined && handler !== undefined) return handler(commandArguments, context, subcommand);

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress ticket needs a subcommand' : `"${subcommand}" is not an agent-progress ticket subcommand`}.\n  Usage: ${TICKET_USAGE}`,
  );
};

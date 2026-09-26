import { OperationRefusal }             from '../../src/shared/OperationRefusal';
import type { CommandHandler }          from '../CommandTable';
import { RetiredWordRefusalUtil }       from '../legacy/utils/RetiredWordRefusalUtil';
import type { TicketSubcommandHandler } from './@types/TicketSubcommandHandler';
import { TICKET_CLAIM_SUBCOMMANDS }     from './TicketClaims';
import { TICKET_FILING_SUBCOMMANDS }    from './TicketFiling';
import { TICKET_MOVE_SUBCOMMANDS }      from './TicketMoves';
import { TICKET_READING_SUBCOMMANDS }   from './TicketReading';
import { TICKET_SETTING_SUBCOMMANDS }   from './TicketSettings';
import { TICKET_USAGE }                 from './constants/TicketUsage';

const TICKET_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = Object.freeze({
  ...TICKET_FILING_SUBCOMMANDS,
  ...TICKET_READING_SUBCOMMANDS,
  ...TICKET_MOVE_SUBCOMMANDS,
  ...TICKET_CLAIM_SUBCOMMANDS,
  ...TICKET_SETTING_SUBCOMMANDS,
});

export const ticketCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  // `Object.hasOwn`, never a bare index: `subcommand` is argv text, and `constructor` is a truthy inherited property.
  const handler = subcommand !== undefined && Object.hasOwn(TICKET_SUBCOMMANDS, subcommand) ? TICKET_SUBCOMMANDS[subcommand] : undefined;
  if (subcommand !== undefined && handler !== undefined) return handler(commandArguments, context, subcommand);
  // The seam to the retired verbs; dropping `cli/legacy/` leaves only the unknown-subcommand refusal below.
  if (subcommand !== undefined) RetiredWordRefusalUtil.refuseARetiredTicketVerb(subcommand, commandArguments);

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress ticket needs a subcommand' : `"${subcommand}" is not an agent-progress ticket subcommand`}.\n  Usage: ${TICKET_USAGE}`,
  );
};

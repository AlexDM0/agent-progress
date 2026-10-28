/**
 * `ticket park <id> [--incident <I>] -- <reason>`: holds the ticket `parked:<kind>` and opens a `parked` decision to User, the reason
 * being what User should know; under an incident it also stops the job waiting on it.
 */
import { ControlService }               from '../../src/services/control/ControlService.ts';
import type { ControlCommandOf }        from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }             from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                from '../../src/shared/constants/ProductNames.ts';
import { openTrackerForWriting }        from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }            from '../RelayUnderJob.ts';
import { OutputUtil }                   from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler } from './@types/TicketSubcommandHandler.ts';
import { TICKET_USAGE }                 from './constants/TicketUsage.ts';

export const parkTicket: TicketSubcommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['at', 'json', 'incident'], TICKET_USAGE);
  const [, ticketReference, ...extra] = commandArguments.positionalsBeforeSeparator();
  const reason = commandArguments.positionals().slice(2 + extra.length).join(' ').trim();
  if (ticketReference === undefined || extra.length > 0 || reason === '') {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket park needs a ticket id, then what User should know after --.\n  Usage: ${TICKET_USAGE}`);
  }
  const incidentId = commandArguments.option('incident')?.toUpperCase();
  const command: ControlCommandOf<'ticket-park'> = {
    kind: 'ticket-park', ticketReference, reason, ...(incidentId === undefined ? {} : { incidentId })
  };
  await relayWhenUnderJob(context, command);
  const { logged } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  OutputUtil.printEntity(commandArguments, context, { command, logged }, OutputUtil.loggedSentencesOf(logged));
};

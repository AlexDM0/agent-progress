/** `ticket triage <id>...`: findings go to User's low-priority triage (`findingRoute: user`), all in one hold; `--incident` names the move's incident. */
import { ControlService }               from '../../src/services/control/ControlService.ts';
import type { ControlCommandOf }        from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }             from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                from '../../src/shared/constants/ProductNames.ts';
import { hatchWhenUnderJob }            from '../HatchUnderJob.ts';
import { openTrackerForWriting }        from '../OpenTrackerForWriting.ts';
import { OutputUtil }                   from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler } from './@types/TicketSubcommandHandler.ts';
import { TICKET_USAGE }                 from './constants/TicketUsage.ts';

export const triageTickets: TicketSubcommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['at', 'json', 'incident'], TICKET_USAGE);
  const ticketReferences = commandArguments.positionals().slice(1);
  if (ticketReferences.length === 0) throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket triage needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  const incidentId = commandArguments.option('incident')?.toUpperCase();
  const command: ControlCommandOf<'ticket-triage'> = { kind: 'ticket-triage', ticketReferences, ...(incidentId === undefined ? {} : { incidentId }) };
  await hatchWhenUnderJob(context, command);
  const { logged } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  OutputUtil.printEntity(commandArguments, context, { command, logged }, OutputUtil.loggedSentencesOf(logged));
};

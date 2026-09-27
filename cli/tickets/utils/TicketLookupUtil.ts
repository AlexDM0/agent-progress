import { basename } from 'node:path';

import type { Ticket }              from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketIdUtil }             from '../../../src/lib/tracker-model/utils/TicketIdUtil.ts';
import type { MalformedTicketFile } from '../../../src/services/tracker/TicketStore.ts';
import type { TrackerChange }       from '../../../src/services/tracker/TrackerPipeline.ts';
import { OperationRefusal }         from '../../../src/shared/OperationRefusal.ts';
import { OutputUtil }               from '../../utils/OutputUtil.ts';

function malformedFileOfTicket(malformedTickets: readonly MalformedTicketFile[], reference: string): MalformedTicketFile | undefined {
  const identifier = TicketIdUtil.parseTicketReference(reference);
  if (identifier === null) return undefined;
  return malformedTickets.find(({ filePath }) => {
    const fileName = basename(filePath);
    return fileName.startsWith(`${identifier}-`) || fileName === `${identifier}.md`;
  });
}

/** A ticket file that is there and will not parse is exit 2: the tool will not repair a hand edit, and a missing ticket is the caller's to fix. */
function refuseAMissingTicket(reference: string, malformedTickets: readonly MalformedTicketFile[]): never {
  const malformed = malformedFileOfTicket(malformedTickets, reference);
  if (malformed !== undefined) throw new OperationRefusal('unrepaired', OutputUtil.ignoredTicketFileText(malformed));
  throw new OperationRefusal(
    'refused',
    `There is no readable ticket ${reference}. Run \`agent-progress ticket list\` to see what this tracker holds; `
    + 'a file that will not parse is reported there as malformed.',
  );
}

function requireTicket(change: Pick<TrackerChange, 'board' | 'malformedTickets'>, reference: string): Ticket {
  return change.board.ticketByReference(reference) ?? refuseAMissingTicket(reference, change.malformedTickets);
}

export const TicketLookupUtil = { requireTicket, refuseAMissingTicket } as const;

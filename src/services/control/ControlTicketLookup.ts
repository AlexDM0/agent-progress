/**
 * A command's ticket reference resolved inside the hold: `3`, `003` and `#3` name one ticket. A reference with no ticket is refused, while
 * a file of that id that will not parse is unrepaired, a hand edit the tool will not repair; both leave as wordless details.
 */
import { basename } from 'node:path';

import { TicketIdUtil }       from '../../lib/tracker-model/utils/TicketIdUtil.ts';
import { OperationRefusal }   from '../../shared/OperationRefusal.ts';
import type { TrackerChange } from '../tracker/TrackerPipeline.ts';

function malformedFileNamedBy(change: Pick<TrackerChange, 'malformedTickets'>, reference: string): TrackerChange['malformedTickets'][number] | undefined {
  const identifier = TicketIdUtil.parseTicketReference(reference);
  if (identifier === null) return undefined;
  return change.malformedTickets.find(({ filePath }) => {
    const fileName = basename(filePath);
    return fileName.startsWith(`${identifier}-`) || fileName === `${identifier}.md`;
  });
}

export function ticketIdOfReference(change: Pick<TrackerChange, 'board' | 'malformedTickets'>, reference: string): string {
  const ticket = change.board.ticketByReference(reference);
  if (ticket !== undefined) return ticket.frontmatter.id;
  const malformed = malformedFileNamedBy(change, reference);
  if (malformed !== undefined) {
    throw new OperationRefusal('unrepaired', {
      kind: 'malformed-ticket-file', filePath: malformed.filePath, line: malformed.line, reason: malformed.reason
    });
  }
  throw new OperationRefusal('refused', { kind: 'no-readable-ticket', reference });
}

/** How an epic prints: its JSON document, its one-line listing entry and its `epic show` summary, all with its roll-up. */
import { TokenCountUtil }        from '../../src/lib/token-count/TokenCountUtil.ts';
import type { Epic, EpicRollup } from '../../src/lib/tracker-model/@types/Epic.ts';
import { TICKET_STATUSES }       from '../../src/lib/tracker-model/constants/Statuses.ts';

export function epicDocumentOf(epic: Readonly<Epic>, rollup: EpicRollup): Record<string, unknown> {
  return { ...rollup, filePath: epic.filePath };
}

export function epicDocumentWithBodyOf(epic: Readonly<Epic>, rollup: EpicRollup): Record<string, unknown> {
  return { ...epicDocumentOf(epic, rollup), body: epic.body };
}

function ticketCountsText(rollup: EpicRollup): string {
  const counted = TICKET_STATUSES.filter((status) => rollup.ticketCountByStatus[status] > 0).map((status) => `${rollup.ticketCountByStatus[status]} ${status}`);
  const total   = rollup.ticketIds.length;
  return `${total} ${total === 1 ? 'ticket' : 'tickets'}${counted.length === 0 ? '' : ` (${counted.join(', ')})`}`;
}

export function epicListingLineOf(rollup: EpicRollup): string {
  return `${rollup.key}  ${rollup.title}  ${ticketCountsText(rollup)}`;
}

export function epicSummaryOf(epic: Readonly<Epic>, rollup: EpicRollup): string {
  return [
    `Epic ${rollup.key}: ${rollup.title}`,
    `  slot:     ${rollup.slot}`,
    `  tickets:  ${rollup.ticketIds.length === 0 ? '-' : rollup.ticketIds.map((ticketId) => `#${ticketId}`).join(', ')}`,
    `  status:   ${ticketCountsText(rollup)}`,
    `  tokens:   ${TokenCountUtil.formatTokenCount(rollup.tokens)}`,
    `  span:     ${rollup.span === null ? '-' : `${rollup.span.start} → ${rollup.span.end ?? 'open'}`}`,
    `  file:     ${epic.filePath}`,
  ].join('\n');
}

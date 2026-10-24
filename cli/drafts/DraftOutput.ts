/** How a draft prints: its one-line listing entry and its `draft show` summary; `--json` prints the stored document itself. */
import type { Draft } from '../../src/lib/tracker-model/@types/Draft.ts';

function claimText(draft: Readonly<Draft>): string {
  return draft.claim === null ? 'unclaimed' : `claimed by ${draft.claim.owner}`;
}

export function draftListingLineOf(draft: Readonly<Draft>): string {
  return `${draft.id}  ${draft.title}  ${claimText(draft)}`;
}

export function draftSummaryOf(draft: Readonly<Draft>, filePath: string): string {
  return [
    `Draft ${draft.id}: ${draft.title}`,
    `  opened:   ${draft.openedAt}`,
    `  claim:    ${draft.claim === null ? '-' : `${draft.claim.owner} since ${draft.claim.claimedAt}`}`,
    `  file:     ${filePath}`,
  ].join('\n');
}

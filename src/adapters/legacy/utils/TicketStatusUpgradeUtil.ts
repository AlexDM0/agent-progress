/**
 * Reads a ticket's stored status in a word the rename retired as the word that replaced it. It can be deleted once every tracker has been
 * rewritten by `agent-progress update`, with the ticket readers' older-format flag, `olderFormatWasRead` and `fileIsInAnOlderFormat`.
 */
import { RetiredStatusWordUtil } from '../../../shared/legacy/utils/RetiredStatusWordUtil.ts';

/** Any other text comes back as stored, so the caller's own check still refuses a word it does not know. */
function currentTicketStatusTextOf(storedStatusText: string): string {
  return RetiredStatusWordUtil.currentTicketStatusFor(storedStatusText) ?? storedStatusText;
}

export const TicketStatusUpgradeUtil = { currentTicketStatusTextOf } as const;

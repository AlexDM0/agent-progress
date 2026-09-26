/**
 * What the rewrite of older tracker files wrote, as `update` and `init` print it.
 * It can be deleted once every tracker has been rewritten by `agent-progress update`.
 */
import type { TrackerRewrite } from '../../../src/services/tracker/legacy/OlderTrackerFilesRewrite';

function rewrittenFilesTextOf(rewrite: TrackerRewrite): string {
  const parts: string[] = [];
  if (rewrite.progressFileWasRewritten) parts.push(rewrite.logWasMovedToItsOwnFile ? 'progress.json, with its log moved to log.jsonl' : 'progress.json');
  if (rewrite.rewrittenTicketCount > 0) parts.push(`${rewrite.rewrittenTicketCount} ticket ${rewrite.rewrittenTicketCount === 1 ? 'file' : 'files'}`);
  return parts.join(' and ');
}

export const TrackerRewriteTextUtil = { rewrittenFilesTextOf } as const;

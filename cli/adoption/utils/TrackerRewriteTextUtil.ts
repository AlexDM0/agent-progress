import type { TrackerRewrite } from '../../../src/services/tracker/TrackerPipeline';

/** What a rewrite wrote, as `update` and `init` print it. */
function rewrittenFilesTextOf(rewrite: TrackerRewrite): string {
  const parts: string[] = [];
  if (rewrite.progressFileWasRewritten) parts.push('progress.json, with its log moved to log.jsonl');
  if (rewrite.rewrittenTicketCount > 0) parts.push(`${rewrite.rewrittenTicketCount} ticket ${rewrite.rewrittenTicketCount === 1 ? 'file' : 'files'}`);
  return parts.join(' and ');
}

export const TrackerRewriteTextUtil = { rewrittenFilesTextOf } as const;

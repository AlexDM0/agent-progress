/** The whole `progress.html` document for one tracker state: the page script bundled, then the template filled; it writes no file. */
import type { LogRecord }     from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }  from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { Ticket }        from '../../lib/tracker-model/@types/Ticket.ts';
import { Board }              from '../../lib/tracker-model/Board.ts';
import { createLogger }       from '../../lib/tracker-model/Logger.ts';
import { renderProgressHtml } from './ProgressHtml.ts';
import type { RenderState }   from './RenderState.ts';
import { BoardFactsUtil }     from './utils/BoardFactsUtil.ts';

export interface ProgressPageInput {
  progress:    ProgressFile;
  tickets:     Ticket[];
  logRecords:  readonly LogRecord[];
  /** The caller's clock, never one read here. */
  generatedAt: Date;
}

export interface ProgressPageRendering {
  document:          string;
  /** Non-null when the page was written with the banner-only script. */
  pageScriptFailure: string | null;
}

/**
 * The concurrency figures come from the function `status --json` builds its block with, so the page and the command cannot disagree on a count.
 * The Board is built over the very `progress` the island carries, so every row position in its facts indexes the island's own tasks.
 */
export async function renderProgressPage(input: ProgressPageInput, renderState: RenderState): Promise<ProgressPageRendering> {
  const {
    progress,
    tickets,
    logRecords,
    generatedAt,
  } = input;

  const pageBundle        = await renderState.pageBundler.bundlePageScript();
  const pageScriptFailure = pageBundle.verdict === 'failed' ? pageBundle.reason : null;
  const board             = new Board({ progress, tickets, logger: createLogger(() => undefined) });

  const document = renderProgressHtml({
    progress,
    logRecords,
    tickets,
    pageScript:     pageBundle.verdict === 'built' ? pageBundle.script : null,
    pageScriptFailure,
    generatedAt,
    concurrency:    board.concurrency(),
    boardFacts:     BoardFactsUtil.boardFactsOf(board),
    renderMarkdown: renderState.markdownRenderer.renderMarkdown,
  });
  return { document, pageScriptFailure };
}

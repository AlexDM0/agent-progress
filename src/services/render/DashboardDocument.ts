/** The whole `progress.html` document for one tracker state: the page script bundled, then the template filled; it writes no file. */
import type { LogRecord }       from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }          from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress } from '../../lib/tracker-model/@types/TrackerProgress.ts';
import { readingBoardOf }       from '../../lib/tracker-model/ReadingBoard.ts';
import { boardFactsOf }         from './BoardFacts.ts';
import { fillPageTemplate }     from './PageTemplateFill.ts';
import type { RenderState }     from './RenderState.ts';

export interface DashboardDocumentInput {
  progress:    TrackerProgress;
  tickets:     Ticket[];
  logRecords:  readonly LogRecord[];
  /** The caller's clock, never one read here. */
  generatedAt: Date;
}

export interface DashboardDocumentRendering {
  document:          string;
  /** Non-null when the page was written with the banner-only script. */
  pageScriptFailure: string | null;
}

/**
 * The concurrency figures come from the function `status --json` builds its block with, so the page and the command cannot disagree on a count.
 * The Board is built over the very `progress` the island carries, so every row position in its facts indexes the island's own tasks.
 */
export async function renderDashboardDocument(input: DashboardDocumentInput, renderState: RenderState): Promise<DashboardDocumentRendering> {
  const {
    progress,
    tickets,
    logRecords,
    generatedAt,
  } = input;

  const pageBundle        = await renderState.pageBundler.bundlePageScript();
  const pageScriptFailure = pageBundle.verdict === 'failed' ? pageBundle.reason : null;
  const board             = readingBoardOf(progress, tickets);

  const document = fillPageTemplate({
    progress,
    logRecords,
    tickets,
    pageScript:     pageBundle.verdict === 'built' ? pageBundle.script : null,
    pageScriptFailure,
    generatedAt,
    concurrency:    board.concurrency(),
    boardFacts:     boardFactsOf(board),
    renderMarkdown: renderState.markdownRenderer.renderMarkdown,
  });
  return { document, pageScriptFailure };
}
